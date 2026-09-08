/**
 * La vista Inversiones de la portada.
 *
 * Se dobla `/api/inversiones` para poner delante los casos que importan —los
 * tres tipos de tarjeta, la siembra por tandas, los descuadres, los envíos
 * repetidos— sin depender del explorador ni de una cartera concreta.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');

const { ok, okQue, terminar } = marcador();
const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEPOSITO = '0xdddddddddddddddddddddddddddddddddddddddd';
const OTRO = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const tok = (sim, dir, cant, extra = {}) => ({ sim, dir, logo: null, cant, ...extra });

/* Un envío de PLS hacia fuera, sin nada a cambio: la forma de un depósito de
   validador. `hacia` es la pieza que lo hace agrupable — sin ella la portada
   solo ve «salió PLS» y no puede notar que todos fueron al mismo sitio. */
const salida = (n, cant, hacia = DEPOSITO) => ({
  ts: 100 + n, tx: '0xs' + n, motivo: 'salida hacia fuera', entra: [],
  sale: [tok('PLS', 'native', cant, { hacia, desde: A })],
});

const RESPUESTA = {
  ok: true, wallets: [A], ver: [A], desde: 0, tz: -120, sembrando: false,
  fallos: [], diag: [],
  semanas: [
    { desde: '2026-08-24', usd: 500 },
    { desde: '2026-08-17', usd: 1200 },
  ],
  dias: [
    // 1. entrada + reparto: el caso limpio
    { fecha: '2026-08-26',
      entradas: [{ ts: 1, moneda: 'usd', usd: 500, sim: 'USDC', dir: '0xusdc', logo: null, cant: 500 }],
      movimientos: [
        { ts: 2, sale: tok('USDC', '0xusdc', 300), entra: tok('HEX', '0xhex', 900), gastoUsd: 300 },
        { ts: 3, sale: tok('USDC', '0xusdc', 200), entra: tok('PLSX', '0xplsx', 4000), gastoUsd: 200 },
      ],
      reparto: [
        { sim: 'HEX', dir: '0xhex', logo: null, cant: 900, usd: 300, pct: 60 },
        { sim: 'PLSX', dir: '0xplsx', logo: null, cant: 4000, usd: 200, pct: 40 },
      ],
      gastadoUsd: 500 },
    // 2. solo entrada
    { fecha: '2026-08-25',
      entradas: [{ ts: 4, moneda: 'usd', usd: 1200, sim: 'USDT', dir: '0xusdt', logo: null, cant: 1200 }],
      movimientos: [] },
    // 3. solo movimientos
    { fecha: '2026-08-22', entradas: [],
      movimientos: [{ ts: 5, sale: tok('PLS', 'native', 120e6), entra: tok('HEX', '0xhex', 800e3), gastoUsd: null }] },
    // 4. entrada en PLS: no se convierte a dólares
    { fecha: '2026-08-20',
      entradas: [{ ts: 6, moneda: 'pls', usd: null, sim: 'PLS', dir: 'native', logo: null, cant: 120e6 }],
      movimientos: [] },
  ],
  descuadres: [
    { ts: 7, tx: '0xd1', motivo: 'token que no es ni stablecoin ni PLS',
      entra: [tok('FREE-USDC', '0xdead', 50000)], sale: [] },
    { ts: 8, tx: '0xd2', motivo: 'traspaso',
      entra: [tok('USDC', '0xusdc', 300)], sale: [tok('USDC', '0xusdc', 300)] },
    /* Cuatro idénticos al mismo destino: el patrón que se agrupa. La cantidad
       NO es 32M a propósito — si la prueba usara la cifra del depósito de hoy,
       pasaría igual con un `if (cant === 32e6)` escrito a fuego, que es justo
       lo que no se quiere. Con 7,5M solo pasa si de verdad se mira la forma. */
    ...[1, 2, 3, 4].map(n => salida(n, 7.5e6)),
    // Dos iguales entre sí pero a OTRO destino: por debajo del mínimo de tres,
    // así que se quedan sueltos y no se funden con los de arriba.
    ...[5, 6].map(n => salida(n, 7.5e6, OTRO)),
  ],
};

