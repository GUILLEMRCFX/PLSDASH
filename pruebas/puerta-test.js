/**
 * La puerta del PIN del v2.
 *
 * Lo que se comprueba, en orden de importancia:
 *
 *   1. Sin sesión sale la puerta y NO se pinta el panel. Con sesión, no sale.
 *   2. El PIN correcto entra; el incorrecto lo dice y deja reintentar.
 *   3. El cierre de sesión NO navega si el servidor no confirma. Ése era el
 *      fallo del v1: `try { fetch } catch {}` y navegaba pasase lo que pasase,
 *      así que veías que salías y la cookie seguía puesta.
 *   4. Con la puerta puesta, el panel de detrás no se puede recorrer con el
 *      tabulador.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { BASE, marcador, hasta, navegador } = require('./ayuda');

const { ok, okQue, terminar } = marcador();

/* Un estado mínimo pero completo: lo justo para que el panel pinte sin que
   ningún panel se caiga por un campo que falta. */
const AHORA = Math.floor(Date.now() / 1000);
const ESTADO = {
  generado_ts: AHORA, salud: 'ok',
  validadores: { total: 10, activos: 10, stake_total: 320e6, pls_dia: 8000, detalle: [] },
  nodo: { sincronizado: true, optimistic: false, uptime_horas: 100 },
};

