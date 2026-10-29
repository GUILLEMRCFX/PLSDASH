/**
 * /api/historico, con las fuentes de mentira.
 *
 * Sin red: `fetch` se sustituye por uno que contesta como el subgraph de PulseX
 * y como el explorador. Lo que se comprueba es lo que el gráfico de la portada
 * da por hecho: la rejilla, el precio sacado de las reservas, el relleno de las
 * horas sin movimiento, la unión de v1 y v2, el saldo de PLS sumado y lo que
 * pasa cuando una fuente cae.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/historico-test.mjs
 */
import {
  RANGOS, leerPeticion, rejilla, precioDeFila, alinear, precios, saldoPls, onRequestGet,
} from '../functions/api/historico.js';

let fallos = 0, pruebas = 0;
const ok = (que, real, esperado) => {
  pruebas++;
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallos++;
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${que}`
    + (bien ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`));
};
const cerca = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));

const T = '0x' + 'a'.repeat(40);   // token A (token0 de su par, en v1)
const U = '0x' + 'b'.repeat(40);   // token B (token1 de su par, en v2)
const X = '0x' + 'c'.repeat(40);   // token sin par en ningún subgraph
const PA = '0x' + '1'.repeat(40), PB = '0x' + '2'.repeat(40), PX = '0x' + '3'.repeat(40);
const W1 = '0x' + 'd'.repeat(40), W2 = '0x' + 'e'.repeat(40);

console.log('── la petición');
const url = q => new URL('https://plsdash.com/api/historico?' + q);
ok('rango desconocido → no vale', leerPeticion(url(`rango=1y&pares=${T}:${PA}`)), null);
ok('sin pares → no vale', leerPeticion(url('rango=24h')), null);
ok('más de 30 pares → no vale',
  leerPeticion(url('pares=' + Array.from({ length: 31 }, (_, i) => `0x${String(i).padStart(40, '0')}:${PA}`).join(','))), null);
ok('más de 10 wallets → no vale',
  leerPeticion(url(`pares=${T}:${PA}&wallets=` + Array.from({ length: 11 }, (_, i) => `0x${String(i).padStart(40, '0')}`).join(','))), null);
ok('mayúsculas y orden no cambian la clave',
  leerPeticion(url(`rango=7d&pares=${U}:${PB},${T.toUpperCase().replace('0X', '0x')}:${PA}&wallets=${W2},${W1}`)),
  { rango: '7d', pares: [[T, PA], [U, PB]], wallets: [W1, W2] });
ok('una dirección mal escrita se descarta, el resto vale',
  leerPeticion(url(`pares=0x12:${PA},${T}:${PA}`)).pares, [[T, PA]]);

console.log('── la rejilla');
const AHORA = 1_761_000_000 + 1234;
for (const [r, n] of [['24h', 25], ['7d', 43], ['30d', 31]]) {
  const t = rejilla(r, AHORA);
  ok(`${r}: ${n} puntos, en pasos de ${RANGOS[r].paso / 3600} h`, [t.length, t[1] - t[0]], [n, RANGOS[r].paso]);
  ok(`${r}: el último no pasa de ahora`, t.at(-1) <= AHORA && AHORA - t.at(-1) < RANGOS[r].paso, true);
}

console.log('── el precio de las reservas');
ok('token0: reserveUSD / (2 · reserve0)', precioDeFila({ reserveUSD: '200', reserve0: '50', reserve1: '1' }, true), 2);
ok('token1: reserveUSD / (2 · reserve1)', precioDeFila({ reserveUSD: '200', reserve0: '50', reserve1: '4' }, false), 25);
ok('reserva a cero → sin precio, no infinito', precioDeFila({ reserveUSD: '200', reserve0: '0', reserve1: '4' }, true), null);

console.log('── el relleno');
ok('las horas sin fila toman la última conocida; antes de la primera, la primera',
  alinear([{ t: 20, v: 2 }, { t: 40, v: 4 }], [10, 20, 30, 40, 50]), [2, 2, 2, 4, 4]);
ok('sin puntos → todo null (no ceros)', alinear([], [1, 2]), [null, null]);

