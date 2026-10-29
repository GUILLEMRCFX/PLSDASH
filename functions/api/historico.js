/**
 * PLSDASH — /api/historico
 *
 * El histórico de precios que necesita el gráfico del total de la portada, SIN
 * GUARDAR NADA NUESTRO. Decisión del propietario (29-oct-2026): «no quiero ir
 * guardándolos yo». Todo sale, en el momento, de dos fuentes públicas:
 *
 *   · El subgraph oficial de PulseX (`graph.pulsechain.com`), v1 y v2. De las
 *     reservas de cada par sale el precio: en un AMM de producto constante las
 *     dos mitades del par valen lo mismo, así que el precio de un token es
 *     `reserveUSD / (2 · reserva de ese token)`. Por horas (`pairHourDatas`)
 *     para 24 h y 7 d, por días (`pairDayDatas`) para 30 d.
 *   · El explorador de PulseChain (Blockscout), que da el saldo de PLS de cada
 *     wallet al final de cada día (`coin-balance-history-by-day`). Con eso el
 *     PLS del gráfico es el que tenías de verdad cada día, y no el de hoy.
 *
 * Lo único que se queda es la respuesta, unos minutos, en la caché del borde
 * (`caches.default`). No es KV: no gasta cuota de escrituras ni se guarda en
 * ningún sitio que haya que mantener.
 *
 * ## Lo que NO sabe
 *
 * El saldo de los tokens que no son PLS a lo largo del tiempo. Reconstruirlo
 * exigiría recorrer todas sus transferencias; el gráfico usa lo que tienes HOY
 * a los precios de cada momento, y lo dice. Es lo que hacen casi todas las apps
 * de cartera.
 *
 * ## Si una fuente cae
 *
 * Sin precios → 502, y la portada esconde el gráfico (el total sigue). Sin
 * saldo de PLS → `saldoPls: null`, y la portada usa el de hoy diciéndolo. Una
 * parte que falla no tumba el conjunto (P8).
 *
 * GET /api/historico?rango=24h|7d|30d&pares=<token>:<par>,…&wallets=<0x>,…
 */

const SUBGRAPHS = [
  'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex',
  'https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsexv2',
];
const EXPLORADOR = 'https://api.scan.pulsechain.com/api/v2';
const TIMEOUT_MS = 8000;
const MAX_PARES = 30;
const MAX_WALLETS = 10;

/* Cada rango: cuánto mira atrás, cada cuánto pone un punto, de qué tabla lee y
   cuánto vive en la caché. 7 d se lee por horas y se pinta cada 4: por días
   serían siete puntos, que no dicen nada. */
export const RANGOS = {
  '24h': { atras: 86400, paso: 3600, tabla: 'hora', ttl: 600 },
  '7d': { atras: 7 * 86400, paso: 4 * 3600, tabla: 'hora', ttl: 1800 },
  '30d': { atras: 30 * 86400, paso: 86400, tabla: 'dia', ttl: 7200 },
};

const esDir = s => typeof s === 'string' && /^0x[0-9a-f]{40}$/.test(s);

const responder = (datos, { status = 200, segundos = 0 } = {}) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': segundos > 0 ? `public, max-age=${segundos}` : 'no-store',
    },
  });

/** Lee y valida la petición. Devuelve null si no vale. */
export function leerPeticion(url) {
  const rango = url.searchParams.get('rango') || '24h';
  if (!RANGOS[rango]) return null;
  const pares = (url.searchParams.get('pares') || '').toLowerCase().split(',').filter(Boolean)
    .map(x => x.split(':')).filter(([t, p]) => esDir(t) && esDir(p));
  const wallets = (url.searchParams.get('wallets') || '').toLowerCase().split(',').filter(esDir);
  if (!pares.length || pares.length > MAX_PARES || wallets.length > MAX_WALLETS) return null;
  // Ordenados, para que la misma cartera dé siempre la misma clave de caché.
  pares.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  wallets.sort();
  return { rango, pares, wallets };
}

/** La rejilla de tiempos: del inicio del rango a ahora, en pasos fijos. */
export function rejilla(rango, ahoraS) {
  const { atras, paso } = RANGOS[rango];
  const fin = Math.floor(ahoraS / paso) * paso;
  const t = [];
  for (let x = fin - atras; x <= fin; x += paso) t.push(x);
  return t;
}

/** Precio de un token a partir de una fila de reservas. null si no se puede. */
export function precioDeFila(fila, esToken0) {
  const usd = Number(fila.reserveUSD);
  const r = Number(esToken0 ? fila.reserve0 : fila.reserve1);
  if (!(usd > 0) || !(r > 0)) return null;
  return usd / (2 * r);
}

/**
 * Lleva puntos sueltos a la rejilla. Cada tiempo toma el último valor
 * conocido; antes del primero, el primero. Las filas del subgraph solo existen
 * en las horas con movimiento, así que un token tranquilo deja huecos que hay
 * que rellenar con lo último que se sabía, no con un cero.
 */
export function alinear(puntos, tiempos) {
  if (!puntos.length) return tiempos.map(() => null);
  const p = [...puntos].sort((a, b) => a.t - b.t);
  let i = 0;
  return tiempos.map(t => {
    while (i + 1 < p.length && p[i + 1].t <= t) i++;
    return p[i].t <= t ? p[i].v : p[0].v;
  });
}

