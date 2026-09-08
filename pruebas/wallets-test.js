/**
 * El interruptor «cuenta en los totales» de cada wallet.
 *
 * Lo que se comprueba, en orden de importancia:
 *
 *   1. Una cartera guardada ANTES de que existiera el campo sigue sumando. Es
 *      el fallo que dejaría a todo el mundo con 0,00 $ al desplegar.
 *   2. Apagar una wallet la saca del número grande y de la tabla.
 *   3. Pero NO la saca del `w=` de inversiones. Ésa es la trampa: el conjunto
 *      de wallets propias es lo que distingue un traspaso de una fuga de
 *      dinero, y si apagar una la sacara de ahí, cada movimiento interno hacia
 *      ella aparecería como un descuadre nuevo. Todos falsos.
 *   4. Con todas apagadas se explica, en vez de enseñar 0,00 $ y una tabla en
 *      blanco, que se lee como «se ha roto».
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');

const { ok, okQue, terminar } = marcador();

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';

/* Cada wallet con UN token distinto y precio conocido, para poder leer el
   número grande y saber de quién viene cada dólar sin ambigüedad. */
const TOKEN = { [A]: '0x1111111111111111111111111111111111111111',
                [C]: '0x2222222222222222222222222222222222222222' };
const PRECIO = 2;                     // $ por unidad, los dos
const CANT = { [A]: 100, [C]: 25 };   // → 200 $ y 50 $

/* ⚠ La portada lee los tokens por `?module=account&action=tokenlist`, NO por la
   v2 del explorador. Doblar la v2 deja el total a cero y la prueba se pasa el
   rato esperando un número que no va a llegar. */
const tokenlist = w => ({ status: '1', result: [{
  contractAddress: TOKEN[w], name: w === A ? 'Alfa' : 'Charlie',
  symbol: w === A ? 'AAA' : 'CCC', decimals: '18', type: 'ERC-20',
  balance: String(BigInt(CANT[w]) * 10n ** 18n),
}] });