/* ── fuentes de mentira ── */
let caido = new Set();
let llamadas = [];
const tiempos24 = rejilla('24h', AHORA);
const filaH = (t, usd, r0, r1) => ({ t: String(t), reserveUSD: String(usd), reserve0: String(r0), reserve1: String(r1) });
function fetchFalso(u, opts = {}) {
  llamadas.push(String(u));
  const json = d => Promise.resolve(new Response(JSON.stringify(d), { status: 200 }));
  const s = String(u);
  for (const c of caido) if (s.includes(c)) return Promise.resolve(new Response('caído', { status: 503 }));
  if (s.endsWith('/pulsex') || s.endsWith('/pulsexv2')) {
    const q = JSON.parse(opts.body).query;
    const v2 = s.endsWith('v2');
    // Los alias h0, h1… siguen el orden de los pares en la consulta.
    const ids = [...q.matchAll(/(?:pair|pairAddress): "(0x[0-9a-f]{40})"/g)].map(m => m[1]);
    const data = { pairs: [] };
    ids.forEach((id, k) => { data[`h${k}`] = []; });
    ids.forEach((id, k) => {
      if (!v2 && id === PA) {
        data.pairs.push({ id: PA, token0: { id: T }, token1: { id: '0x' + 'f'.repeat(40) } });
        // Solo dos horas con movimiento: el resto se rellena.
        data[`h${k}`] = [filaH(tiempos24[3], 400, 100, 1), filaH(tiempos24[10], 600, 100, 1)];
      }
      if (v2 && id === PB) {
        data.pairs.push({ id: PB, token0: { id: '0x' + 'f'.repeat(40) }, token1: { id: U } });
        data[`h${k}`] = [filaH(tiempos24[0], 100, 1, 10)];
      }
    });
    return json({ data });
  }
  if (s.includes('coin-balance-history-by-day')) {
    const dia = t => new Date(t * 1000).toISOString().slice(0, 10);
    if (s.includes(W1)) return json([{ date: dia(AHORA - 40 * 86400), value: '0' }, { date: dia(AHORA - 86400 * 2), value: String(5e18) }]);
    if (s.includes(W2)) return json([{ date: dia(AHORA), value: String(3e18) }]);
  }
  return Promise.resolve(new Response('?', { status: 404 }));
}
globalThis.fetch = fetchFalso;

console.log('── precios de los dos subgraphs');
{
  const r = await precios([[T, PA], [U, PB], [X, PX]], '24h', tiempos24);
  const a = r.precios[T], b = r.precios[U];
  ok('el par de v1 y el de v2 salen los dos; el que no existe, en «faltan»', [Object.keys(r.precios).sort(), r.faltan], [[T, U].sort(), [X]]);
  ok('token0 de v1: 2 antes de la hora 10, 3 desde ahí', [a[0], a[3], a[9], a[10], a.at(-1)], [2, 2, 2, 3, 3]);
  ok('token1 de v2: 5 en toda la rejilla', b.every(v => cerca(v, 5)), true);
  ok('la liquidez de ahora de cada par (la de su última fila)', [r.liquidez[T], r.liquidez[U]], [600, 100]);
  ok('una sola consulta por subgraph, no una por par', llamadas.filter(x => x.includes('graph.pulsechain')).length, 2);
  llamadas = [];
  caido = new Set(['/pulsexv2']);
  const r2 = await precios([[T, PA], [U, PB]], '24h', tiempos24);
  ok('si cae v2, lo de v1 sigue y lo de v2 pasa a «faltan»', [Object.keys(r2.precios), r2.faltan], [[T], [U]]);
  caido = new Set(['/pulsex']);   // casa con los dos
  let lanzo = false;
  try { await precios([[T, PA]], '24h', tiempos24); } catch { lanzo = true; }
  ok('si caen los dos, error (y la portada esconde el gráfico)', lanzo, true);
  caido = new Set();
}

console.log('── el saldo de PLS');
{
  const s = await saldoPls([W1, W2], tiempos24);
  // W1: 5 desde el final de hace dos días → toda la rejilla de 24 h. W2: su
  // primera fila es hoy → antes era 0, y el último punto es ya el de ahora.
  ok('se suman las wallets; la fila de hoy cuenta en el último punto', [s[0], s.at(-1)], [5, 8]);
  ok('sin wallets → null', await saldoPls([], tiempos24), null);
  caido = new Set(['coin-balance']);
  ok('si el explorador cae → null (no un saldo a medias)', await saldoPls([W1, W2], tiempos24), null);
  caido = new Set();
}

console.log('── el endpoint entero');
{
  const pedir = q => onRequestGet({ request: new Request('https://plsdash.com/api/historico?' + q) });
  let r = await pedir('rango=5y');
  ok('petición mala → 400', r.status, 400);
  r = await pedir(`rango=24h&pares=${T}:${PA},${U}:${PB}&wallets=${W1}`);
  const j = await r.json();
  ok('200 con rejilla, precios, saldo y fuentes', [r.status, j.tiempos.length, Object.keys(j.precios).length, j.saldoPls?.length, !!j.fuentes.saldo], [200, 25, 2, 25, true]);
  ok('se puede cachear (público, 10 min en 24 h)', r.headers.get('cache-control'), 'public, max-age=600');
  caido = new Set(['coin-balance']);
  const j2 = await (await pedir(`rango=24h&pares=${T}:${PA}&wallets=${W1}`)).json();
  ok('sin explorador: precios sí, saldo null', [Object.keys(j2.precios).length, j2.saldoPls, j2.fuentes.saldo], [1, null, null]);
  caido = new Set(['/pulsex']);
  r = await pedir(`rango=24h&pares=${T}:${PA}`);
  ok('sin subgraph → 502, sin cachear', [r.status, r.headers.get('cache-control')], [502, 'no-store']);
  caido = new Set();
}

console.log(`\n${pruebas - fallos}/${pruebas} bien`);
process.exit(fallos ? 1 : 0);
