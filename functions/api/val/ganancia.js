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

// Activación de los diez validadores actuales. Todo lo anterior pertenece al
// validador que usó esta misma wallet durante casi un año, y son miles de
// retiradas: sin este corte, una tabla vacía dispara un recorrido que termina
// en 524 (timeout de Cloudflare) sin llegar a escribir nada.
const ACTIVACION_TS = 1786095955;

// Páginas por fase y pasada. Cada llamada hace como mucho NOVEDADES + SIEMBRA,
// así que el peor caso son 6 peticiones al explorador. En marcha normal es una.
//
// 3 páginas son 150 retiradas ≈ cinco días de barridos, margen de sobra para
// que una ausencia larga no deje huecos entre lo guardado y lo nuevo.
const PAGINAS_NOVEDADES = 3;
const PAGINAS_SIEMBRA = 3;

const CLAVE_SIEMBRA = 'barridos_siembra_completa';

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

/** Extremos de lo ya guardado. Sirven de cursor en las dos direcciones. */
async function extremos(db) {
  const fila = await db.prepare(
    'SELECT MAX(indice_retirada) AS tope, MIN(indice_retirada) AS suelo FROM barridos'
  ).first();
  return {
    tope: fila && fila.tope != null ? Number(fila.tope) : null,
    suelo: fila && fila.suelo != null ? Number(fila.suelo) : null,
  };
}

async function siembraCompleta(db) {
  const fila = await db.prepare('SELECT valor FROM meta WHERE clave = ?')
    .bind(CLAVE_SIEMBRA).first();
  return fila?.valor === '1';
}

async function marcarSiembraCompleta(db) {
  await db.prepare(
    'INSERT INTO meta (clave, valor, actualizado) VALUES (?, ?, ?)'
    + ' ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor,'
    + ' actualizado = excluded.actualizado'
  ).bind(CLAVE_SIEMBRA, '1', Math.floor(Date.now() / 1000)).run();
}

// Margen para considerar que dos retiradas pertenecen al mismo barrido. El
// protocolo reparte los diez en el mismo instante, pero puede partirlos entre
// dos bloques consecutivos: el del 9-ago fue 6 + 4 con 10 s de diferencia.
const SEGUNDOS_MISMO_BARRIDO = 120;

// Agrupar por minuto fijo contaba ese barrido partido como dos. Se agrupa por
// cercanía: una retirada abre ciclo nuevo solo si han pasado más de dos
// minutos desde la anterior.
const SQL_CICLOS = `
  WITH marcado AS (
    SELECT ts, cantidad, es_bloque, validador,
           CASE WHEN LAG(ts) OVER (ORDER BY ts) IS NULL
                  OR ts - LAG(ts) OVER (ORDER BY ts) > ?
                THEN 1 ELSE 0 END AS inicio
    FROM barridos
  ), grupos AS (
    SELECT *, SUM(inicio) OVER (ORDER BY ts ROWS UNBOUNDED PRECEDING) AS ciclo
    FROM marcado
  )
  SELECT ciclo, MIN(ts) AS ts, COUNT(*) AS validadores,
         SUM(cantidad) AS pls, SUM(es_bloque) AS bloques,
         GROUP_CONCAT(CASE WHEN es_bloque = 1 THEN validador END) AS proponentes,
         SUM(CASE WHEN es_bloque = 0 THEN cantidad END) AS pls_base,
         SUM(CASE WHEN es_bloque = 0 THEN 1 END) AS n_base
  FROM grupos GROUP BY ciclo ORDER BY ts ASC`;

async function ciclos(db) {
  const { results } = await db.prepare(SQL_CICLOS).bind(SEGUNDOS_MISMO_BARRIDO).all();

  return (results || []).map(c => {
    // Lo que habría cobrado el proponente sin el bloque: la media de sus
    // compañeros en ese mismo ciclo. La diferencia es la recompensa del bloque.
    const base = c.n_base > 0 ? c.pls_base / c.n_base : null;
    const extra = base != null && c.bloques > 0
      ? Math.max(0, c.pls - (base * c.validadores))
      : 0;

    return {
      ts: Number(c.ts),
      validadores: Number(c.validadores),
      pls: Number(c.pls),
      bloques: Number(c.bloques),
      proponentes: c.proponentes ? String(c.proponentes).split(',').map(Number) : [],
      base_validador: base,
      pls_bloques: extra,
    };
  });
}

