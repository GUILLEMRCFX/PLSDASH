/**
 * La puerta del panel: el PIN, dentro del propio v2.
 *
 * Hasta ahora `/val/v2/` sin sesión decía «SIN SESIÓN · entra por /val/», o sea
 * que mandaba al v1 a hacer el trabajo. Con la puerta aquí, el v2 se sostiene
 * solo y el v1 puede irse.
 *
 * ## No se reinventa nada de la autenticación
 *
 * El PIN sigue viajando a `/api/val/auth`, la sesión sigue siendo la cookie
 * firmada con HMAC que emite `_lib/session.js`, y la guardia sigue siendo
 * `_middleware.js`. Aquí no hay ni un byte de criptografía: esto es un teclado
 * y un `fetch`. Lo único que cambia es DÓNDE se teclea.
 *
 * La cookie ya iba con `Path=/`, así que cubre `/val/v2/` sin tocar nada. Ese
 * fue el motivo de que el v2 funcionara entrando primero por el v1.
 *
 * ## El cierre de sesión, que en el v1 mentía
 *
 * El botón del v1 hace esto:
 *
 *     try { await fetch(API + '/logout', { method: 'POST' }); } catch {}
 *     window.location.href = '/';
 *
 * Y ahí está el fallo: si la petición falla —sin red, un 500, el endpoint
 * caído— el `catch` se lo traga y navega igual. Ves que sales, y la cookie
 * sigue puesta: vuelves a `/val/v2/` y entras sin PIN. Estuvo así desde que el
 * endpoint se borró por muerto y nadie lo notó, porque el síntoma es que TODO
 * parece ir bien.
 *
 * Aquí se mira la respuesta. Si el servidor no confirma, no se navega: se dice
 * que no se ha podido cerrar. Un cierre de sesión que falla en silencio es
 * peor que un botón que no existe.
 *
 * ## El anillo (29-oct-2026)
 *
 * Cuatro casillas en fila. Con la cuarta suben a un anillo alrededor de un
 * punto y GIRAN MIENTRAS SE COMPRUEBA EL PIN: el giro es la espera real de
 * `/api/val/auth`, que antes no se veía. Bueno: verde una a una, se juntan en
 * un sello con el check y el punto queda en el centro, que es donde empieza la
 * ignición de la pantalla de carga. Malo: el anillo se frena, tiembla en rojo y
 * las casillas vuelven a la fila.
 *
 * ⚠ LAS CASILLAS ENSEÑAN UN PUNTO, NO EL DÍGITO. La animación de referencia los
 *   enseñaba; aquí no, porque un PIN en claro se lee por encima del hombro, y
 *   la puerta de antes tampoco los enseñaba. De paso, que las cuatro sean
 *   iguales es lo que deja parar el giro en cualquier cuarto de vuelta sin que
 *   se note: no hay dígito que delate que han cambiado de sitio.
 *
 * Nada de esto toca la autenticación: el PIN va al mismo sitio, de la misma
 * forma, y la regla de Cloudflare contra la fuerza bruta sigue igual.
 */

const API = '/api/val';
const LARGO = 4;

/* La geometría del anillo, en px. FILA es dónde está cada casilla en reposo;
   ANILLO, dónde va al subir: izquierda, arriba, derecha, abajo. */
const RADIO = 56;
const FILA = [-78, -26, 26, 78];
const ANILLO = [[-RADIO, 0], [0, -RADIO], [RADIO, 0], [0, RADIO]];
const espera = ms => new Promise(r => setTimeout(r, ms));
/* Una animación cancelada a medias rechaza su promesa. Aquí eso no es un fallo:
   es que la puerta se ha ido o ha vuelto a empezar. */
const fin = a => a.finished.catch(() => {});

const reducido = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Cierra la sesión de verdad.
 *
 * @returns {Promise<boolean>} true solo si el servidor ha confirmado que ha
 *   borrado la cookie. Quien llama decide qué hacer con un false; lo que no
 *   puede es dar por hecho que salió bien.
 */
