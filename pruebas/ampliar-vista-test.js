/**
 * La pestaña Ampliar en el navegador: lo que solo se ve con DOM.
 *
 *   1. El deposit_data se lee aquí: se elige, se comprueba y NO sale ninguna
 *      petición con él.
 *   2. Marcar el paso 1 despliega el 2; sin marcarlo, el 2 está cerrado.
 *   3. Escribir el nombre del nodo sobrevive al repintado de los 18 segundos.
 *   4. El engranaje del tema está en Nodo, no en la barra.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');
const { ok, okQue, terminar } = marcador();

const AHORA = Math.floor(Date.now() / 1000);
const pk = i => '0x' + i.toString(16).padStart(2, '0').repeat(48);
const MIA = '0x' + 'ab'.repeat(20);
const detalle = Array.from({ length: 12 }, (_, i) => ({ indice: 100 + i, pubkey: pk(i + 1), estado: 'active_ongoing', activacion_ts: 1786095955 }));
const ESTADO = {
  generado_ts: AHORA, salud: 'ok',
  validadores: { total: 12, activos: 12, pendientes: 0, esperando: 0, claves: 12, stake_total: 384e6,
    activacion_ts: 1786095955, wallet_retirada: MIA, pls_dia: 90000, detalle },
  nodo: { sincronizado: true },
  red: { deposito: 32e6, fork_version: '0x00000369', contrato_deposito: '0x' + '36'.repeat(20) },
  entorno: { usuario: 'operador', dir_claves: '/x/validator_keys', script_recuperacion: '/x/start_validator.sh',
    plsmenu: true, deposit_data_reciente: { nombre: 'deposit_data-1.json', ts: AHORA } },
};
const FICHERO = JSON.stringify([{ pubkey: pk(3).slice(2), withdrawal_credentials: '01' + '00'.repeat(11) + MIA.slice(2),
  amount: 32000000000000000, fork_version: '00000369', network_name: 'pulsechain' }]);

(async () => {
  const b = await navegador(chromium, { gl: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const err = []; p.on('pageerror', e => err.push(e.message));
  const peticiones = [];
  await p.route('**/api/**', r => {
    const u = new URL(r.request().url());
    peticiones.push({ ruta: u.pathname, metodo: r.request().method(), cuerpo: r.request().postData() || '' });
    const j = c => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    if (u.pathname === '/api/val/estado') return j(ESTADO);
    if (u.pathname === '/api/val/ganancia') return j({ total: 4e6, saldo_wallet: 2e6, ciclos: [] });
    if (u.pathname === '/api/precio') return j({ disponible: true, precio: 0.00001 });
    if (u.pathname === '/api/val/aportaciones') return j({ aportaciones: [], total_pls: 0 });
    if (u.pathname === '/api/val/eventos') return j({ eventos: [] });
    return j({ datos: [] });
  });
  await p.route('https://**', r => r.abort());
  await p.goto(BASE + '/val/v2/#ampliar', { waitUntil: 'load' });
  await hasta(() => p.$('.g-panel'), 30000);
  await p.evaluate(() => localStorage.clear());
  await p.evaluate(() => window.__pintar());

  console.log('\n=== 1. EL FICHERO SE LEE AQUÍ ===');
  {
    const antes = peticiones.length;
    await p.setInputFiles('#dFichero', { name: 'deposit_data-1.json', mimeType: 'application/json', buffer: Buffer.from(FICHERO) });
    await hasta(() => p.$('.d-lista'), 5000);
    const tonos = await p.$$eval('.d-control', ls => ls.map(l => l.className.replace('d-control ', '')));
    // La pubkey es la del validador 3, que YA valida: tiene que decirlo.
    ok('cinco controles, y el de la clave en rojo', tonos, ['bien', 'bien', 'mal', 'bien', 'bien']);
    okQue('dice que no comprueba la firma', /No comprueba la firma/.test(await p.$eval('.d-firma', e => e.textContent)));
    const conFichero = peticiones.slice(antes).filter(q => q.metodo !== 'GET' || q.cuerpo.includes('withdrawal'));
    ok('y no sale ni una petición con el fichero', conFichero, []);
  }

  console.log('\n=== 2. EL PASO 2 ESPERA AL 1 ===');
  {
    await p.click('.g-cabeza[data-paso="generar"]');
    okQue('sin el 1, el 2 dice que antes va el 1', !!(await p.$('.g-bloqueo')));
    await p.click('.g-cabeza[data-paso="preparar"]');
    await p.click('[data-marcar="preparar"]');
    // Tras marcar, la guía vuelve a seguir al paso que toca si no hay otro abierto.
    await p.evaluate(() => { document.querySelector('.g-cabeza[data-paso="generar"]').click(); });
    okQue('marcado el 1, el 2 se despliega', !(await p.$('.g-bloqueo')) && !!(await p.$('.g-trampa .g-grande')));
    ok('con la respuesta a la red en grande', await p.$eval('.g-grande', e => e.textContent), 'n');
    ok('y el índice de inicio sale de las claves',
      await p.$eval('.g-datos dd .mono', e => e.textContent), '12');
  }

  console.log('\n=== 3. ESCRIBIR SOBREVIVE AL REPINTADO ===');
  {
    await p.click('.g-cabeza[data-paso="preparar"]');
    // Sin host, el hueco se ve limpio: sin trozos de marcado dentro del comando.
    ok('sin host, el comando enseña el hueco tal cual',
      await p.$eval('.g-cmd code', e => e.textContent), 'ssh operador@‹host›');
    ok('y la ruta del script entera', await p.$$eval('.g-cmd code', es => es[1].textContent),
      'sudo /x/start_validator.sh');
    await p.click('#gHost');
    await p.keyboard.type('nuc');
    await p.evaluate(() => window.__pintar());          // el repintado de los 18 s
    await p.keyboard.type('.local');
    ok('el texto sigue entero', await p.$eval('#gHost', e => e.value), 'nuc.local');
    ok('y el foco sigue en el campo', await p.evaluate(() => document.activeElement?.id), 'gHost');
    await p.keyboard.press('Tab');
    const cmd = await p.$eval('.g-cmd code', e => e.textContent);
    ok('el comando ya lleva el host', cmd, 'ssh operador@nuc.local');
    ok('y se puede copiar', await p.$eval('.g-copiar', e => e.disabled), false);
  }

  console.log('\n=== 4. EL TEMA ESTÁ EN NODO ===');
  {
    okQue('no en la barra', !(await p.$('.barra #tmAbrir')));
    okQue('sí dentro de Nodo', !!(await p.$('#v-nodo #tmAbrir')));
    await p.click('#t-nodo');
    await p.evaluate(() => window.__pintar());
    okQue('y el repintado no se lo lleva', !!(await p.$('#v-nodo #tmAbrir')));
  }

  ok('sin errores en la página', err, []);
  await b.close();
  terminar();
})();
