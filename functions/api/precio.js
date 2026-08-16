/**
 * PLSDASH — Pages Function: /api/precio
 *
 * El precio de PLS, en un solo sitio.
 *
 * Antes lo pedía cada consumidor por su cuenta a DexScreener: la portada
 * dentro de su lote de tokens, el panel de validador en su propio `fetch`, y
 * `push.py` desde el NUC. Tres lecturas sueltas del mismo dato podían enseñar
 * tres cifras distintas del mismo instante, y cualquier arreglo había que
 * hacerlo tres veces.
 *
 * PLS nativo no es un PRC-20, así que su precio se lee del par de WPLS con más
 * liquidez. `priceUsd` es el precio del token BASE del par, de modo que solo
 * valen los pares donde WPLS es la base: en uno tipo HEX/WPLS ese campo
 * traería el precio del HEX. Hoy no cambia el resultado —WPLS/DAI, el de más
 * liquidez, ya lleva WPLS como base— pero evita que mañana un par nuevo con
 * WPLS del lado de la cotización devuelva otra cifra.
 *
 * DOS CAPAS DE CACHÉ, y no por gusto:
 *
 *   · `caches.default`, 60 s. Es el camino caliente y absorbe las visitas
 *     repetidas sin gastar cuota de ninguna clase.
 *   · KV, el ÚLTIMO PRECIO BUENO. No es una caché de lectura: es el respaldo
 *     que se sirve cuando DexScreener no responde. Se reescribe como mucho
 *     cada 5 minutos porque el plan gratuito de KV son 1.000 escrituras al
 *     día, y escribir en cada fallo de caché de 60 s daría 1.440 — o sea,
 *     quedarse sin escrituras a media tarde y sin respaldo justo el día que
 *     hiciera falta.
 *
 * Nunca devuelve un precio inventado ni un cero. Si DexScreener falla y hay
 * respaldo, se sirve con su antigüedad y `obsoleto: true`. Si no hay ni fuente
 * ni respaldo, 503 con `disponible: false` — y ese 503 es justo lo que hace
 * que la portada vuelva a pedir WPLS en su lote y que el NUC llame a
 * DexScreener por su cuenta, en vez de pintar un hueco en silencio.
 *
 * Forma de la respuesta:
 *   { disponible, obsoleto, precio, cambio24, par, logo, simbolo, nombre, ts }
 *   y `edad_s` cuando `obsoleto` es true.
 *
 * Devuelve el bloque entero, no solo el precio, porque la portada usa del
 * mismo par el logo, el símbolo y el `pairAddress` — que le da el gráfico en
 * vivo y el cambio a 7d/30d—. Si aquí solo viniera el precio, la portada
 * tendría que pedir WPLS a DexScreener igualmente y no habríamos unificado
 * nada.
 */

const WPLS = '0xa1077a294dde1b09bb078844df40758a5d0f9a27';
const DEXSCREENER = `https://api.dexscreener.com/token-pairs/v1/pulsechain/${WPLS}`;

const CLAVE_KV = 'precio:pls';

const TTL_BORDE = 60;       // s que vive la copia buena en el caché de borde
const TTL_FALLO = 15;       // s que vive una respuesta obsoleta: se reintenta antes
const TTL_RESPALDO = 300;   // s mínimos entre dos escrituras del respaldo en KV
const TIMEOUT_MS = 8000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

const responder = (datos, { status = 200, segundos = TTL_BORDE } = {}) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': segundos > 0 ? `public, max-age=${segundos}` : 'no-store',
      ...CORS,
    },
  });

/** El par de WPLS con más liquidez donde WPLS es la BASE. null si no hay. */
async function mejorPar() {
  const r = await fetch(DEXSCREENER, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!r.ok) return null;

  const pares = await r.json();
  if (!Array.isArray(pares) || !pares.length) return null;

  const propios = pares.filter(
    p => ((p && p.baseToken && p.baseToken.address) || '').toLowerCase() === WPLS,
  );
  if (!propios.length) return null;

  const liq = p => (p && p.liquidity && p.liquidity.usd) || 0;
  return propios.reduce((a, p) => (liq(p) > liq(a) ? p : a), propios[0]);
}