export async function cerrarSesion() {
  try {
    const res = await fetch(API + '/logout', { method: 'POST', credentials: 'same-origin' });
    return res.ok;
  } catch {
    return false;
  }
}

const TECLAS = [
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  'salir', '0', 'borrar',
];

/* ⚠ El borrar va en SVG y no con el carácter «⌫» (U+232B). Inter no lo trae y
   el navegador cae a la fuente del sistema: en la captura a 390 salía como un
   rectángulo tachado, o sea un glifo roto en la única tecla que no tiene número
   que la explique. Un trazo dibujado se ve igual en todas partes. */
const BORRAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9L3 12z"/>
  <path d="M15 9l-4 6M11 9l4 6"/>
</svg>`;

const ETIQUETA = {
  salir: 'Salir',
  borrar: BORRAR,
};

const ROTULO = {
  salir: 'Salir a PLSDASH',
  borrar: 'Borrar el último dígito',
};

/**
 * Monta la puerta a pantalla completa dentro de `caja`.
 *
 * @param {HTMLElement} caja       dónde colgarla, normalmente `document.body`.
 * @param {Function} opciones.alEntrar  se llama cuando el PIN es correcto y la
 *   cookie ya está puesta. La puerta se quita sola antes de llamarlo.
 * @returns {{destruir: Function}}
 */
export function montarPuerta(caja, { alEntrar } = {}) {
  const capa = document.createElement('div');
  capa.className = 'pu';
  capa.innerHTML = `
    <div class="pu-caja" tabindex="-1">
      <div class="pu-marca">
        <img src="/icons/plsdash-128x128.png" alt="" width="56" height="56" decoding="async">
      </div>
      <h1 class="pu-tit">Validator Dashboard</h1>
      <p class="pu-sub">Introduce tu PIN</p>

      <p class="pu-error" id="puError" role="status" aria-live="polite"></p>

      <div class="pu-zona" id="puZona">
        <svg class="pu-aro" viewBox="-80 -80 160 160" aria-hidden="true">
          <circle r="${RADIO}" pathLength="100"/>
        </svg>
        <span class="pu-centro" aria-hidden="true"></span>
        <span class="pu-sello" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" pathLength="100"/></svg></span>
        <div class="pu-puntos" id="puPuntos" role="img" aria-label="Ningún dígito introducido">
          ${Array.from({ length: LARGO }, () => '<span class="pu-punto"></span>').join('')}
        </div>
      </div>

      <div class="pu-pad" id="puPad">
        ${TECLAS.map(k => `
          <button type="button" class="pu-tecla${/^\d$/.test(k) ? '' : ' pu-tecla-sec'}"
                  data-k="${k}"${ROTULO[k] ? ` aria-label="${ROTULO[k]}"` : ''}
          >${ETIQUETA[k] || k}</button>`).join('')}
      </div>
    </div>`;
  caja.appendChild(capa);

  const puntos = capa.querySelector('#puPuntos');
  const zona = capa.querySelector('#puZona');
  const aro = capa.querySelector('.pu-aro circle');
  const centro = capa.querySelector('.pu-centro');
  const sello = capa.querySelector('.pu-sello');
  const check = capa.querySelector('.pu-sello path');
  const casillas = [...puntos.children];
  const error = capa.querySelector('#puError');
  const pad = capa.querySelector('#puPad');
  const teclas = [...pad.querySelectorAll('.pu-tecla')];

  let digitos = '';
  let enviando = false;

  function pintar() {
    [...puntos.children].forEach((p, i) => p.classList.toggle('lleno', i < digitos.length));
    /* El número de dígitos SE DICE, no solo se pinta. Cuatro puntos que se
       rellenan son invisibles para un lector de pantalla. */
    puntos.setAttribute('aria-label', digitos.length === 0
      ? 'Ningún dígito introducido'
      : `${digitos.length} de ${LARGO} dígitos introducidos`);
  }

  function reiniciar(msg) {
    digitos = '';
    pintar();
    error.textContent = msg || '';
    if (msg && reducido()) return;
    // Con anillo, el temblor ya lo ha hecho el anillo; en reducido, nada.
  }

  /* ── el anillo ────────────────────────────────────────────────────────── */
  let giro = null;
  const ponerEn = (c, x, y, extra = '') => { c.style.transform = `translate(${x}px, ${y}px)${extra}`; };
  casillas.forEach((c, i) => ponerEn(c, FILA[i], 0));

  /** Sube al anillo y empieza a girar. Devuelve cuando ya está girando. */
  async function subir() {
    if (reducido()) return;
    zona.dataset.anillo = '1';
    centro.animate([{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 280, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'forwards' });
    aro.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }],
      { duration: 480, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'forwards' });
    await Promise.all(casillas.map((c, i) => fin(c.animate(
      [{ transform: `translate(${FILA[i]}px, 0)` }, { transform: `translate(${ANILLO[i][0]}px, ${ANILLO[i][1]}px)` }],
      { duration: 420, delay: i * 45, easing: 'cubic-bezier(.3,1.35,.5,1)', fill: 'forwards' }))));
    casillas.forEach((c, i) => ponerEn(c, ANILLO[i][0], ANILLO[i][1]));
    casillas.forEach(c => c.getAnimations().forEach(a => a.cancel()));
    // La cuerda hacia atrás y luego vueltas sin fin hasta que conteste el servidor.
    await fin(puntos.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-18deg)' }],
      { duration: 160, easing: 'ease-out', fill: 'forwards' }));
    giro = puntos.animate([{ transform: 'rotate(-18deg)' }, { transform: 'rotate(342deg)' }],
      { duration: 620, iterations: Infinity, easing: 'linear' });
    puntos.getAnimations().filter(a => a !== giro).forEach(a => a.cancel());
  }

  /** Frena el giro en el siguiente cuarto de vuelta. Las casillas son iguales:
      parar en 90°, 180° o 270° se ve exactamente como parar en 0°. */
  async function frenar() {
    if (!giro) return;
    const m = new DOMMatrix(getComputedStyle(puntos).transform);
    const ahora = (Math.atan2(m.b, m.a) * 180 / Math.PI + 360) % 360;
    const destino = Math.ceil((ahora + 20) / 90) * 90;
    giro.cancel(); giro = null;
    await fin(puntos.animate([{ transform: `rotate(${ahora}deg)` }, { transform: `rotate(${destino}deg)` }],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }));
    puntos.getAnimations().forEach(a => a.cancel());
  }

  async function bien() {
    if (reducido()) return;
    await frenar();
    zona.dataset.estado = 'bien';
    for (const c of casillas) { c.classList.add('bien'); await espera(70); }
    await espera(160);
    casillas.forEach((c, i) => c.animate(
      [{ transform: `translate(${ANILLO[i][0]}px, ${ANILLO[i][1]}px)`, opacity: 1 },
       { transform: 'translate(0, 0) scale(.5)', opacity: 0 }],
      { duration: 320, easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' }));
    aro.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, fill: 'forwards' });
    await espera(240);
    await fin(sello.animate([{ opacity: 0, transform: 'scale(.4) rotate(-20deg)' }, { opacity: 1, transform: 'scale(1) rotate(0deg)' }],
      { duration: 380, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'forwards' }));
    await fin(check.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 280, easing: 'ease-out', fill: 'forwards' }));
    await espera(260);
    // El sello se hace punto: la semilla de la ignición.
    await fin(sello.animate([{ transform: 'scale(1)', borderRadius: '16px' }, { transform: 'scale(.1)', borderRadius: '50%' }],
      { duration: 300, easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' }));
  }

  async function mal() {
    if (reducido()) return;
    await frenar();
    zona.dataset.estado = 'mal';
    await fin(zona.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' },
      { transform: 'translateX(-6px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
      { duration: 420 }));
    await Promise.all(casillas.map((c, i) => fin(c.animate(
      [{ transform: `translate(${ANILLO[i][0]}px, ${ANILLO[i][1]}px)` }, { transform: `translate(${FILA[i]}px, 0)` }],
      { duration: 360, delay: i * 30, easing: 'cubic-bezier(.3,1.2,.5,1)', fill: 'forwards' }))));
    centro.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    await fin(aro.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 100 }], { duration: 260, fill: 'forwards' }));
    volverAFila();
  }

  function volverAFila() {
    [puntos, zona, centro, aro, sello, check, ...casillas].forEach(el => el.getAnimations().forEach(a => a.cancel()));
    giro = null;
    delete zona.dataset.anillo; delete zona.dataset.estado;
    casillas.forEach((c, i) => { c.classList.remove('bien'); ponerEn(c, FILA[i], 0); });
  }

  async function enviar() {
    enviando = true;
    teclas.forEach(b => { b.disabled = true; });
    // El giro y la petición a la vez: el giro ES la espera.
    const subiendo = subir();
    try {
      const res = await fetch(API + '/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: digitos }),
      });
      // Que dé al menos media vuelta: contestar en 40 ms no debe cortar el gesto.
      await subiendo; await espera(reducido() ? 0 : 300);
      if (res.ok) {
        await bien();
        /* Se quita ANTES de avisar: quien recibe el aviso va a montar la
           pantalla de carga encima, y dos capas a pantalla completa peleando
           por el mismo sitio es justo el tipo de solapamiento que luego cuesta
           media hora entender. */
        destruir();
        await alEntrar?.();
        return;
      }
      // 401 es el PIN; cualquier otra cosa es el servidor, y se distinguen
      // porque el remedio no es el mismo: reintentar vs mirar qué pasa.
      await mal();
      reiniciar(res.status === 401
        ? 'PIN incorrecto. Prueba otra vez.'
        : `El servidor respondió ${res.status}.`);
    } catch {
      await subiendo; await mal();
      reiniciar('No se pudo conectar. Revisa tu conexión.');
    } finally {
      enviando = false;
      teclas.forEach(b => { b.disabled = false; });
    }
  }

  function pulsar(k) {
    if (enviando) return;
    if (k === 'borrar') { digitos = digitos.slice(0, -1); pintar(); return; }
    /* «Salir» desde aquí devuelve a PLSDASH. Sin esto, quien llega a la URL sin
       sesión se queda en una pantalla sin salida visible. */
    if (k === 'salir') { window.location.href = '/'; return; }
    if (digitos.length >= LARGO) return;
    digitos += k;
    error.textContent = '';
    pintar();
    if (digitos.length === LARGO) enviar();
  }

  const alPulsar = ev => {
    const b = ev.target.closest('.pu-tecla');
    if (b) pulsar(b.dataset.k);
  };
  // En escritorio se espera poder teclear el PIN sin tocar el ratón.
  const alTeclear = ev => {
    if (ev.key >= '0' && ev.key <= '9') { pulsar(ev.key); ev.preventDefault(); }
    else if (ev.key === 'Backspace') { pulsar('borrar'); ev.preventDefault(); }
    else if (ev.key === 'Escape') { pulsar('salir'); ev.preventDefault(); }
  };

  pad.addEventListener('click', alPulsar);
  document.addEventListener('keydown', alTeclear);

  function destruir() {
    document.removeEventListener('keydown', alTeclear);
    [puntos, zona, centro, aro, sello, check, ...casillas].forEach(el => el.getAnimations().forEach(a => a.cancel()));
    capa.remove();
  }

  pintar();
  /* El foco entra en la CAJA, no en la primera tecla.
     ⚠ Enfocando el «1» —que es lo que hacía la primera versión— Chromium le
       pinta el aro de `:focus-visible` aunque nadie haya tocado el teclado, y
       en la captura a 390 se veía un teclado con el 1 marcado como si
       estuviera pulsado. Con la caja, el foco está dentro de la puerta —el
       tabulador sigue yendo a las teclas— y no hay ninguna resaltada. */
  capa.querySelector('.pu-caja')?.focus({ preventScroll: true });

  return { destruir, capa };
}