(async () => {
  const b = await navegador(chromium);

  const abrir = async (wallets, viewport = { width: 1440, height: 900 }) => {
    const p = await b.newPage({ viewport });
    const err = [], pedidas = [];
    p.on('pageerror', e => err.push('pageerror: ' + e.message));

    await p.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await p.route('https://**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    // Nada de PLS nativo: así el total es solo el del token de cada wallet y se
    // puede leer a ojo.
    await p.route('https://rpc.pulsechain.com/**', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x0' }) }));

    await p.route('https://api.scan.pulsechain.com/**', r => {
      const u = r.request().url();
      const quien = [A, C].find(a => u.toLowerCase().includes(a));
      const cuerpo = quien && /action=tokenlist/.test(u) ? tokenlist(quien) : { items: [] };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) });
    });

    await p.route('https://api.dexscreener.com/**', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(Object.values(TOKEN).map(a => ({
        baseToken: { address: a, symbol: 'X', name: 'X' }, priceUsd: String(PRECIO),
        liquidity: { usd: 1e6 }, priceChange: { h24: 0 }, pairAddress: '0xp', info: {},
      }))),
    }));

    /* La petición de inversiones se anota entera: lo que se comprueba es qué
       lleva en `w` y qué lleva en `ver`. */
    await p.route('**/api/inversiones*', r => {
      pedidas.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, wallets: [], ver: [], desde: 0, tz: 0,
                               sembrando: false, fallos: [], diag: [],
                               semanas: [], dias: [], descuadres: [] }) });
    });

    await p.addInitScript(w => {
      localStorage.setItem('plsdash:portfolio', JSON.stringify({
        code: null, data: { wallets: w, customTokens: [], view: 'combined', sort: 'value', v: 1 },
      }));
    }, wallets);
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForSelector('.tab');
    return { p, err, pedidas };
  };

  const total = p => p.$eval('#totalVal', e => e.textContent.replace(/\s+/g, ''));
  const dice = (p, txt) => hasta(() => p.evaluate(
    t => new RegExp(t).test(document.getElementById('totalVal').textContent), txt), 15000);

  console.log('\n=== 1. UNA CARTERA VIEJA, SIN EL CAMPO, SIGUE SUMANDO ===');
  /* ⚠ LA PRUEBA QUE JUSTIFICA EL `cuenta !== false`. Con `=== true` estas dos
     wallets llegarían apagadas y la portada abriría en 0,00 $ sin que nadie
     haya tocado nada. Comprobado rompiéndolo: falla ésta la primera, diciendo
     «$0.00». */
  {
    const { p } = await abrir([{ address: A, label: 'Alfa' }, { address: C, label: 'Charlie' }]);
    await dice(p, '[1-9]');
    okQue('suman las dos: 250 $', /250/.test(await total(p)), await total(p));
    ok('los dos interruptores encendidos',
      await p.$$eval('.w-sw', e => e.map(x => x.getAttribute('aria-checked'))), ['true', 'true']);
    await p.close();
  }

  console.log('\n=== 2. APAGAR UNA LA SACA DEL NÚMERO Y DE LA TABLA ===');
  {
    const { p, pedidas } = await abrir([{ address: A, label: 'Alfa' }, { address: C, label: 'Charlie' }]);
    await dice(p, '250');
    // Se apaga Charlie: quedan los 200 $ de Alfa.
    await p.evaluate(c => window.toggleWallet(c), C);
    await dice(p, '200');
    okQue('quedan 200 $', /200/.test(await total(p)), await total(p));
    ok('el interruptor lo dice',
      await p.$$eval('.w-sw', e => e.map(x => x.getAttribute('aria-checked'))), ['true', 'false']);
    okQue('la chapita se ve apagada', (await p.$$('.wchip.apagada')).length === 1);
    okQue('y sigue estando, para poder volver a encenderla', (await p.$$('.wchip')).length === 2);
    const meta = await p.$eval('#heroMeta', e => e.textContent.replace(/\s+/g, ' '));
    okQue('la cabecera dice cuántas quedan fuera', /1 wallet \(1 sin sumar\)/.test(meta), meta);
    okQue('el token de la apagada desaparece de la tabla',
      !/Charlie/.test(await p.$eval('#rows', e => e.textContent)));

    console.log('\n--- y la petición de inversiones separa «mía» de «cuenta» ---');
    pedidas.length = 0;
    await p.click('.tabs .tab:nth-child(4)');
    await hasta(() => p.evaluate(() =>
      document.querySelectorAll('#rows .iv-dias,#rows .state-block').length > 0), 15000);
    okQue('se ha pedido', pedidas.length > 0, String(pedidas.length));
    const u = new URL(pedidas[pedidas.length - 1] || 'http://x/?w=&ver=');
    /* ⚠ AQUÍ ESTÁ LA TRAMPA QUE ESTA PRUEBA EXISTE PARA CAZAR. `w` tiene que
       llevar las DOS aunque una esté apagada: es lo que forma `propias` en la
       Function. Comprobado rompiéndolo —mandando en `w` solo las encendidas—:
       falla justo ésta y ninguna más. */
    ok('`w` lleva las dos, apagada incluida',
      (u.searchParams.get('w') || '').split(',').sort(), [A, C].sort());
    ok('`ver` lleva solo la que cuenta', u.searchParams.get('ver'), A);
    await p.close();
  }

  console.log('\n=== 3. TODAS APAGADAS: SE EXPLICA, NO SE ENSEÑA UN CERO ===');
  {
    const { p } = await abrir([{ address: A, label: 'Alfa', cuenta: false },
                               { address: C, label: 'Charlie', cuenta: false }]);
    await hasta(() => p.evaluate(() =>
      /Ninguna wallet suma/.test(document.getElementById('rows').textContent)), 15000);
    const t = await p.$eval('#rows', e => e.textContent.replace(/\s+/g, ' '));
    okQue('lo dice con todas las letras', /Ninguna wallet suma ahora mismo/.test(t), t.slice(0, 110));
    okQue('y explica cómo deshacerlo', /interruptor/.test(t), t.slice(0, 160));
    okQue('las dos chapitas siguen ahí', (await p.$$('.wchip')).length === 2);
    await p.close();
  }

  console.log('\n=== 4. SE GUARDA ===');
  {
    const { p } = await abrir([{ address: A, label: 'Alfa' }, { address: C, label: 'Charlie' }]);
    await dice(p, '250');
    await p.evaluate(c => window.toggleWallet(c), C);
    await hasta(() => p.evaluate(() => JSON.parse(localStorage.getItem('plsdash:portfolio'))
      .data.wallets.some(w => w.cuenta === false)), 8000);
    const guardado = await p.evaluate(() =>
      JSON.parse(localStorage.getItem('plsdash:portfolio')).data.wallets.map(w => [w.label, w.cuenta]));
    ok('el estado va al almacenamiento', guardado, [['Alfa', true], ['Charlie', false]]);
    await p.close();
  }

  console.log('\n=== 5. EL INTERRUPTOR SE PUEDE TOCAR ===');
  {
    const { p } = await abrir([{ address: A, label: 'Alfa' }], { width: 390, height: 844 });
    await p.waitForSelector('.w-sw', { timeout: 15000 });
    const m = await p.evaluate(() => {
      const e = document.querySelector('.w-sw');
      const r = e.getBoundingClientRect();
      return { rol: e.getAttribute('role'), etiqueta: !!e.getAttribute('aria-label'),
               toque: getComputedStyle(e, '::after').height,
               visible: [Math.round(r.width), Math.round(r.height)] };
    });
    ok('es un switch de verdad', [m.rol, m.etiqueta], ['switch', true]);
    ok('con 44px de área de toque', m.toque, '44px');
    ok('sin agrandar la chapita', m.visible, [30, 18]);
    const desborda = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('nada se sale a 390', desborda, 0);
    await p.close();
  }

  await b.close();
  terminar();
})();
