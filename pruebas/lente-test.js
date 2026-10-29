/**
 * La lente líquida de la barra inferior: que siga al dedo, que al soltar abra
 * la pestaña que hay debajo, y que en escritorio no exista.
 *
 *   node pruebas/lente-test.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');
const { ok, okQue, terminar } = marcador();
const AHORA = Math.floor(Date.now() / 1000);

async function abrir(b, opciones) {
  const p = await b.newPage(opciones);
  const err = []; p.on('pageerror', e => err.push(e.message));
  await p.route('**/api/**', r => {
    const u = new URL(r.request().url());
    const j = c => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    if (u.pathname === '/api/val/estado') return j({ generado_ts: AHORA, salud: 'ok', nodo: { sincronizado: true },
      validadores: { total: 1, activos: 1, detalle: [{ indice: 1, estado: 'active_ongoing' }] } });
    if (u.pathname === '/api/precio') return j({ disponible: true, precio: 0.00001 });
    return j({ datos: [], eventos: [], aportaciones: [], ciclos: [] });
  });
  await p.route('https://**', r => r.abort());
  await p.goto(BASE + '/val/v2/#resumen', { waitUntil: 'load' });
  await hasta(() => p.$('.panel'), 30000);
  await hasta(() => p.evaluate(() => !document.querySelector('.cg')), 30000);
  return { p, err };
}
const sel = p => p.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]').id);

(async () => {
  const b = await navegador(chromium, { gl: true });

  console.log('\n=== 1. EN EL MÓVIL ===');
  const { p, err } = await abrir(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ok('la lente está puesta', await p.evaluate(() => document.documentElement.hasAttribute('data-lente')), true);
  ok('y se ve', await p.$eval('.lente', e => getComputedStyle(e).display), 'block');

  // Arrastrar de Resumen a Nodo con el dedo encima, y soltar.
  const caja = id => p.$eval(id, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const a = await caja('#t-resumen'), d = await caja('#t-nodo');
  const cdp = await p.context().newCDPSession(p);
  const toque = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await toque('touchStart', a.x, a.y);
  for (let k = 1; k <= 10; k++) await toque('touchMove', a.x + (d.x - a.x) * k / 10, a.y);
  await p.waitForTimeout(250);
  const medio = await p.evaluate(() => { const l = document.querySelector('.lente').getBoundingClientRect(); return l.left + l.width / 2; });
  okQue('con el dedo encima, la lente lo sigue', Math.abs(medio - d.x) < 40, `${Math.round(medio)} vs ${Math.round(d.x)}`);
  ok('pero aún no cambia de pestaña', await sel(p), 't-resumen');
  await toque('touchEnd', d.x, d.y);
  okQue('al soltar, abre la de debajo', await hasta(async () => (await sel(p)) === 't-nodo', 5000), await sel(p));

  // Un toque normal sigue siendo un toque.
  await p.tap('#t-ganancias');
  okQue('un toque cambia de pestaña como siempre', await hasta(async () => (await sel(p)) === 't-ganancias', 5000));
  const g = await caja('#t-ganancias');
  okQue('y la lente acaba encima', await hasta(async () => {
    const c = await p.evaluate(() => { const l = document.querySelector('.lente').getBoundingClientRect(); return l.left + l.width / 2; });
    return Math.abs(c - g.x) < 3;
  }, 5000));
  ok('sin errores en la página', err, []);
  await p.close();

  console.log('\n=== 2. EN ESCRITORIO ===');
  const e = await abrir(b, { viewport: { width: 1440, height: 900 } });
  ok('no hay lente', await e.p.evaluate(() => document.documentElement.hasAttribute('data-lente')), false);
  ok('ni se ve', await e.p.$eval('.lente', el => getComputedStyle(el).display), 'none');
  ok('sin errores en la página', e.err, []);

  await b.close();
  terminar();
})();