async function consultar(url, query) {
  const r = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`subgraph ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error('subgraph: ' + (j.errors[0]?.message || 'error'));
  return j.data || {};
}

/** Precios por token en la rejilla, leyendo de los dos subgraphs. */
export async function precios(pares, rango, tiempos) {
  const { tabla } = RANGOS[rango];
  const desde = tiempos[0] - RANGOS[rango].paso;
  const ids = [...new Set(pares.map(([, p]) => p))];
  // Una consulta por subgraph, con un alias por par: así cada fila sabe de qué
  // par es sin depender de que el subgraph devuelva el campo.
  const cuerpo = ids.map((id, k) => tabla === 'hora'
    ? `h${k}: pairHourDatas(first: 1000, orderBy: hourStartUnix, where: { pair: "${id}", hourStartUnix_gte: ${desde} }) { t: hourStartUnix reserve0 reserve1 reserveUSD }`
    : `h${k}: pairDayDatas(first: 1000, orderBy: date, where: { pairAddress: "${id}", date_gte: ${desde} }) { t: date reserve0 reserve1 reserveUSD }`).join('\n');
  const query = `{ pairs(where: { id_in: [${ids.map(i => `"${i}"`).join(',')}] }) { id token0 { id } token1 { id } }\n${cuerpo} }`;

  const resultados = await Promise.allSettled(SUBGRAPHS.map(u => consultar(u, query)));
  if (resultados.every(r => r.status === 'rejected')) {
    throw new Error(resultados[0].reason?.message || 'sin subgraph');
  }
  const datos = resultados.filter(r => r.status === 'fulfilled').map(r => r.value);

  const infoPar = new Map();
  const filasPar = new Map();
  for (const d of datos) {
    for (const p of d.pairs || []) infoPar.set(p.id, p);
    ids.forEach((id, k) => { if (d[`h${k}`]?.length) filasPar.set(id, d[`h${k}`]); });
  }

  const salida = {}, faltan = [];
  for (const [token, par] of pares) {
    const info = infoPar.get(par), filas = filasPar.get(par);
    if (!info || !filas) { faltan.push(token); continue; }
    const esToken0 = info.token0.id === token;
    if (!esToken0 && info.token1.id !== token) { faltan.push(token); continue; }
    const puntos = filas.map(f => ({ t: Number(f.t), v: precioDeFila(f, esToken0) })).filter(x => x.v != null);
    if (!puntos.length) { faltan.push(token); continue; }
    salida[token] = alinear(puntos, tiempos);
  }
  return { precios: salida, faltan };
}

/** Saldo de PLS sumado de todas las wallets en la rejilla, o null si falla. */
export async function saldoPls(wallets, tiempos) {
  if (!wallets.length) return null;
  try {
    const series = await Promise.all(wallets.map(async w => {
      const r = await fetch(`${EXPLORADOR}/addresses/${w}/coin-balance-history-by-day`, {
        signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' },
      });
      if (!r.ok) throw new Error(`explorador ${r.status}`);
      const filas = await r.json();
      if (!Array.isArray(filas)) throw new Error('explorador: formato');
      // `date` es el día; el saldo es el del final de ese día. Se fecha en el
      // último segundo del día para que la rejilla no lo use antes de tiempo,
      // salvo hoy, que aún no ha acabado: la fila de hoy es el saldo de ahora.
      const ultimo = tiempos[tiempos.length - 1];
      const puntos = filas.map(f => ({ t: Math.min(Date.parse(f.date + 'T23:59:59Z') / 1000, ultimo), v: Number(f.value) / 1e18 }))
        .filter(x => Number.isFinite(x.t) && Number.isFinite(x.v));
      // La primera fila es el primer cambio de saldo: antes, la wallet no tenía
      // nada. Aquí sí es un cero, no «el primer valor conocido».
      return alinear([{ t: 0, v: 0 }, ...puntos], tiempos);
    }));
    return tiempos.map((_, i) => series.reduce((a, s) => a + (s[i] || 0), 0));
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const pet = leerPeticion(url);
  if (!pet) return responder({ error: 'petición no válida: rango=24h|7d|30d, pares=<token>:<par>,… (máx. 30), wallets=<0x>,… (máx. 10)' }, { status: 400 });

  const clave = new Request(`${url.origin}/api/historico?rango=${pet.rango}&pares=${pet.pares.map(p => p.join(':')).join(',')}&wallets=${pet.wallets.join(',')}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const guardada = await cache.match(clave);
    if (guardada) return guardada;
  }

  const ahora = Math.floor(Date.now() / 1000);
  const tiempos = rejilla(pet.rango, ahora);
  let pr;
  try { pr = await precios(pet.pares, pet.rango, tiempos); }
  catch (e) { return responder({ error: 'sin precios históricos: ' + String(e.message || e) }, { status: 502 }); }

  const saldo = await saldoPls(pet.wallets, tiempos);
  const ttl = RANGOS[pet.rango].ttl;
  const res = responder({
    rango: pet.rango, tiempos, precios: pr.precios, faltan: pr.faltan,
    saldoPls: saldo,
    fuentes: { precios: 'PulseX (graph.pulsechain.com)', saldo: saldo ? 'scan.pulsechain.com' : null },
    generado: ahora,
  }, { segundos: ttl });
  if (cache) {
    const copia = res.clone();
    const guardar = cache.put(clave, copia);
    if (waitUntil) waitUntil(guardar); else await guardar;
  }
  return res;
}