/** Cuántos bloques lleva propuestos cada validador. */
async function porValidador(db) {
  const { results } = await db.prepare(
    'SELECT validador, SUM(es_bloque) AS bloques FROM barridos'
    + ' GROUP BY validador HAVING bloques > 0'
  ).all();
  const mapa = {};
  for (const f of results || []) mapa[f.validador] = Number(f.bloques);
  return mapa;
}

/** Saldo actual de la wallet: el dinero que de verdad ha llegado. */
async function saldoWallet() {
  const datos = await pedir(`/addresses/${WALLET}`, null);
  const bruto = datos?.coin_balance;
  return bruto != null ? Number(bruto) / WEI : null;
}

/**
 * Recorre el listado de retiradas, que viene de más nueva a más vieja.
 *
 * `arrancarEn`  índice desde el que continuar hacia atrás (para la siembra).
 * `pararEn`     índice ya guardado: al alcanzarlo no queda nada nuevo.
 * `maxPaginas`  presupuesto de esta pasada.
 *
 * Devuelve lo encontrado y el motivo de la parada, que es lo que dice si la
 * siembra ha terminado o si hay que seguir en la próxima llamada.
 */
async function recorrer({ arrancarEn = null, pararEn = null, maxPaginas }) {
  const encontradas = [];
  let params = { items_count: 50 };
  if (arrancarEn != null) params.index = arrancarEn;

  let motivo = 'presupuesto';
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const datos = await pedir(`/addresses/${WALLET}/withdrawals`, params);
    const items = datos.items || [];
    if (!items.length) { motivo = 'fin'; break; }

    let parada = null;
    for (const w of items) {
      const indice = Number(w.index);
      const ts = Math.floor(Date.parse(w.timestamp) / 1000);

      // Cruzar la activación significa haber llegado al validador anterior.
      if (ts < ACTIVACION_TS) { parada = 'activacion'; break; }
      if (pararEn != null && indice <= pararEn) { parada = 'conocido'; break; }

      const validador = Number(w.validator_index);
      if (validador < PRIMER_VALIDADOR || validador > ULTIMO_VALIDADOR) continue;

      encontradas.push({
        indice,
        validador,
        pls: Number(w.amount) / WEI,
        ts,
        bloque: Number(w.block_number) || null,
      });
    }

    if (parada) { motivo = parada; break; }
    if (!datos.next_page_params) { motivo = 'fin'; break; }
    params = { items_count: 50, ...datos.next_page_params };
  }

  return { encontradas, motivo };
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

/**
 * Anota en `eventos` los barridos y bloques que aún no estuvieran.
 *
 * El registro de vida llevaba un solo evento —el sembrado a mano— mientras en
 * dos días pasaban ocho bloques y ocho barridos. Los datos estaban en
 * `barridos`; solo faltaba contarlos como sucesos.
 *
 * Se comprueba antes de insertar porque `eventos` no tiene clave natural: su
 * id es autoincremental, así que un INSERT OR IGNORE no evitaría nada.
 */
async function registrarEventos(db, ciclosNuevos) {
  let escritos = 0;

  for (const c of ciclosNuevos) {
    const yaBarrido = await db.prepare(
      "SELECT 1 FROM eventos WHERE tipo = 'barrido' AND ts = ? LIMIT 1"
    ).bind(c.ts).first();

    if (!yaBarrido) {
      await db.prepare(
        'INSERT INTO eventos (ts, tipo, titulo, detalle, pls) VALUES (?, ?, ?, ?, ?)'
      ).bind(
        c.ts, 'barrido', 'Barrido de saldo',
        `${c.validadores} validadores retirados`, c.pls
      ).run();
      escritos++;
    }

    for (const v of c.proponentes) {
      const yaBloque = await db.prepare(
        "SELECT 1 FROM eventos WHERE tipo = 'bloque' AND ts = ? AND validador = ? LIMIT 1"
      ).bind(c.ts, v).first();
      if (yaBloque) continue;

      // La recompensa se reparte entre los proponentes del ciclo: si hubo dos,
      // el extra medido es de los dos juntos.
      const premio = c.bloques > 0 ? c.pls_bloques / c.bloques : null;
      await db.prepare(
        'INSERT INTO eventos (ts, tipo, titulo, detalle, pls, validador) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        c.ts, 'bloque', 'Bloque propuesto',
        `Validador ${v}`, premio, v
      ).run();
      escritos++;
    }
  }

  return escritos;
}

