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
 */

const API = '/api/val';
const LARGO = 4;

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

      <div class="pu-puntos" id="puPuntos" role="img" aria-label="Ningún dígito introducido">
        ${Array.from({ length: LARGO }, () => '<span class="pu-punto"></span>').join('')}
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
    if (msg && !reducido()) {
      puntos.classList.remove('mal');
      void puntos.offsetWidth;            // reinicia la animación
      puntos.classList.add('mal');
    }
  }

  async function enviar() {
    enviando = true;
    teclas.forEach(b => { b.disabled = true; });
    try {
      const res = await fetch(API + '/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: digitos }),
      });
      if (res.ok) {
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
      reiniciar(res.status === 401
        ? 'PIN incorrecto. Prueba otra vez.'
        : `El servidor respondió ${res.status}.`);
    } catch {
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