/** Del par de DexScreener a lo que sirve esta Function. null si no hay precio. */
function extraer(par, ahora) {
  if (!par) return null;

  const precio = parseFloat(par.priceUsd);
  // Un cero no es un precio, es un fallo con otra cara. Se trata como ausencia.
  if (!(precio > 0)) return null;

  const cambio = par.priceChange ? par.priceChange.h24 : null;

  return {
    disponible: true,
    obsoleto: false,
    precio,
    cambio24: cambio != null && Number.isFinite(Number(cambio)) ? Number(cambio) : null,
    par: par.pairAddress || null,
    logo: (par.info && par.info.imageUrl) || null,
    simbolo: (par.baseToken && par.baseToken.symbol) || null,
    nombre: (par.baseToken && par.baseToken.name) || null,
    ts: ahora,
  };
}

async function leerRespaldo(env) {
  if (!env.PLSDASH_KV) return null;
  try {
    const guardado = await env.PLSDASH_KV.get(CLAVE_KV, 'json');
    return guardado && guardado.precio > 0 ? guardado : null;
  } catch (e) {
    console.log(`[precio] no se pudo leer el respaldo: ${e}`);
    return null;
  }
}

/**
 * Reescribe el respaldo solo si el que hay ya tiene sus buenos minutos.
 *
 * El respaldo existe para cuando la fuente cae, y para eso da igual que tenga
 * cinco minutos: se sirve marcado con su antigüedad. Lo que no da igual es
 * pasarse de las 1.000 escrituras diarias del plan gratuito, porque a partir
 * de ahí las escrituras fallan y el respaldo se queda congelado en el último
 * valor que entró — que es el peor momento posible para descubrirlo.
 */
async function guardarRespaldo(env, datos) {
  if (!env.PLSDASH_KV) return;
  try {
    const previo = await env.PLSDASH_KV.get(CLAVE_KV, 'json');
    if (previo && datos.ts - (previo.ts || 0) < TTL_RESPALDO) return;
    await env.PLSDASH_KV.put(CLAVE_KV, JSON.stringify(datos));
  } catch (e) {
    // Una escritura fallida no puede tumbar la respuesta: el precio bueno ya
    // va de camino, y el respaldo se reintenta en el siguiente fallo de caché.
    console.log(`[precio] no se pudo guardar el respaldo: ${e}`);
  }
}

export async function onRequestGet({ request, env, waitUntil }) {
  // Clave de caché normalizada: sin query. Si no, un `?t=1699…` por visitante
  // partiría el caché en tantas copias como visitas y no cachearía nada.
  const clave = new Request(new URL('/api/precio', request.url).toString(), { method: 'GET' });
  const cache = caches.default;

  const guardada = await cache.match(clave);
  if (guardada) return guardada;

  const ahora = Math.floor(Date.now() / 1000);

  let datos = null;
  try {
    datos = extraer(await mejorPar(), ahora);
  } catch (e) {
    // Red caída, timeout, JSON raro, DexScreener de mantenimiento.
    console.log(`[precio] DexScreener no respondió: ${e}`);
  }

  if (datos) {
    const respuesta = responder(datos);
    waitUntil(cache.put(clave, respuesta.clone()));
    waitUntil(guardarRespaldo(env, datos));
    return respuesta;
  }

  // DexScreener ha fallado. El último precio bueno con su antigüedad es mejor
  // que un hueco, siempre que vaya marcado como lo que es.
  const previo = await leerRespaldo(env);
  if (previo) {
    const respuesta = responder(
      { ...previo, obsoleto: true, edad_s: Math.max(0, ahora - (previo.ts || ahora)) },
      { segundos: TTL_FALLO },
    );
    waitUntil(cache.put(clave, respuesta.clone()));
    return respuesta;
  }

  // Ni fuente ni respaldo. Estado explícito, nunca un cero de relleno.
  return responder(
    {
      disponible: false,
      obsoleto: false,
      precio: null,
      cambio24: null,
      par: null,
      logo: null,
      simbolo: null,
      nombre: null,
      ts: ahora,
      motivo: 'DexScreener no responde y no hay ningún precio guardado',
    },
    { status: 503, segundos: 0 },
  );
}