(async () => {
  const b = await navegador(chromium, { gl: true });

  const abrir = async (viewport, cuerpo = RESPUESTA) => {
    const p = await b.newPage({ viewport, isMobile: viewport.width < 800, hasTouch: viewport.width < 800 });
    const err = [];
    p.on('pageerror', e => err.push('pageerror: ' + e.message));
    /* Los fallos de RED no cuentan: las rutas dobladas cortan peticiones a
       propósito y el navegador las anota como `ERR_CONNECTION_RESET`. Lo que se
       busca aquí es un error de JavaScript, que es lo que rompe la vista. */
    p.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/Failed to load resource|ERR_|net::/.test(t)) return;
      err.push('console: ' + t);
    });

    /* ⚠ EL ORDEN IMPORTA Y ES AL REVÉS DE LO QUE PARECE: Playwright prueba las
       rutas de la ÚLTIMA registrada a la primera. Con el comodín declarado
       después del caso concreto, el comodín se lo come y la vista recibe `{}`
       —«respuesta sin ok»— y sale la pantalla de error. El comodín va primero
       justo para que el concreto le gane. */
    await p.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await p.route('https://**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route('**/api/inversiones*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) }));

    await p.addInitScript(a => {
      localStorage.setItem('plsdash:portfolio', JSON.stringify({
        code: null, data: { wallets: [{ address: a, label: 'Principal' }],
                            customTokens: [], view: 'combined', sort: 'value', v: 1 } }));
    }, A);
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForSelector('.tab');
    await p.click('.tabs .tab:nth-child(4)');
    return { p, err };
  };

  /* `open` a mano y no un clic: la vista se repinta sola y un repintado
     después del clic devuelve el `details` a cerrado. */
  const abrirDesc = async p => {
    await hasta(() => p.$('.iv-desc'), 15000);
    await p.evaluate(() => { const d = document.querySelector('.iv-desc'); if (d) d.open = true; });
    await hasta(() => p.evaluate(() => !!document.querySelector('.iv-desc-lista li')), 5000);
  };

  console.log('\n=== 1. LOS TRES TIPOS DE TARJETA ===');
  const { p, err } = await abrir({ width: 1440, height: 900 });
  await hasta(() => p.$('.iv-dias'), 15000);
  ok('un día por fecha', (await p.$$('.iv-dia')).length, 4);
  {
    const t = await p.$eval('#rows', e => e.textContent.replace(/\s+/g, ' '));
    okQue('el reparto lleva porcentaje', /60%/.test(t.replace(/\s/g, '')), t.slice(0, 160));
    okQue('la entrada suelta dice que no se movió', /sin mover todavía/.test(t), t.slice(0, 200));
    /* La entrada en PLS se enseña sin convertir: el precio de aquel día no lo
       tenemos, y un dólar inventado sería peor que no dar ninguno. */
    okQue('la entrada en PLS avisa de que no cuenta en dólares',
      /no cuenta en el resumen/.test(t), t.slice(0, 240));
  }

  console.log('\n=== 2. LOS RESÚMENES SEMANALES ===');
  {
    const nota = await p.$eval('.iv-semanas .iv-nota', n => n.textContent);
    okQue('dice que los swaps no cuentan', /swap/i.test(nota), nota);
    ok('una línea por semana', (await p.$$('.iv-semanas li')).length, 2);
  }

  console.log('\n=== 3. LO QUE NO CUADRA, APARTE Y CON SU NOTA ===');
  {
    const d = await p.$eval('.iv-desc', e => ({ cerrado: !e.open, titulo: e.querySelector('summary').textContent.trim() }));
    ok('va plegado', d.cerrado, true);
    // Ocho descuadres: el título cuenta los HECHOS, no las líneas.
    okQue('y dice cuántos son', /8 movimientos que no cuadran/.test(d.titulo), d.titulo);
    await abrirDesc(p);
    const items = await p.$$eval('.iv-desc-lista li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
    /* 8 descuadres → 5 líneas: los cuatro idénticos se funden en una, y quedan
       el airdrop, el traspaso y los dos sueltos del otro destino. */
    ok('los cuatro repetidos ocupan una sola línea', items.length, 5);
    const texto = items.join(' | ');
    okQue('el airdrop explicado', /airdrop|regalo|tercero/i.test(texto), texto.slice(0, 120));
    okQue('el traspaso explicado', /wallets/i.test(texto), texto.slice(0, 120));
    const aviso = await p.$eval('.iv-desc .iv-nota', n => n.textContent);
    okQue('con el aviso de estafa', /estafa/i.test(aviso), aviso);
  }

  console.log('\n--- los envíos repetidos, señalados como depósitos ---');
  {
    const g = await p.$$eval('.iv-desc-lista li.iv-grupo',
      ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
    ok('un solo grupo', g.length, 1);
    okQue('dice que probablemente son depósitos de validador',
      /Probablemente depósitos de validador/.test(g[0]), g[0]);
    okQue('con el número de envíos', /4 envíos idénticos/.test(g[0]), g[0]);
    okQue('y la cantidad de cada uno', /4 × 7\.50M PLS/.test(g[0]), g[0]);
    okQue('enseña el destino, para poder comprobarlo', /0xdddd…dddd/.test(g[0]), g[0]);
    /* ⚠ Que diga que es una DEDUCCIÓN no es un detalle de redacción: no se
       puede confirmar contra el contrato de depósito desde el navegador, y una
       etiqueta afirmativa sobre una sospecha es peor que no ponerla. */
    okQue('y avisa de que no está confirmado', /no está confirmado/.test(g[0]), g[0]);
    const texto = await p.$eval('.iv-desc-lista', e => e.textContent);
    okQue('los dos del otro destino NO se agrupan',
      !/2 envíos idénticos/.test(texto), texto.slice(0, 200));
  }
  await p.close();

  console.log('\n=== 4. LA SIEMBRA SE DICE, NO SE ESCONDE ===');
  {
    const { p: q } = await abrir({ width: 1440, height: 900 }, { ...RESPUESTA, sembrando: true });
    await hasta(() => q.$('.iv-sembrando'), 15000);
    const s = await q.$eval('.iv-sembrando', e => e.textContent.trim());
    okQue('lo dice con todas las letras', /tandas/.test(s), s);
    okQue('y ya enseña lo que hay', (await q.$$('.iv-dia')).length === 4);
    await q.close();
  }

  console.log('\n=== 5. LOS FALLOS SE VEN, NO SE ESCONDEN ===');
  {
    /* Vacío sin explicación es lo que hubo que depurar a ciegas la primera vez:
       «Sin movimientos» con dos wallets que llevan meses operando no es un
       resultado válido, y sin el parte no se distingue «no llega» de «no hay». */
    const { p: q } = await abrir({ width: 1440, height: 900 }, {
      ...RESPUESTA, semanas: [], dias: [], descuadres: [],
      desde: Math.floor(Date.now() / 1000) - 540 * 86400,
      fallos: [{ wallet: A, error: 'explorador HTTP 502' }],
      diag: [{ wallet: A, sembrando: false, clasificadas: 0, parte: [
        { flujo: 'tk_to', paginas: 1, traidos: 0, estado: 'fondo' }] }],
    });
    await hasta(() => q.evaluate(() => /Sin movimientos/.test(document.getElementById('rows').textContent)), 15000);
    const t = await q.$eval('#rows', e => e.textContent.replace(/\s+/g, ' '));
    okQue('dice cuántos días mira', /540 días/.test(t), t.slice(0, 200));
    okQue('enseña el parte por flujo', /tk_to/.test(t), t.slice(0, 300));
    okQue('y avisa de qué significa que todo venga a cero',
      /no están llegando/.test(t), t.slice(0, 400));
    await q.close();
  }

  console.log('\n=== 6. MÓVIL A 390: NADA SE SALE ===');
  {
    const { p: q, err: e4 } = await abrir({ width: 390, height: 844 });
    await hasta(() => q.$('.iv-dias'), 15000);
    await abrirDesc(q);
    const mal = await q.evaluate(() => {
      const ancho = document.documentElement.clientWidth;
      const problemas = [];
      if (document.documentElement.scrollWidth > ancho)
        problemas.push(`la página desborda ${document.documentElement.scrollWidth - ancho}px`);
      for (const e of document.querySelectorAll('#rows *')) {
        const r = e.getBoundingClientRect();
        if (r.width && (r.right > ancho + 1 || r.left < -1))
          problemas.push(`${e.className || e.tagName} se sale`);
      }
      return [...new Set(problemas)].slice(0, 5);
    });
    ok('nada que señalar a 390', mal, []);
    // La fila de pestañas, en rejilla 2+2 y no tres y una suelta.
    const filas = await q.$$eval('.tabs .tab', ts => {
      const y = [...new Set(ts.map(t => Math.round(t.getBoundingClientRect().top)))];
      return { filas: y.length, anchos: [...new Set(ts.map(t => Math.round(t.getBoundingClientRect().width)))] };
    });
    ok('dos filas', filas.filas, 2);
    ok('y todas del mismo ancho', filas.anchos.length, 1);
    okQue('sin errores de consola', e4.length === 0, e4.join(' | '));
    await q.close();
  }

  okQue('sin errores de página en la vista principal', err.length === 0, err.join(' | '));

  await b.close();
  terminar();
})();