(async () => {
  const b = await navegador(chromium, { gl: true });

  /**
   * `sesion:false` hace que todo `/api/val/*` conteste 401, que es exactamente
   * lo que hace `_middleware.js` sin cookie válida. Así la prueba ejercita el
   * mismo camino que producción sin tocar cookies de verdad.
   */
  const abrir = async ({ sesion = true, viewport = { width: 1440, height: 900 },
                         authOk = true, logoutOk = true } = {}) => {
    const p = await b.newPage({ viewport, isMobile: viewport.width < 800, hasTouch: viewport.width < 800 });
    const err = [], visto = [];
    p.on('pageerror', e => err.push('pageerror: ' + e.message));
    const estado = { sesion };

    await p.route('**/api/**', r => {
      const u = new URL(r.request().url());
      visto.push(u.pathname);
      const j = (cuerpo, status = 200) =>
        r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });

      if (u.pathname === '/api/val/auth') {
        if (!authOk) return j({ error: 'PIN incorrecto' }, 401);
        estado.sesion = true;                 // como la cookie que emite el servidor
        return j({ ok: true });
      }
      if (u.pathname === '/api/val/logout') {
        if (!logoutOk) return j({ error: 'vaya' }, 500);
        estado.sesion = false;
        return j({ ok: true });
      }
      if (!estado.sesion) return j({ error: 'Sesión no válida' }, 401);

      if (u.pathname === '/api/val/estado') return j(ESTADO);
      if (u.pathname === '/api/val/ganancia') return j({ saldo_wallet: 0, ciclos: [] });
      if (u.pathname === '/api/precio') return j({ disponible: true, precio: 0.00001426, cambio24: 0 });
      if (u.pathname === '/api/val/eventos') return j({ eventos: [] });
      if (u.pathname === '/api/val/aportaciones') return j({ aportaciones: [], total_pls: 0 });
      return j({ datos: [] });
    });
    await p.route('https://**', r => r.abort());

    await p.goto(BASE + '/val/v2/', { waitUntil: 'load' });
    return { p, err, visto, estado };
  };

  const teclear = async (p, pin) => {
    for (const d of pin) await p.click(`.pu-tecla[data-k="${d}"]`);
  };

  console.log('\n=== 1. SIN SESIÓN SALE LA PUERTA ===');
  {
    const { p, err } = await abrir({ sesion: false });
    okQue('aparece la puerta', await hasta(() => p.$('.pu'), 20000));
    ok('con sus cuatro puntos', (await p.$$('.pu-punto')).length, 4);
    ok('y las doce teclas', (await p.$$('.pu-tecla')).length, 12);
    /* ⚠ Y el panel NO se pinta. Enseñar el panel vacío detrás del PIN sería
       peor que el «SIN SESIÓN» de antes: parecería que hay datos. */
    const panel = await p.$eval('.marco', e => e.textContent.replace(/\s+/g, ' ').trim());
    okQue('sin paneles pintados detrás', !/Vale el stake|Ganado/.test(panel), panel.slice(0, 90));
    // La pantalla de carga se ha retirado: dos capas a pantalla completa no.
    ok('sin pantalla de carga encima', (await p.$$('.cg')).length, 0);
    okQue('sin errores de página', err.length === 0, err.join(' | '));
    await p.close();
  }

  console.log('\n=== 2. CON SESIÓN NO SALE ===');
  {
    const { p, err } = await abrir({ sesion: true });
    okQue('el panel arranca', await hasta(() => p.$('.panel'), 25000));
    ok('y no hay puerta', (await p.$$('.pu')).length, 0);
    okQue('sin errores de página', err.length === 0, err.join(' | '));
    await p.close();
  }

  console.log('\n=== 3. EL PIN CORRECTO ENTRA ===');
  {
    const { p, err } = await abrir({ sesion: false });
    await hasta(() => p.$('.pu'), 20000);
    await teclear(p, '1234');
    okQue('la puerta se va', await hasta(async () => (await p.$$('.pu')).length === 0, 15000));
    okQue('y el panel se pinta', await hasta(() => p.$('.panel'), 25000));
    okQue('sin errores de página', err.length === 0, err.join(' | '));
    await p.close();
  }

  console.log('\n=== 4. EL PIN INCORRECTO LO DICE Y DEJA REINTENTAR ===');
  {
    const { p } = await abrir({ sesion: false, authOk: false });
    await hasta(() => p.$('.pu'), 20000);
    await teclear(p, '9999');
    await hasta(async () => (await p.$eval('#puError', e => e.textContent)).length > 0, 8000);
    const msg = await p.$eval('#puError', e => e.textContent);
    okQue('lo dice', /PIN incorrecto/.test(msg), msg);
    okQue('la puerta sigue ahí', (await p.$$('.pu')).length === 1);
    ok('y los puntos se vacían', await p.$$eval('.pu-punto.lleno', e => e.length), 0);
    // Y las teclas vuelven a estar vivas: si se quedaran apagadas, un fallo de
    // PIN dejaría la puerta muerta y habría que recargar.
    ok('las teclas se reactivan', await p.$$eval('.pu-tecla:disabled', e => e.length), 0);
    await p.close();
  }

  console.log('\n=== 5. EL CIERRE DE SESIÓN, QUE EN EL V1 MENTÍA ===');
  {
    /* ⚠ ÉSTA ES LA PRUEBA QUE JUSTIFICA TODO EL CAMBIO. Con el logout roto, el
       v1 navegaba a «/» igual y la cookie se quedaba: parecía que salías. */
    const { p } = await abrir({ sesion: true, logoutOk: false });
    await hasta(() => p.$('.panel'), 25000);
    await p.click('#tmAbrir');
    await hasta(() => p.$('#tmSalir'), 5000);
    await p.click('#tmSalir');
    await hasta(async () => /No se pudo/.test(await p.$eval('#tmSalir', e => e.textContent)), 8000);
    const t = await p.$eval('#tmSalir', e => e.textContent);
    okQue('lo dice en el propio botón', /No se pudo cerrar/.test(t), t);
    okQue('y NO ha navegado', new URL(p.url()).pathname.startsWith('/val/v2'), p.url());
  }
  {
    const { p } = await abrir({ sesion: true, logoutOk: true });
    await hasta(() => p.$('.panel'), 25000);
    await p.click('#tmAbrir');
    await hasta(() => p.$('#tmSalir'), 5000);
    await p.click('#tmSalir');
    okQue('cuando sí se cierra, navega a la portada',
      await hasta(() => p.evaluate(() => location.pathname === '/'), 10000), p.url());
    await p.close();
  }

  console.log('\n=== 6. LA SESIÓN QUE CADUCA CON EL PANEL ABIERTO ===');
  {
    /* Antes esto dejaba el panel puesto con «SIN SESIÓN» en una esquina y los
       números congelados: parece que va y no va. */
    const { p, estado } = await abrir({ sesion: true });
    await hasta(() => p.$('.panel'), 25000);
    estado.sesion = false;
    await p.evaluate(() => window.__pintar && null);   // no toca nada: solo espera
    okQue('al refrescar vuelve la puerta',
      await hasta(() => p.$('.pu'), 30000), 'no volvió en 30 s');
    await p.close();
  }

  console.log('\n=== 7. EL PANEL DE DETRÁS NO SE PUEDE TABULAR ===');
  {
    const { p } = await abrir({ sesion: false });
    await hasta(() => p.$('.pu'), 20000);
    ok('el marco queda inerte', await p.$eval('.marco', e => e.inert === true), true);
    await p.close();
  }

  console.log('\n=== 8. A 390 NADA SE SALE ===');
  {
    const { p } = await abrir({ sesion: false, viewport: { width: 390, height: 844 } });
    await hasta(() => p.$('.pu'), 20000);
    const m = await p.evaluate(() => {
      const ancho = document.documentElement.clientWidth;
      const problemas = [];
      if (document.documentElement.scrollWidth > ancho)
        problemas.push('desborda ' + (document.documentElement.scrollWidth - ancho));
      for (const e of document.querySelectorAll('.pu *')) {
        const r = e.getBoundingClientRect();
        if (r.width && (r.right > ancho + 1 || r.left < -1)) problemas.push(e.className + ' se sale');
      }
      const t = document.querySelector('.pu-tecla').getBoundingClientRect();
      return { problemas: [...new Set(problemas)], tecla: [Math.round(t.width), Math.round(t.height)] };
    });
    ok('nada que señalar', m.problemas, []);
    okQue('y las teclas llegan a 44px', m.tecla[1] >= 44, JSON.stringify(m.tecla));
    await p.close();
  }

  await b.close();
  terminar();
})();
