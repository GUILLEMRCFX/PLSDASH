/**
 * La esfera del taller (29-oct-2026): 300 celdas, resplandor, núcleo, onda,
 * pulsos, acercar un validador y la descarga del barrido.
 *
 * ⚠ Va contra la esfera DE VERDAD, dentro del panel, con WebGL por software.
 *   Lo que se comprueba es el ESTADO que la esfera publica en `info()`, no la
 *   imagen: la imagen se mira en las capturas, que es donde se juzga.
 *
 *   node pruebas/esfera-taller-test.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');
const { ok, okQue, terminar } = marcador();

const AHORA = Math.floor(Date.now() / 1000);
const detalle = Array.from({ length: 21 }, (_, i) => ({
  indice: i < 16 ? 109549 + i : null, pubkey_corta: `0xa${i}…`,
  estado: i < 16 ? 'active_ongoing' : 'esperando', esperando: i >= 16,
  activacion_ts: AHORA - 80 * 86400,
}));
let eventos = [{ ts: AHORA - 3 * 3600, tipo: 'barrido', titulo: 'Barrido de saldo', pls: 1200 }];

(async () => {
  const b = await navegador(chromium, { gl: true });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const err = []; p.on('pageerror', e => err.push(e.message));
  await p.route('**/api/**', r => {
    const u = new URL(r.request().url());
    const j = c => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    if (u.pathname === '/api/val/estado') return j({ generado_ts: AHORA, salud: 'ok', nodo: { sincronizado: true },
      validadores: { total: 16, activos: 16, esperando: 5, detalle } });
    if (u.pathname === '/api/val/ganancia') return j({ total: 4e6, ciclos: [], por_validador: { 109550: 3 } });
    if (u.pathname === '/api/val/eventos') return j({ eventos });
    if (u.pathname === '/api/precio') return j({ disponible: true, precio: 0.00001 });
    return j({ datos: [], aportaciones: [] });
  });
  await p.route('https://**', r => r.abort());
  await p.goto(BASE + '/val/v2/#esfera', { waitUntil: 'load' });
  okQue('la esfera se entrega al panel',
    await hasta(() => p.evaluate(() => !!window.__esfera && !document.querySelector('.cg')), 60000));
  const info = () => p.evaluate(() => window.__esfera.info());

  console.log('\n=== 1. LO QUE SE CONSTRUYE ===');
  let i = await info();
  ok('300 celdas', i.celdas, 300);
  ok('con resplandor', i.bloom, true);
  okQue('con pulsos por la red', i.pulsos > 0, String(i.pulsos));
  ok('los 21 validadores', i.nodos, 21);
  ok('y nacida del todo', i.nacer, 1);

  console.log('\n=== 2. ACERCAR UN VALIDADOR ===');
  // Uno de la cara de delante.
  const caja = await (await p.$('#escena canvas')).boundingBox();
  const objetivo = await p.evaluate(() => {
    for (let k = 0; k < 21; k++) { const q = window.__esfera._enPantalla(k); if (q) return { k, ...q }; }
    return null;
  });
  okQue('hay un validador de frente', !!objetivo);
  await p.mouse.click(caja.x + objetivo.x, caja.y + objetivo.y);
  ok('al tocarlo, se acerca', (await info()).foco, objetivo.k);
  okQue('y se acerca de verdad: sube el zoom',
    await hasta(async () => (await info()).zoom > 1.3, 15000), String((await info()).zoom));
  // Fuera de la esfera, en una esquina.
  await p.mouse.click(caja.x + 8, caja.y + 8);
  ok('al tocar fuera, lo suelta', (await info()).foco, -1);
  okQue('y el zoom vuelve', await hasta(async () => (await info()).zoom < 1.05, 15000), String((await info()).zoom));

  console.log('\n=== 3. EL BARRIDO ===');
  ok('en reposo no hay descarga', (await info()).barrido, false);
  await p.evaluate(() => window.__esfera.barrido());
  ok('al llegar un barrido, se descarga', (await info()).barrido, true);
  okQue('y acaba sola', await hasta(async () => (await info()).barrido === false, 20000));

  console.log('\n=== 4. LA IGNICIÓN ENCIENDE LOS DE VERDAD ===');
  const n = await p.evaluate(async () => {
    const { nodosA } = await import('/val/v2/carga/naciendo.js');
    const reales = Array.from({ length: 21 }, (_, k) => ({ indice: k, intensidad: 0.5, activo: k < 16, pendiente: k >= 16 }));
    return {
      sinDatos: nodosA(1, null).nodos.length,
      antes: nodosA(0.5, reales).encendidos,
      mitad: nodosA(0.77, reales).encendidos,
      todos: nodosA(1, reales).encendidos,
      total: nodosA(0.3, reales).nodos.length,
      pendienteAlFinal: nodosA(1, reales).nodos[20].pendiente,
    };
  });
  ok('sin datos no se inventa ninguno', n.sinDatos, 0);
  ok('antes de caer la red, ninguno encendido', n.antes, 0);
  okQue('a medias, una parte', n.mitad > 0 && n.mitad < 21, String(n.mitad));
  ok('al final, todos', n.todos, 21);
  ok('y siempre están los 21, para que no cambien de sitio', n.total, 21);
  ok('el que espera sigue esperando', n.pendienteAlFinal, true);

  ok('sin errores en la página', err, []);
  await b.close();
  terminar();
})();