export async function onRequestGet({ env }) {
  const db = env.VALIDATOR_DB;
  if (!db) return json({ error: 'D1 no configurado (binding VALIDATOR_DB)' }, 500);

  // Caché de respuesta. Si algo falla al leerla se sigue adelante: es una
  // optimización, no un requisito.
  try {
    if (env.PLSDASH_KV) {
      const cache = await env.PLSDASH_KV.get(CLAVE_CACHE, { type: 'json' });
      // Durante la siembra la caché se acorta: si no, cada tramo esperaría
      // cinco minutos y completar el histórico llevaría horas.
      const ventana = cache && cache.sembrando ? 5000 : FRESCURA_MS;
      if (cache && Date.now() - (cache.actualizado || 0) < ventana) {
        return json({ ...cache, obsoleto: false, de_cache: true });
      }
    }
  } catch { /* sin caché, se recalcula */ }

  let nuevas = 0;
  let error = null;
  let sembrando = false;

  try {
    const { tope, suelo } = await extremos(db);

    // Fase 1 — novedades. Desde la más reciente hasta alcanzar lo guardado.
    const nov = await recorrer({ pararEn: tope, maxPaginas: PAGINAS_NOVEDADES });
    nuevas += await guardar(db, nov.encontradas);

    // Fase 2 — siembra hacia atrás, a trozos. La tabla empieza vacía y el
    // histórico no cabe en una sola llamada sin agotar el tiempo del Worker,
    // así que cada carga del panel avanza un tramo y se guarda el progreso
    // solo con haber escrito las filas: el cursor es el mínimo de la tabla.
    if (!(await siembraCompleta(db))) {
      const desde = suelo ?? (nov.encontradas.length
        ? Math.min(...nov.encontradas.map(n => n.indice))
        : null);

      if (desde != null) {
        const atras = await recorrer({ arrancarEn: desde, maxPaginas: PAGINAS_SIEMBRA });
        nuevas += await guardar(db, atras.encontradas);

        if (atras.motivo === 'activacion' || atras.motivo === 'fin') {
          await marcarSiembraCompleta(db);
        } else {
          sembrando = true;
        }
      }
    }
  } catch (e) {
    // Si el explorador no responde se sirve lo que ya está guardado: una cifra
    // algo vieja es mejor que ninguna, siempre que se diga.
    error = String(e.message || e);
  }

  const lista = await ciclos(db);
  const total = lista.reduce((a, c) => a + c.pls, 0);
  const bloques = lista.reduce((a, c) => a + c.bloques, 0);
  const plsBloques = lista.reduce((a, c) => a + c.pls_bloques, 0);

  // Si hubo filas nuevas, algún ciclo puede no estar aún en el registro.
  if (nuevas > 0) {
    try { await registrarEventos(db, lista); }
    catch (e) { console.error('no se pudieron registrar los eventos:', e); }
  }

  let saldo = null;
  if (!error) {
    try { saldo = await saldoWallet(); } catch { /* dato de adorno, no crítico */ }
  }

  const cuerpo = {
    total,
    bloques,
    barridos: lista.length,
    retiradas: lista.reduce((a, c) => a + c.validadores, 0),
    // Cuánto del total viene de proponer bloques. Es la parte de suerte
    // frente al rendimiento base del nodo, y explica que el APR baile.
    pls_bloques: plsBloques,
    peso_bloques: total > 0 ? (plsBloques / total) * 100 : 0,
    por_validador: await porValidador(db),
    saldo_wallet: saldo,
    ciclos: lista.slice(-40),
    nuevas,
    sembrando,
    actualizado: Date.now(),
  };

  if (!error && env.PLSDASH_KV) {
    try { await env.PLSDASH_KV.put(CLAVE_CACHE, JSON.stringify(cuerpo)); } catch { /* la caché no es crítica */ }
  }

  return json(error ? { ...cuerpo, obsoleto: true, error } : { ...cuerpo, obsoleto: false });
}
