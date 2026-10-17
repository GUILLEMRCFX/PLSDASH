/**
 * El cupo de lecturas de D1: que el panel no lo agote.
 *
 * El 17-oct-2026 D1 dejó de contestar —también al NUC— porque se pasó del
 * cupo gratuito de 5 millones de filas leídas al día. Tres cosas a la vez:
 *
 *   1. El explorador devolvía 500 y `/api/val/ganancia` NO guardaba su caché
 *      cuando fallaba, así que cada petición lo recalculaba todo.
 *   2. Recalcular leía la tabla `barridos` entera unas cinco veces aunque no
 *      hubiera entrado ni una fila.
 *   3. El panel pedía los nueve endpoints cada 18 s.
 *
 * Esta prueba va contra el endpoint DE VERDAD sobre un SQLite de verdad
 * (`node:sqlite`) y cuenta las consultas que llegan a la base.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/d1-cupo-test.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet } from '../functions/api/val/ganancia.js';
import { cargarTodo, PESADOS_MS } from '../public/val/v2/datos.js';

let fallos = 0, pruebas = 0;
const ok = (que, real, esperado) => {
  pruebas++;
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallos++;
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${que}`
    + (bien ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`));
};
const okQue = (que, cond, detalle = '') => {
  pruebas++;
  if (!cond) { fallos++; console.log(`  FALLA ${que}${detalle ? ' · ' + detalle : ''}`); }
  else console.log(`  OK   ${que}`);
};

/* ── Una D1 sobre SQLite que apunta cada consulta ─────────────────────────── */
function d1(sqlite, registro) {
  const preparada = (sql, args = []) => ({
    _sql: sql,
    bind: (...a) => preparada(sql, a),
    async all() { registro.push(sql); return { results: sqlite.prepare(sql).all(...args) }; },
    async first() { registro.push(sql); return sqlite.prepare(sql).get(...args) ?? null; },
    async run() {
      registro.push(sql);
      const r = sqlite.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: sql => preparada(sql),
    async batch(lista) { const out = []; for (const s of lista) out.push(await s.run()); return out; },
  };
}

function kv(inicial = {}) {
  const m = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    escrituras: 0,
    async get(k, o) {
      const v = m.get(k);
      if (v == null) return null;
      return (o === 'json' || o?.type === 'json') ? JSON.parse(v) : v;
    },
    async put(k, v) { this.escrituras++; m.set(k, v); },
    _m: m,
  };
}

const WALLET = '0x' + 'ab'.repeat(20);
const ACT = 1785000000;
const ESTADO = {
  validadores: {
    wallet_retirada: WALLET, activacion_ts: ACT,
    detalle: [1, 2, 3].map(i => ({ indice: i, activacion_ts: ACT })),
  },
};

function base() {
  const s = new DatabaseSync(':memory:');
  s.exec(`
    CREATE TABLE barridos (indice_retirada INTEGER PRIMARY KEY, ts INTEGER, validador INTEGER,
      cantidad REAL, bloque INTEGER, es_bloque INTEGER, precio_pls REAL);
    CREATE INDEX idx_barridos_ts ON barridos(ts DESC);
    CREATE TABLE meta (clave TEXT PRIMARY KEY, valor TEXT, actualizado INTEGER);
    CREATE TABLE eventos (id INTEGER PRIMARY KEY, ts INTEGER, tipo TEXT, titulo TEXT,
      detalle TEXT, pls REAL, validador INTEGER);
    CREATE UNIQUE INDEX ix_eventos_unico ON eventos (ts, tipo, COALESCE(validador, -1));
    CREATE TABLE snapshots (ts INTEGER PRIMARY KEY, precio_pls REAL, ganado REAL);
  `);
  // Dos barridos de tres validadores, ocho horas entre uno y otro.
  const ins = s.prepare('INSERT INTO barridos VALUES (?,?,?,?,?,?,?)');
  let idx = 100;
  for (const ts of [ACT + 3600, ACT + 3600 + 8 * 3600]) {
    for (const v of [1, 2, 3]) ins.run(idx++, ts, v, 100, 1, 0, null);
  }
  s.prepare("INSERT INTO meta VALUES ('barridos_siembra_completa', '1', 0)").run();
  return s;
}

// El explorador: caído, o contestando con lo que se le diga.
let explorador = { caido: true, items: [] };
globalThis.fetch = async url => {
  if (explorador.caido) return new Response('Internal server error', { status: 500 });
  const u = String(url);
  if (u.includes('/withdrawals')) {
    return Response.json({ items: explorador.items, next_page_params: null });
  }
  return Response.json({ coin_balance: String(1234n * 10n ** 18n) });
};

const llamar = async env => {
  const r = await onRequestGet({ env });
  return { status: r.status, cuerpo: await r.json() };
};
const pesadas = registro => ({
  ciclos: registro.filter(q => q.includes('WITH marcado')).length,
  porValidador: registro.filter(q => q.includes('GROUP BY validador')).length,
  valorado: registro.filter(q => q.includes('COUNT(*) AS todos')).length,
});
const envejecer = cache => {
  const c = JSON.parse(cache._m.get('validator:ganancia'));
  c.actualizado = Date.now() - 60 * 60 * 1000;
  cache._m.set('validator:ganancia', JSON.stringify(c));
};

console.log('\n=== 1. EXPLORADOR CAÍDO: SE GUARDA IGUAL ===');
const sqlite = base();
const registro = [];
const KV = kv({ 'validator:estado': ESTADO });
const env = { VALIDATOR_DB: d1(sqlite, registro), PLSDASH_KV: KV };
{
  const { status, cuerpo } = await llamar(env);
  ok('contesta 200 con lo guardado', status, 200);
  ok('y el total es el de la tabla', cuerpo.total, 600);
  okQue('dice que es viejo', cuerpo.obsoleto === true);
  okQue('y por qué', /explorador HTTP 500/.test(cuerpo.error || ''), cuerpo.error);
  /* ⚠ LA COMPROBACIÓN QUE IMPORTA. El código de antes solo guardaba la caché
     si el explorador había ido bien: con él caído, cada refresco lo
     recalculaba todo. */
  okQue('Y LA CACHÉ SE HA GUARDADO', KV._m.has('validator:ganancia'));
}
{
  registro.length = 0;
  const { cuerpo } = await llamar(env);
  ok('la segunda petición no toca D1', registro.length, 0);
  okQue('y sigue diciendo que es viejo', cuerpo.obsoleto === true && cuerpo.de_cache === true);
}

console.log('\n=== 2. SIN BARRIDOS NUEVOS NO SE RELEE LA TABLA ===');
{
  envejecer(KV);
  registro.length = 0;
  const { cuerpo } = await llamar(env);
  ok('ni ciclos, ni por validador, ni valorado', pesadas(registro),
     { ciclos: 0, porValidador: 0, valorado: 0 });
  ok('el total sale igual', cuerpo.total, 600);
  ok('los ciclos, también', cuerpo.ciclos.length, 2);
  okQue('y dice que ha reutilizado', cuerpo.reutilizado === true);
  okQue('con el saldo de la última vez que se leyó', 'saldo_wallet' in cuerpo);
}

console.log('\n=== 3. CON UN BARRIDO NUEVO, SÍ ===');
{
  explorador = {
    caido: false,
    items: [1, 2, 3].map((v, i) => ({
      index: 200 + i, validator_index: v, amount: String(50n * 10n ** 18n),
      timestamp: new Date((ACT + 3600 + 16 * 3600) * 1000).toISOString(), block_number: 9,
    })),
  };
  envejecer(KV);
  registro.length = 0;
  const { cuerpo } = await llamar(env);
  ok('se recalcula', pesadas(registro), { ciclos: 1, porValidador: 1, valorado: 1 });
  ok('con las filas nuevas dentro', cuerpo.total, 750);
  ok('tres ciclos', cuerpo.ciclos.length, 3);
  okQue('y ya no es viejo', cuerpo.obsoleto === false && !cuerpo.error, cuerpo.error);
  okQue('y se anota el evento del barrido',
        sqlite.prepare("SELECT COUNT(*) n FROM eventos WHERE tipo = 'barrido'").get().n === 3);
}
{
  // La siguiente pasada, con la tabla ya igual, vuelve a no leerla.
  explorador = { caido: false, items: [] };
  envejecer(KV);
  registro.length = 0;
  const { cuerpo } = await llamar(env);
  ok('y la pasada siguiente vuelve a reutilizar', pesadas(registro),
     { ciclos: 0, porValidador: 0, valorado: 0 });
  ok('sin perder nada', cuerpo.total, 750);
}

console.log('\n=== 4. D1 NO CONTESTA (CUPO AGOTADO) ===');
{
  envejecer(KV);
  const rota = {
    prepare() { throw new Error('D1_ERROR: exceeded daily row read limit'); },
    async batch() { throw new Error('D1_ERROR'); },
  };
  const { status, cuerpo } = await llamar({ VALIDATOR_DB: rota, PLSDASH_KV: KV });
  ok('no es un 500: se sirve lo último bueno', status, 200);
  ok('con su total', cuerpo.total, 750);
  okQue('diciendo que es viejo y por qué', cuerpo.obsoleto === true && /D1/.test(cuerpo.error));
}
{
  const rota = { prepare() { throw new Error('D1_ERROR'); } };
  const { status } = await llamar({ VALIDATOR_DB: rota, PLSDASH_KV: kv() });
  ok('sin nada guardado, 503 y no un cero inventado', status, 503);
}

console.log('\n=== 5. EL PANEL: CADA 18 s, SOLO LO LIGERO ===');
{
  const pedidas = [];
  globalThis.fetch = async url => {
    pedidas.push(String(url));
    if (String(url).includes('rango=serie')) return Response.json({ datos: [{ ts: 1, ganado: 5 }] });
    return Response.json({ datos: [], eventos: [] });
  };
  const realNow = Date.now;
  let ahora = realNow();
  Date.now = () => ahora;
  try {
    let d = await cargarTodo();
    ok('al arrancar se pide todo', pedidas.length, 9);

    pedidas.length = 0;
    ahora += 18000;
    d = await cargarTodo();
    ok('en el latido, solo estado y precio', pedidas.map(u => u.split('?')[0]).sort(),
       ['/api/precio', '/api/val/estado']);
    ok('y lo pesado sale de la última copia', d.serie, [{ ts: 1, ganado: 5 }]);

    pedidas.length = 0;
    ahora += PESADOS_MS;
    await cargarTodo();
    ok('pasados diez minutos, otra vez todo', pedidas.length, 9);

    pedidas.length = 0;
    await cargarTodo({ completo: true });
    ok('y todo cuando se pide expresamente (una aportación)', pedidas.length, 9);
  } finally {
    Date.now = realNow;
  }
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
