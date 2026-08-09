/**
 * PLSDASH — Validator Dashboard: /api/val/ganancia
 *
 * Requiere sesión válida (ver _middleware.js).
 *
 * La ganancia real, reconciliada contra la cadena.
 *
 * `ganado` del beacon es solo el excedente que aún no se ha retirado: cada
 * ~8,1 h el protocolo lo barre a la wallet y vuelve a cero. Lo ganado de
 * verdad es lo retirado más ese excedente, y lo retirado solo lo sabe la
 * cadena:
 *
 *     ganancia real = retiradas de nuestros validadores + excedente sin barrer
 *
 * ## La tabla manda, no la caché
 *
 * La primera versión llevaba el acumulado en KV con su propio cursor. Eso
 * dejaba dos estados que podían separarse, y se separaron: KV iba por el
 * índice 160169136 con siete barridos contados mientras `barridos` seguía
 * vacía, así que al desplegar la escritura solo habría recogido lo posterior
 * y las siete retiradas ya contadas no habrían entrado nunca.
 *
 * Ahora `barridos` es el estado. El cursor sale de su propio máximo, de modo
 * que una tabla vacía se rellena sola desde el principio, y los totales se
 * calculan con SQL sobre ella. KV se queda solo como caché de la respuesta,
 * para no llamar al explorador en cada carga del panel.
 */

const WALLET = '0x952E0311DdDCe7090d61a275f411a6ddF879BDc8';
const API = 'https://api.scan.pulsechain.com/api/v2';

// Los diez validadores actuales. Filtrar por índice es lo que separa esta
// etapa de la del validador que usó esta misma wallet durante un año.
const PRIMER_VALIDADOR = 109549;
const ULTIMO_VALIDADOR = 109558;

// Una retirada normal ronda los 2.390 PLS por validador y ciclo; cuando toca
// proponer bloque sube a ~8.100. El umbral solo sirve para contarlos.
const UMBRAL_BLOQUE = 5000;

const CLAVE_CACHE = 'validator:ganancia';
const WEI = 1e18;

// El recolector escribe cada 3 min; recontar más a menudo no aporta nada.
const FRESCURA_MS = 5 * 60 * 1000;

// Tope de páginas por pasada. En marcha normal es una sola; esto acota el
// primer arranque, que tiene que recorrer todo lo acumulado hasta ahora.
const MAX_PAGINAS = 25;

// D1 acepta lotes grandes, pero trocear mantiene cada escritura acotada.
const TAM_LOTE = 100;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

async function pedir(ruta, params) {
  const url = new URL(API + ruta);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'user-agent': 'plsdash/1.0' } });
  if (!res.ok) throw new Error(`explorador HTTP ${res.status}`);
  return res.json();
}

/** Última retirada ya guardada. null si la tabla está vacía. */
async function cursor(db) {
  const fila = await db.prepare('SELECT MAX(indice_retirada) AS tope FROM barridos').first();
  return fila && fila.tope != null ? Number(fila.tope) : null;
}

/**
 * Totales calculados sobre la tabla.
 *
 * Un barrido reparte una retirada por validador en el mismo instante, y puede
 * partirse entre dos bloques consecutivos —se ha visto con 10 s de diferencia—
 * así que se agrupan por minuto para no contar el mismo dos veces.
 */
async function totales(db) {
  const fila = await db.prepare(
    'SELECT COALESCE(SUM(cantidad), 0) AS total,'
    + ' COALESCE(SUM(es_bloque), 0) AS bloques,'
    + ' COUNT(DISTINCT ts / 60) AS barridos,'
    + ' COUNT(*) AS retiradas'
    + ' FROM barridos'
  ).first();

  return {
    total: Number(fila?.total || 0),
    bloques: Number(fila?.bloques || 0),
    barridos: Number(fila?.barridos || 0),
    retiradas: Number(fila?.retiradas || 0),
  };
}

/**
 * Recorre las retiradas posteriores a `desde` y las devuelve. El listado viene
 * de más nueva a más vieja, así que se para en cuanto alcanza lo ya guardado.
 */
async function retiradasNuevas(desde) {
  const nuevas = [];
  let params = { items_count: 50 };

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const datos = await pedir(`/addresses/${WALLET}/withdrawals`, params);
    const items = datos.items || [];
    if (!items.length) break;

    let alcanzado = false;
    for (const w of items) {
      const indice = Number(w.index);
      if (desde != null && indice <= desde) { alcanzado = true; break; }

      const validador = Number(w.validator_index);
      if (validador < PRIMER_VALIDADOR || validador > ULTIMO_VALIDADOR) continue;

      nuevas.push({
        indice,
        validador,
        pls: Number(w.amount) / WEI,
        ts: Math.floor(Date.parse(w.timestamp) / 1000),
        bloque: Number(w.block_number) || null,
      });
    }

    if (alcanzado || !datos.next_page_params) break;
    params = { items_count: 50, ...datos.next_page_params };
  }

  return nuevas;
}

/**
 * INSERT OR IGNORE: el índice de retirada es la clave primaria, así que
 * reprocesar un tramo no duplica nada.
 *
 * `precio_pls` se deja a NULL a propósito; la columna existe pero no se
 * necesita ninguna valoración histórica.
 */
async function guardar(db, nuevas) {
  if (!nuevas.length) return 0;

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO barridos'
    + ' (indice_retirada, ts, validador, cantidad, bloque, es_bloque, precio_pls)'
    + ' VALUES (?, ?, ?, ?, ?, ?, NULL)'
  );

  let escritas = 0;
  for (let i = 0; i < nuevas.length; i += TAM_LOTE) {
    const lote = nuevas.slice(i, i + TAM_LOTE).map(n => stmt.bind(
      n.indice, n.ts, n.validador, n.pls, n.bloque, n.pls > UMBRAL_BLOQUE ? 1 : 0
    ));
    const res = await db.batch(lote);
    escritas += res.reduce((acc, r) => acc + (r.meta?.changes || 0), 0);
  }
  return escritas;
}

export async function onRequestGet({ env }) {
  const db = env.VALIDATOR_DB;
  if (!db) return json({ error: 'D1 no configurado (binding VALIDATOR_DB)' }, 500);

  // Caché de respuesta. Si algo falla al leerla se sigue adelante: es una
  // optimización, no un requisito.
  try {
    if (env.PLSDASH_KV) {
      const cache = await env.PLSDASH_KV.get(CLAVE_CACHE, { type: 'json' });
      if (cache && Date.now() - (cache.actualizado || 0) < FRESCURA_MS) {
        return json({ ...cache, obsoleto: false, de_cache: true });
      }
    }
  } catch { /* sin caché, se recalcula */ }

  let nuevas = 0;
  let error = null;
  try {
    nuevas = await guardar(db, await retiradasNuevas(await cursor(db)));
  } catch (e) {
    // Si el explorador no responde se sirve lo que ya está guardado: una cifra
    // algo vieja es mejor que ninguna, siempre que se diga.
    error = String(e.message || e);
  }

  const t = await totales(db);
  const cuerpo = { ...t, nuevas, actualizado: Date.now() };

  if (!error && env.PLSDASH_KV) {
    try { await env.PLSDASH_KV.put(CLAVE_CACHE, JSON.stringify(cuerpo)); } catch { /* la caché no es crítica */ }
  }

  return json(error ? { ...cuerpo, obsoleto: true, error } : { ...cuerpo, obsoleto: false });
}
