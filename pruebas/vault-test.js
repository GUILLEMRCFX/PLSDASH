/**
 * El gesto de la tarjeta del valor total: arrastrar para entrar en /val/.
 *
 * ⚠ TODA comprobación positiva va con espera activa, no con `waitForTimeout`.
 *   Esta prueba falló una de cada tres durante semanas por sueños fijos de
 *   120 ms: aciertan con la máquina descansada y fallan cuando va cargada. Las
 *   negativas —«no se mueve», «no ha navegado», «cero peticiones»— sí llevan
 *   espera fija, y a propósito: a algo que no debe ocurrir hay que darle tiempo
 *   de ocurrir para poder decir que no ocurrió.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');

const { ok, okQue, terminar } = marcador();

/** Desplazamiento de la tarjeta en px, leído del transform real. */
const desplazamiento = p => p.evaluate(() => {
  const t = getComputedStyle(document.querySelector('.hero')).transform;
  if (!t || t === 'none') return 0;
  return Math.round(parseFloat(t.split(',')[4]) || 0);
});

/** El lienzo de partículas, limpio o pintado. */
const lienzoLimpio = p => p.evaluate(() => {
  const cv = document.querySelector('.vault-cripta canvas');
  if (!cv || !cv.width) return true;
  return !cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data.some(v => v !== 0);
});

/* `window.location` no es configurable en Chromium, así que no se puede espiar
   desde la página: la navegación se corta en la red y se anota aquí. Cortarla
   además deja el fogonazo en pantalla para poder comprobarlo. */
