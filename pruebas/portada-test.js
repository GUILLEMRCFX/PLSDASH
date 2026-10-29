/**
 * La portada nueva (29-oct-2026): el gráfico del total, el reparto, las
 * tarjetas de wallet, el detalle de cada fila y la marca en el móvil.
 *
 * Todo con datos de mentira: una wallet con 100 unidades de un token a 2 $
 * (200 $ justos) y un /api/historico que contesta lo que cada prueba necesita.
 *
 * Lo que se comprueba, por orden de importancia:
 *   1. El gráfico acaba EXACTAMENTE en el número grande.
 *   2. Un token que se ha hundido no inventa pasado: cuenta fijo, y se dice.
 *   3. Si el histórico falla, el gráfico se esconde y la portada sigue.
 *   4. Recorrer el gráfico cambia el número grande y al salir vuelve; y ese
 *      arrastre NO abre el Vault.
 *   5. Lo demás: «1 token», el reparto, las tarjetas, el detalle, la marca.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');

const { ok, okQue, terminar } = marcador();

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const T = '0x1111111111111111111111111111111111111111';
const PAR = '0x9999999999999999999999999999999999999999';

/** Una respuesta de /api/historico con la curva de T que se le pase. */
const historico = (rango, curva, extra = {}) => {
  const n = curva.length, fin = 1_761_000_000;
  return {
    rango, tiempos: curva.map((_, i) => fin - (n - 1 - i) * 3600),
    precios: { [T]: curva }, liquidez: { [T]: 5e6 }, faltan: [], saldoPls: null,
    fuentes: { precios: 'PulseX', saldo: null }, generado: fin, ...extra,
  };
};
/* 24 h: de 0,80 $ a 1,60 $, en línea recta. A propósito NO acaba en los 2 $ de
   DexScreener: PulseX y DexScreener miden pares distintos y nunca coinciden al
   céntimo. La curva se escala para acabar en el precio de la tabla, así que
   tiene que ir de 100 $ a 200 $ justos. */
const SUBE = Array.from({ length: 25 }, (_, i) => 0.8 + 0.8 * i / 24);
// 30 d: hace un mes valía 50 $ (25 veces lo de ahora). No debe entrar.
const HUNDIDO = Array.from({ length: 31 }, (_, i) => (i === 0 ? 50 : 2));

