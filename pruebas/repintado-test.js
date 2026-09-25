/**
 * El repintado de cada 18 segundos no se lleva lo que estás escribiendo.
 *
 * El panel regenera su HTML entero en cada refresco. Antes eso cortaba a media
 * palabra el importe de una aportación y plegaba el desplegable mientras
 * apuntabas. Ahora `pintar()` guarda el foco, lo escrito y el cursor, y las
 * aportaciones recuerdan si estaban abiertas.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');
const { ok, okQue, terminar } = marcador();

const AHORA = Math.floor(Date.now() / 1000);

(async () => {
  const b = await navegador(chromium, { gl: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const err = []; p.on('pageerror', e => err.push(e.message));
  await p.route('**/api/**', r => {
    const u = new URL(r.request().url());
    const j = c => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    if (u.pathname === '/api/val/estado') return j({ generado_ts: AHORA, salud: 'ok', nodo: { sincronizado: true },
      validadores: { total: 12, activos: 12, stake_total: 384e6, ganado_total: 1000, detalle: [] } });
    if (u.pathname === '/api/val/ganancia') return j({ total: 4e6, saldo_wallet: 2e6, ciclos: [] });
    if (u.pathname === '/api/precio') return j({ disponible: true, precio: 0.00001 });
    if (u.pathname === '/api/val/aportaciones') return j({ aportaciones: [], total_pls: 0 });
    if (u.pathname === '/api/val/eventos') return j({ eventos: [] });
    return j({ datos: [] });
  });
  await p.route('https://**', r => r.abort());
  await p.goto(BASE + '/val/v2/#ganancias', { waitUntil: 'load' });
  await hasta(() => p.$('.ap-desp'), 30000);

  console.log('\n=== LO ESCRITO SOBREVIVE AL REPINTADO ===');
  await p.click('.ap-abrir');
  await p.click('#apPls');
  await p.keyboard.type('1500');
  await p.evaluate(() => window.__pintar());         // el repintado de los 18 s
  await p.keyboard.type('000');
  ok('el desplegable sigue abierto', await p.$eval('.ap-desp', e => e.open), true);
  ok('el importe sigue entero', await p.$eval('#apPls', e => e.value), '1500000');
  ok('y el foco sigue en el campo', await p.evaluate(() => document.activeElement?.id), 'apPls');

  console.log('\n=== Y EL TEMA, EN LA BARRA ===');
  okQue('el engranaje está en la barra', !!(await p.$('.barra #tmAbrir')));
  ok('cinco pestañas', await p.$$eval('.pestanas [role="tab"]', t => t.length), 5);

  ok('sin errores en la página', err, []);
  await b.close();
  terminar();
})();
