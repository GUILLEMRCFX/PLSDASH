/**
 * PLSDASH — Validator Dashboard: /api/val/ganancia
 *
 * Requiere sesión válida (ver _middleware.js).
 *
 * La ganancia real, reconciliada contra la cadena.
 *
 * `ganado` del beacon es solo el excedente que aún no se ha retirado: cada
 * ~8,1 h el protocolo lo barre a la wallet y vuelve a cero. Lo que se ha
 * ganado de verdad es lo retirado más ese excedente, y lo retirado solo lo
 * sabe la cadena:
 *
 *     ganancia real = retiradas de nuestros validadores + excedente sin barrer
 *
 * Con los datos del 9-ago-2026: 142.451,91 + 29.115,55 = 171.567,46 PLS,
 * frente a los 29.115,55 que mostraba el panel antes de esto.
 *
 * ## Por qué acumula en KV en vez de recontar
 *
 * La wallet arrastra un año de un validador anterior y las retiradas solo
 * crecen: recorrer el listado entero en cada carga sería cada vez más caro y
 * acabaría dando timeout. Se guarda el total junto al índice de la última
 * retirada contada, y en cada pasada solo se suman las nuevas.
 */

const WALLET = '0x952E0311DdDCe7090d61a275f411a6ddF879BDc8';
const API = 'https://api.scan.pulsechain.com/api/v2';

// Los diez validadores actuales. Filtrar por índice es lo que separa esta
// etapa de la anterior; hacerlo por fecha dependería de acertar el momento
// exacto de la activación.
const PRIMER_VALIDADOR = 109549;
const ULTIMO_VALIDADOR = 109558;

// Una retirada normal ronda los 2.390 PLS por validador y ciclo; cuando toca
// proponer bloque sube a ~8.100. El umbral solo sirve para contarlos.
const UMBRAL_BLOQUE = 5000;

const CLAVE = 'validator:retiradas';
const WEI = 1e18;

// El recolector escribe cada 3 min; recontar más a menudo no aporta nada.
const FRESCURA_MS = 5 * 60 * 1000;

// Tope de páginas por pasada. Solo se recorren las retiradas nuevas, así que
// en marcha normal es una sola; esto acota el primer arranque.
const MAX_PAGINAS = 25;

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

/**
 * Recorre las retiradas nuevas (índice mayor que `desdeIndice`) y las suma.
 * El listado viene de más nueva a más vieja, así que se para en cuanto
 * alcanza lo ya contado.
 */
async function retiradasNuevas(desdeIndice) {
  let total = 0;
  let maxIndice = desdeIndice;
  const nuevas = [];
  let params = { items_count: 50 };

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const datos = await pedir(`/addresses/${WALLET}/withdrawals`, params);
    const items = datos.items || [];
    if (!items.length) break;

    let alcanzado = false;
    for (const w of items) {
      const indice = Number(w.index);
      if (Number.isFinite(desdeIndice) && indice <= desdeIndice) { alcanzado = true; break; }

      const validador = Number(w.validator_index);
      if (validador < PRIMER_VALIDADOR || validador > ULTIMO_VALIDADOR) continue;

      const pls = Number(w.amount) / WEI;
      total += pls;
      nuevas.push({ indice, validador, pls, ts: Date.parse(w.timestamp) / 1000 });
      if (!Number.isFinite(maxIndice) || indice > maxIndice) maxIndice = indice;
    }

    if (alcanzado || !datos.next_page_params) break;
    params = { items_count: 50, ...datos.next_page_params };
  }

  return { total, maxIndice, nuevas };
}

export async function onRequestGet({ env }) {
  if (!env.PLSDASH_KV) return json({ error: 'KV no configurado' }, 500);

  const guardado = await env.PLSDASH_KV.get(CLAVE, { type: 'json' });
  const ahora = Date.now();

  let acumulado = guardado || { total: 0, ultimo_indice: null, barridos: 0, bloques: 0, actualizado: 0 };

  if (ahora - (acumulado.actualizado || 0) > FRESCURA_MS) {
    try {
      const { total, maxIndice, nuevas } = await retiradasNuevas(acumulado.ultimo_indice);

      if (nuevas.length) {
        // Un barrido reparte una retirada por validador en el mismo instante,
        // y puede partirse entre dos bloques consecutivos: se agrupa por
        // minuto para no contar el mismo barrido dos veces.
        const minutos = new Set(nuevas.map(n => Math.floor(n.ts / 60)));
        acumulado = {
          total: acumulado.total + total,
          ultimo_indice: maxIndice,
          barridos: acumulado.barridos + minutos.size,
          bloques: acumulado.bloques + nuevas.filter(n => n.pls > UMBRAL_BLOQUE).length,
          actualizado: ahora,
        };
      } else {
        acumulado.actualizado = ahora;
      }

      await env.PLSDASH_KV.put(CLAVE, JSON.stringify(acumulado));
    } catch (e) {
      // Si el explorador falla se devuelve lo último acumulado marcándolo:
      // una cifra un poco vieja es mejor que ninguna, siempre que se sepa.
      return json({ ...acumulado, obsoleto: true, error: String(e.message || e) });
    }
  }

  return json({ ...acumulado, obsoleto: false });
}