(async () => {
  const b = await navegador(chromium);

  const abrir = async ({ viewport = { width: 1440, height: 900 }, hist = r => historico(r, SUBE), movil = false } = {}) => {
    const c = await b.newContext({ viewport, isMobile: movil, hasTouch: movil });
    const p = await c.newPage();
    const err = [], pedidas = [];
    p.on('pageerror', e => err.push('pageerror: ' + e.message));
    await p.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await p.route('**/api/historico?*', r => {
      const u = new URL(r.request().url());
      pedidas.push(u);
      const cuerpo = hist(u.searchParams.get('rango'));
      return cuerpo ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
                    : r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"caído"}' });
    });
    await p.route('https://**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route('https://rpc.pulsechain.com/**', r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x0' }) }));
    await p.route('https://api.scan.pulsechain.com/**', r => {
      const u = r.request().url();
      const cuerpo = /action=tokenlist/.test(u) && u.toLowerCase().includes(A)
        ? { status: '1', result: [{ contractAddress: T, name: 'Alfa', symbol: 'AAA', decimals: '18', type: 'ERC-20',
            balance: String(100n * 10n ** 18n) }] }
        : { items: [] };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) });
    });
    await p.route('https://api.dexscreener.com/**', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ baseToken: { address: T, symbol: 'AAA', name: 'Alfa' }, priceUsd: '2',
        liquidity: { usd: 1e6 }, priceChange: { h24: 5 }, pairAddress: PAR, info: {} }]) }));
    await p.addInitScript(w => localStorage.setItem('plsdash:portfolio', JSON.stringify({
      code: null, data: { wallets: w, customTokens: [], view: 'combined', sort: 'value', v: 1 } })),
      [{ address: A, label: 'Alfa' }]);
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await hasta(() => p.evaluate(() => /200/.test(document.getElementById('totalVal').textContent)), 15000);
    return { p, c, err, pedidas };
  };
  const total = p => p.$eval('#totalVal', e => e.textContent.replace(/\s+/g, ''));
  const grafVisible = p => p.evaluate(() => !document.getElementById('heroGraf').hidden);

  console.log('\n=== 1. EL GRÁFICO ACABA EN EL NÚMERO GRANDE ===');
  {
    const { p, c, err, pedidas } = await abrir();
    await hasta(() => grafVisible(p), 10000);
    okQue('sale el gráfico', await grafVisible(p));
    const u = pedidas[0];
    ok('pide el token con su par, y la wallet', [u.searchParams.get('rango'), u.searchParams.get('pares'), u.searchParams.get('wallets')],
      ['24h', `${T}:${PAR}`, A]);
    const s = await p.evaluate(() => graf.serie && { ini: graf.serie.v[0], fin: graf.serie.v.at(-1), fijos: graf.serie.fijos });
    ok('de 100 $ a 200 $: el último punto es el total', s, { ini: 100, fin: 200, fijos: 0 });
    const nota = await p.$eval('#hgNota', e => e.textContent);
    okQue('el pie dice de dónde sale', /con lo que tienes hoy/i.test(nota), nota);
    ok('fuera la tarjeta «Cambio 24h»', await p.$$eval('#st24Val,.stat', e => e.length), 0);
    const meta = await p.$eval('#heroMeta', e => e.textContent.replace(/\s+/g, ' '));
    okQue('«1 token», en singular', /(^|\D)1 token(?!s)/.test(meta), meta);

    console.log('\n--- recorrerlo ---');
    const bb = await (await p.$('#hgLienzo')).boundingBox();
    await p.mouse.move(bb.x + 2, bb.y + bb.height / 2);
    await hasta(async () => /\$100\.00/.test(await total(p)), 3000);
    ok('al principio, el número grande dice 100 $', await total(p), '$100.00');
    okQue('y el globo dice cuándo', /hace 24 h/.test(await p.$eval('#hgTip', e => e.textContent)),
      await p.$eval('#hgTip', e => e.textContent));
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height + 120);
    await hasta(async () => /\$200\.00/.test(await total(p)), 3000);
    ok('al salir, vuelve al de ahora', await total(p), '$200.00');

    console.log('\n--- y arrastrarlo no abre el Vault ---');
    await p.evaluate(() => { window.__fuera = null; });
    await p.mouse.move(bb.x + 20, bb.y + bb.height / 2);
    await p.mouse.down();
    await p.mouse.move(bb.x + 420, bb.y + bb.height / 2, { steps: 24 });
    const tr = await p.$eval('.hero', e => getComputedStyle(e).transform);
    await p.mouse.up();
    okQue('la tarjeta no se mueve', tr === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(tr), tr);
    okQue('sin errores', err.length === 0, err.join(' | '));
    await c.close();
  }

  console.log('\n=== 2. UN TOKEN HUNDIDO NO INVENTA PASADO ===');
  {
    const { p, c } = await abrir({ hist: r => (r === '30d' ? historico(r, HUNDIDO) : historico(r, SUBE)) });
    await hasta(() => grafVisible(p), 10000);
    await p.click('#heroGraf .rangos button[data-r="30d"]');
    await hasta(() => p.evaluate(() => graf.rango === '30d' && graf.serie && graf.serie.v.length === 31), 8000);
    const s = await p.evaluate(() => ({ ini: graf.serie.v[0], fin: graf.serie.v.at(-1), fijos: graf.serie.fijos }));
    /* Sin la guarda, hace 30 días esta cartera «valía» 100 × 50 = 5.000 $. Es
       exactamente el fallo del −99,5 % de antes. Comprobado quitándola. */
    ok('cuenta fijo: 200 $ todo el tramo', s, { ini: 200, fin: 200, fijos: 1 });
    okQue('y lo dice', /1 token cuenta fijo/.test(await p.$eval('#hgNota', e => e.textContent)),
      await p.$eval('#hgNota', e => e.textContent));
    await c.close();
  }

  console.log('\n=== 3. SI EL HISTÓRICO CAE, EL GRÁFICO SE ESCONDE ===');
  {
    const { p, c, err, pedidas } = await abrir({ hist: () => null });
    await hasta(() => pedidas.length > 0, 10000);
    await p.waitForTimeout(600);
    ok('no hay gráfico', await grafVisible(p), false);
    ok('el total sigue', await total(p), '$200.00');
    okQue('sin errores', err.length === 0, err.join(' | '));
    await c.close();
  }

  console.log('\n=== 4. REPARTO, FILAS Y WALLETS ===');
  {
    const { p, c } = await abrir();
    ok('la barra de reparto, a la vista, con su trozo', await p.$$eval('#rpBarra i', e => e.length), 1);
    okQue('y su leyenda', /AAA 100\.0%/.test(await p.$eval('#rpLey', e => e.textContent)));
    await p.click('#distBtn');
    okQue('tocarla abre la distribución', await p.$eval('#distModal', e => e.classList.contains('show')));
    await p.keyboard.press('Escape');

    await p.click('#rows .row');
    okQue('tocar una fila la abre', await p.$eval('#rows .row', e => e.classList.contains('abierto')));
    okQue('con el gráfico en vivo dentro', !!(await p.$('#rows .row .det .chartbtn')));
    okQue('y la curva del precio', !!(await p.$('#rows .row .det-graf svg path')));
    await p.click('#rows .row .num.bal');
    okQue('tocarla otra vez la cierra', !(await p.$eval('#rows .row', e => e.classList.contains('abierto'))));

    ok('la tarjeta enseña lo que vale la wallet', await p.$eval('.wchip .wch-v', e => e.textContent), '$200.00');
    ok('renombrar y quitar, escondidos', await p.$$eval('.wchip .wc-menu[hidden]', e => e.length), 1);
    await p.click('.wchip .wc-mas');
    ok('y a un toque del ⋯', await p.$$eval('.wchip .wc-menu:not([hidden]) button', e => e.map(x => x.textContent.trim())),
      ['Renombrar', 'Quitar']);
    await c.close();
  }

  console.log('\n=== 5. EN EL MÓVIL ===');
  {
    const { p, c } = await abrir({ viewport: { width: 390, height: 844 }, movil: true });
    await hasta(() => grafVisible(p), 10000);
    const m = await p.evaluate(() => {
      const d = document.querySelector('.brand div span');
      return { dash: getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().width > 10,
               desborda: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    ok('la marca entera: «plsdash», no «pls»', m.dash, true);
    ok('nada se sale a 390', m.desborda, 0);
    await c.close();
  }

  await b.close();
  terminar();
})();
