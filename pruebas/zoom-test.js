/**
 * Que el pellizco no amplíe la página, y que la esfera siga teniendo el suyo.
 *
 * Las dos mitades importan por igual. Bloquear el zoom es fácil; bloquearlo
 * **sin llevarse por delante el gesto de la esfera** es lo que hay que vigilar,
 * porque son dos mecanismos distintos que parecen el mismo:
 *
 *   · la página se amplía con los eventos `gesture*` de WebKit
 *   · la esfera se amplía con Pointer Events, midiendo dos punteros
 *
 * ⚠ Chromium NO emite eventos `gesture*` —son de WebKit—, así que aquí se
 *   despachan a mano y se comprueba que nuestro manejador los cancela. Eso
 *   prueba lo único que este código puede prometer: que cuando lleguen, los
 *   para. Que Safari los emita al pellizcar es cosa de Safari.
 *
 *   node pruebas/zoom-test.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');

const { ok, okQue, terminar } = marcador();

const AHORA = Math.floor(Date.now() / 1000);
const ESTADO = {
  generado_ts: AHORA, salud: 'ok',
  validadores: { total: 2, activos: 2, pendientes: 0, esperando: 0, claves: 2,
                 slashed: 0, stake_total: 64e6, pls_dia: 8000,
                 detalle: [0, 1].map(i => ({
                   indice: 100 + i, pubkey_corta: '0xab…cd', estado: 'active_ongoing',
                   pendiente: false, esperando: false, slashed: false,
                   balance: 32e6 + 500, ganado: 500,
                   activacion_ts: AHORA - 86400 * 20, horas_activo: 480,
                 })) },
  nodo: { sincronizado: true, optimistic: false, uptime_horas: 100 },
};

(async () => {
  const b = await navegador(chromium, { gl: true });
  const p = await b.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const err = [];
  p.on('pageerror', e => err.push('pageerror: ' + e.message));

  await p.route('**/api/**', r => {
    const u = new URL(r.request().url());
    const j = c => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    if (u.pathname === '/api/val/estado') return j(ESTADO);
    if (u.pathname === '/api/val/ganancia') {
      return j({ saldo_wallet: 1e6, total: 5000, ciclos: [], por_validador: { 100: 2, 101: 5 } });
    }
    if (u.pathname === '/api/precio') return j({ disponible: true, precio: 0.00001426, cambio24: 0 });
    return j({ datos: [], eventos: [], aportaciones: [], total_pls: 0 });
  });
  await p.route('https://**', r => r.abort());

  await p.goto(BASE + '/val/v2/', { waitUntil: 'load' });
  okQue('el panel pinta', await hasta(() => p.$('.panel'), 20000));

  console.log('\n=== 1. EL PELLIZCO DE PÁGINA SE CANCELA ===');
  {
    /* ⚠ LA COMPROBACIÓN QUE DA SENTIDO AL MÓDULO. Un `preventDefault` dentro de
       un manejador registrado como pasivo NO HACE NADA y no avisa: el
       navegador lo ignora en silencio. Si alguien quita el `passive: false`,
       esto se pone rojo. */
    const cancelados = await p.evaluate(() =>
      ['gesturestart', 'gesturechange', 'gestureend'].map(t => {
        const ev = new Event(t, { bubbles: true, cancelable: true });
        document.body.dispatchEvent(ev);
        return ev.defaultPrevented;
      }));
    ok('los tres eventos de pellizco de WebKit', cancelados, [true, true, true]);
  }
  {
    const conCtrl = await p.evaluate(() => {
      const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120 });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    okQue('y el pellizco de trackpad (ctrl + rueda)', conCtrl === true, String(conCtrl));
  }
  {
    // Una rueda normal NO se cancela: es el desplazamiento de toda la vida.
    const sinCtrl = await p.evaluate(() => {
      const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    okQue('pero la rueda a secas sigue desplazando', sinCtrl === false, String(sinCtrl));
  }

  console.log('\n=== 2. LAS TRES CAPAS ESTÁN PUESTAS ===');
  {
    const meta = await p.$eval('meta[name=viewport]', e => e.content);
    okQue('el meta cubre la app instalada', /user-scalable=no/.test(meta), meta);
    okQue('y sigue con viewport-fit, que hace falta para el recorte',
      /viewport-fit=cover/.test(meta), meta);
  }
  {
    const ta = await p.evaluate(() => [
      getComputedStyle(document.documentElement).touchAction,
      getComputedStyle(document.body).touchAction,
    ]);
    /* ⚠ `manipulation` NO vale aquí: quita el doble toque pero deja el
       pellizco, que es lo que hay que quitar. Si alguien lo cambia «para
       simplificar», esto lo caza. */
    okQue('la raíz enumera solo los desplazamientos',
      ta.every(v => /pan-x/.test(v) && /pan-y/.test(v) && !/manipulation|auto|pinch/.test(v)),
      JSON.stringify(ta));
  }

  console.log('\n=== 3. LA ESFERA CONSERVA SU PELLIZCO ===');
  {
    await p.click('#t-esfera');
    okQue('la escena está', await hasta(() => p.$('#escena canvas'), 20000));

    /* El lienzo se queda el gesto entero. Es MÁS restrictivo que la raíz, y así
       tiene que ser: `touch-action` solo estrecha hacia abajo en el árbol. */
    const ta = await p.$eval('#escena', e => getComputedStyle(e).touchAction);
    ok('el lienzo se queda el gesto entero', ta, 'none');

    /* ⚠ Y AQUÍ EL PELLIZCO DE VERDAD, con dos punteros.
       Comprobado que discrimina: con un `stopPropagation` de `pointerdown` en
       fase de captura —la forma tentadora de «bloquear los gestos de una vez»—
       el zoom se queda clavado en 1 y esto se pone rojo.
       Un `preventDefault` sobre `pointermove`, en cambio, NO lo rompe: la
       esfera mide posiciones, no depende de la acción por omisión. Lo digo
       porque el comentario contrario estuvo aquí escrito y era falso. */
    const antes = await p.evaluate(() => window.__esfera?.info?.().zoom ?? null);
    okQue('la esfera expone su zoom', antes != null, String(antes));

    const caja = await p.$eval('#escena canvas', e => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await p.evaluate(({ x, y }) => {
      const lienzo = document.querySelector('#escena canvas');
      const toque = (tipo, id, dx) => lienzo.dispatchEvent(new PointerEvent(tipo, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
        isPrimary: id === 1, buttons: 1, clientX: x + dx, clientY: y,
      }));
      toque('pointerdown', 1, -40); toque('pointerdown', 2, 40);
      // Los dedos se separan: el pellizco de abrir, que amplía.
      for (let i = 1; i <= 6; i++) { toque('pointermove', 1, -40 - i * 12); toque('pointermove', 2, 40 + i * 12); }
      toque('pointerup', 1, -112); toque('pointerup', 2, 112);
    }, caja);

    const despues = await p.evaluate(() => window.__esfera?.info?.().zoom ?? null);
    okQue('y el pellizco de dos dedos la amplía', despues > antes,
      `antes ${antes} · después ${despues}`);
  }

  okQue('sin errores de página', err.length === 0, err.join(' | '));
  await b.close();
  terminar();
})();