function instrumentar(p) {
  p.__destino = null;
  return p.route('**', r => {
    const u = r.request().url();
    if (/\/val\/?(\?|#|$)/.test(u)) { p.__destino = new URL(u).pathname; return r.abort(); }
    return u.startsWith(BASE) ? r.continue() : r.abort();
  });
}
const destinoDe = p => p.__destino;
const haNavegado = p => hasta(async () => destinoDe(p) !== null);

/** Caja de la tarjeta, para arrastrar desde un punto seguro. */
const caja = p => p.evaluate(() => {
  const r = document.querySelector('.hero').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

(async () => {
  const b = await navegador(chromium);

  const nuevaPagina = async (opts = {}) => {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, ...opts });
    p.on('pageerror', e => { console.log('  ERROR DE PÁGINA:', e.message); ok('sin errores', e.message, ''); });
    await instrumentar(p);
    await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!document.querySelector('.vault-caja'));
    return p;
  };

  console.log('\n=== 1. EL FALLO DEL HOVER (sobrevolar sin pulsar) ===');
  {
    /* En producción bastaba pasar el ratón por encima para que la tarjeta se
       moviera y se quedara enganchada. Comprobación NEGATIVA: espera fija. */
    const p = await nuevaPagina();
    const c = await caja(p);
    const y = c.y + c.h / 2;
    await p.mouse.move(c.x + 20, y);
    for (let i = 40; i <= 700; i += 40) await p.mouse.move(c.x + i, y);
    await p.waitForTimeout(200);
    ok('la tarjeta no se mueve al sobrevolar', await desplazamiento(p), 0);
    ok('no se ha dibujado nada', await lienzoLimpio(p), true);
    await p.close();
  }

  console.log('\n=== 2. ZONA MUERTA DE 30px ===');
  {
    const p = await nuevaPagina();
    const c = await caja(p);
    const y = c.y + c.h / 2, x0 = c.x + 30;
    await p.mouse.move(x0, y); await p.mouse.down();
    await p.mouse.move(x0 + 20, y, { steps: 4 });
    await p.waitForTimeout(120);
    ok('a 20px todavía no se mueve', await desplazamiento(p), 0);
    // 30 de zona muerta + 60 de recorrido = 90 de dedo
    await p.mouse.move(x0 + 90, y, { steps: 10 });
    await hasta(async () => (await desplazamiento(p)) >= 55);
    const d = await desplazamiento(p);
    ok('a 90px de dedo el recorrido es ~60 (se descuenta la zona muerta)', d >= 55 && d <= 65, true);
    await p.mouse.up();
    await p.close();
  }

  console.log('\n=== 3. SOLTAR ANTES DE 244 VUELVE A CERO ===');
  {
    const p = await nuevaPagina();
    const c = await caja(p);
    const y = c.y + c.h / 2, x0 = c.x + 20;
    await p.mouse.move(x0, y); await p.mouse.down();
    await p.mouse.move(x0 + 230, y, { steps: 20 });   // 200 de recorrido
    await hasta(async () => (await desplazamiento(p)) >= 190);
    const antes = await desplazamiento(p);
    ok('llega a ~200 sin disparar', antes >= 190 && antes <= 210, true);
    ok('no ha navegado', destinoDe(p), null);
    await p.mouse.up();
    await hasta(async () => (await desplazamiento(p)) === 0, 6000);
    ok('vuelve a cero al soltar', await desplazamiento(p), 0);
    ok('sigue sin navegar', destinoDe(p), null);
    // El bucle limpia el lienzo en el fotograma en que deja de volver, así que
    // puede quedar uno pintado justo después de llegar a cero.
    await hasta(() => lienzoLimpio(p), 3000);
    ok('el lienzo queda limpio en reposo', await lienzoLimpio(p), true);
    await p.close();
  }

  console.log('\n=== 4. COMPLETAR EL RECORRIDO ===');
  {
    const p = await nuevaPagina();
    const c = await caja(p);
    const y = c.y + c.h / 2, x0 = c.x + 10;
    await p.mouse.move(x0, y); await p.mouse.down();
    await p.mouse.move(x0 + 150, y, { steps: 12 });
    await hasta(async () => (await desplazamiento(p)) > 100);
    const medio = await desplazamiento(p);
    ok('a mitad de camino se ve movimiento', medio > 100 && medio < 200, true);
    await hasta(async () => !(await lienzoLimpio(p)));
    ok('hay partículas dibujadas', !(await lienzoLimpio(p)), true);
    // Completar: 30 muertos + 244
    await p.mouse.move(x0 + 330, y, { steps: 20 });
    /* El fogonazo se enciende en el rAF siguiente a completar(), y la
       navegación 300 ms después. Se esperan las dos: nada de sueños a ojo. */
    const fogonazo = () => p.evaluate(() => !!document.querySelector('.vault-fogonazo.on'));
    await hasta(fogonazo);
    if (!(await fogonazo())) {
      /* Cuando esto falla hay que saber POR QUÉ, no solo que falló: si el
         recorrido no llegó al final es un problema de la prueba, y si llegó y
         no hay destello es un problema de `vault.js`. Sin este dato la única
         salida es volver a lanzarla a ver si pasa. */
      const d = await desplazamiento(p);
      const existe = await p.evaluate(() => !!document.querySelector('.vault-fogonazo'));
      console.log(`        recorrido ${d}px · elemento ${existe ? 'creado sin .on' : 'no creado'}`
        + ` · destino ${destinoDe(p)}`);
    }
    ok('aparece el fogonazo', await fogonazo(), true);
    await haNavegado(p);
    ok('navega a /val/', destinoDe(p), '/val/');
    await p.mouse.up();
    await p.close();
  }

  console.log('\n=== 5. SIN CANDADO NI LLAMADA A /api/val/auth ===');
  {
    const p = await nuevaPagina();
    const llamadas = [];
    p.on('request', r => { if (r.url().includes('/api/val/')) llamadas.push(r.url()); });
    const c = await caja(p);
    const y = c.y + c.h / 2, x0 = c.x + 10;
    await p.mouse.move(x0, y); await p.mouse.down();
    await p.mouse.move(x0 + 330, y, { steps: 22 });
    await haNavegado(p);
    await p.waitForTimeout(200);   // margen para una petición tardía
    ok('cero peticiones a /api/val/', llamadas, []);
    ok('no existe ningún candado',
      await p.evaluate(() => document.querySelectorAll('.candado,.rueda,.ruedas,.arco').length), 0);
    await p.mouse.up();
    await p.close();
  }

  console.log('\n=== 6. MOVIMIENTO REDUCIDO ===');
  {
    const p = await nuevaPagina({ reducedMotion: 'reduce' });
    const c = await caja(p);
    const y = c.y + c.h / 2, x0 = c.x + 10;
    await p.mouse.move(x0, y); await p.mouse.down();
    await p.mouse.move(x0 + 150, y, { steps: 12 });
    await hasta(async () => (await desplazamiento(p)) > 100);
    ok('la tarjeta se desliza igual', (await desplazamiento(p)) > 100, true);
    ok('sin partículas', await lienzoLimpio(p), true);
    await p.mouse.move(x0 + 330, y, { steps: 16 });
    /* Con movimiento reducido no hay fogonazo: se navega en el acto. Se espera
       a la navegación y solo entonces se comprueba que no se creó el destello,
       que es cuando se habría creado de existir. */
    await haNavegado(p);
    ok('navega igualmente', destinoDe(p), '/val/');
    ok('sin fogonazo', await p.evaluate(() => !!document.querySelector('.vault-fogonazo')), false);
    await p.mouse.up();
    await p.close();
  }

  console.log('\n=== 7. MÓVIL: GESTO TÁCTIL ===');
  {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true,
                                isMobile: true, deviceScaleFactor: 3 });
    await instrumentar(p);
    await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!document.querySelector('.vault-caja'));
    const c = await caja(p);
    const y = Math.round(c.y + c.h / 2);
    const entorno = await p.evaluate(() => ({ iw: window.innerWidth, dpr: window.devicePixelRatio }));
    ok('viewport estrecho y densidad alta', entorno, { iw: 390, dpr: 3 });
    // Los eventos de ratón sintéticos no valen en móvil: hace falta touch real.
    const cdp = await p.context().newCDPSession(p);
    const x0 = Math.round(c.x + 10);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 20; i <= 340; i += 20)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i, y }] });
    await haNavegado(p);
    ok('el gesto táctil navega', destinoDe(p), '/val/');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.close();
  }

  await b.close();
  terminar();
})();
