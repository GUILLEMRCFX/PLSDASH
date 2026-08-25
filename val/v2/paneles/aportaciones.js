/**
 * Panel — Aportaciones: lo que has puesto tú.
 *
 * ## El problema que resuelve
 *
 * La wallet recibe PLS por dos caminos que la cadena no distingue: los barridos
 * del protocolo —lo GANADO— y las transferencias que haces tú —lo APORTADO—.
 * Mientras solo entraba lo primero daba igual. En cuanto empiezas a transferir
 * para llegar al siguiente validador, el panel enseñaba un saldo creciente sin
 * decir de dónde venía, y eso se lee como rendimiento.
 *
 * ## ⚠ EL SALDO NO ES «GANADO + APORTADO», Y AQUÍ NO SE FINGE QUE LO SEA
 *
 * Esa cuenta solo cuadraría si de la wallet no saliera nunca nada. Lo que hay
 * de verdad es:
 *
 *     saldo = ganado + aportado − lo que hayas sacado − gas
 *
 * `ganado` es todo lo barrido DESDE SIEMPRE, no lo que queda de ello. Así que
 * la resta puede salir negativa, y eso no es un error: es que has movido PLS
 * fuera. Se calcula el resto y **se enseña como tercera cantidad** en vez de
 * repartirlo entre las otras dos para que cuadre. Un desglose que siempre suma
 * exacto es un desglose que está mintiendo en algún sitio.
 *
 * ## Por qué el registro es manual
 *
 * Lo suyo sería leer las transferencias entrantes del explorador. Es justo lo
 * que hay aparcado: exige recorrer movimientos y emparejarlos, y no está
 * resuelto. A mano funciona hoy y es exacto, porque quien manda el PLS sabe
 * cuánto manda.
 */

import { fmt, fmtPrecio, escapar } from './formato.js';

export const TITULO = 'Aportaciones';

/** Por debajo de esto, el resto es gas y redondeo y no se enseña. */
const RUIDO_PLS = 1000;

/**
 * Reparte el saldo de la wallet entre sus orígenes.
 *
 * @returns {object|null} null si no hay saldo de la wallet — sin él no hay nada
 *   que repartir y decir lo contrario sería inventarse el todo.
 */
export function desglosarSaldo(datos) {
  const saldo = Number(datos?.ganancia?.saldo_wallet);
  if (!Number.isFinite(saldo)) return null;

  const ganado = Number(datos?.ganancia?.total) || 0;
  const aportado = Number(datos?.aportaciones?.total_pls) || 0;
  const resto = saldo - ganado - aportado;

  return {
    saldo, ganado, aportado,
    // Positivo: ha entrado algo que no está apuntado. Negativo: ha salido.
    resto,
    // Si es ruido, no se enseña: una tercera cifra por 12 PLS de gas estorba
    // más de lo que aclara.
    restoVisible: Math.abs(resto) >= RUIDO_PLS,
    // ⚠ Sin aportaciones registradas el reparto es «todo ganado», que es cierto
    //   solo si de verdad no has puesto nada. El panel lo dice con otras
    //   palabras en vez de dar por hecho que sí.
    hayRegistro: (datos?.aportaciones?.aportaciones || []).length > 0,
  };
}

/** «hace 3 días» / «12 ago». Corto: la fecha exacta va en el `title`. */
function cuando(ts, ahoraS) {
  const dias = Math.floor((ahoraS - ts) / 86400);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  return new Date(ts * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function panelAportaciones(datos) {
  const ap = datos?.aportaciones;
  const ahoraS = datos?.ahoraS || Math.floor(Date.now() / 1000);
  const hoy = new Date(ahoraS * 1000).toISOString().slice(0, 10);

  if (!ap) {
    return `
      <section class="panel" data-alerta aria-labelledby="pap-t">
        <header class="p-cab"><h2 id="pap-t">${TITULO}</h2></header>
        <p class="p-aviso">No se ha podido leer el registro de aportaciones.</p>
      </section>`;
  }

  const lista = ap.aportaciones || [];

  const filas = lista.map(a => {
    const usd = Number(a.precio_pls) > 0 ? Number(a.pls) * Number(a.precio_pls) : null;
    const fecha = new Date(Number(a.ts) * 1000);
    return `
      <li class="ap-fila">
        <span class="ap-cuando" title="${escapar(fecha.toLocaleString('es-ES'))}">${
          escapar(cuando(Number(a.ts), ahoraS))}</span>
        <span class="ap-pls">${fmt(Number(a.pls))}<span class="u">PLS</span></span>
        <span class="ap-usd">${
          usd != null
            ? `${fmt(usd, 2)} $ <span class="ap-precio">a ${escapar(fmtPrecio(a.precio_pls))}</span>`
            : '<span class="ap-precio">sin precio guardado</span>'
        }</span>
        <button type="button" class="ap-x" data-borrar="${a.id}"
                aria-label="Borrar la aportación de ${fmt(Number(a.pls))} PLS">×</button>
      </li>`;
  }).join('');

  return `
    <section class="panel" aria-labelledby="pap-t">
      <header class="p-cab">
        <h2 id="pap-t">${TITULO}</h2>
        ${lista.length
          ? `<span class="p-marca">${fmt(ap.total_pls)} PLS</span>`
          : ''}
      </header>

      <!-- El formulario primero: se abre este panel para apuntar algo, no para
           leer la lista. La lista es la comprobación de que se apuntó bien. -->
      <form class="ap-form" id="apForm" autocomplete="off">
        <label class="ap-campo">
          <span>Fecha</span>
          <input type="date" name="fecha" value="${hoy}" max="${hoy}" required>
        </label>
        <label class="ap-campo">
          <span>PLS aportados</span>
          <input type="number" name="pls" min="1" step="1" inputmode="numeric"
                 placeholder="1000000" required>
        </label>
        <button type="submit" class="ap-guardar">Apuntar</button>
      </form>
      <p class="ap-aviso" id="apAviso" role="status" aria-live="polite"></p>

      ${lista.length ? `
        <ul class="ap-lista">${filas}</ul>
        <p class="c-sub">
          ${fmt(ap.total_pls)} PLS aportados${
            ap.total_usd > 0 ? ` · ${fmt(ap.total_usd, 2)} $ al precio de cada día` : ''}${
            ap.sin_precio > 0
              ? ` · ${ap.sin_precio} sin precio guardado`
              : ''}.
        </p>`
      : `<p class="vacio">Todavía no has apuntado ninguna. Mientras esté vacío, el
         panel da por hecho que todo el saldo viene de validar.</p>`}
    </section>`;
}

/**
 * El formulario y los botones de borrar.
 *
 * Se vuelve a enganchar en cada repintado, como el resto: el HTML se regenera
 * entero cada 18 segundos.
 */
export function engancharAportaciones(raiz, repintar) {
  const form = raiz.querySelector('#apForm');
  const aviso = raiz.querySelector('#apAviso');
  const decir = (txt, mal = false) => {
    if (!aviso) return;
    aviso.textContent = txt;
    aviso.classList.toggle('mal', mal);
  };

  if (form) {
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const fd = new FormData(form);
      const pls = Number(fd.get('pls'));
      // `T12:00` y no medianoche: con medianoche local, en husos al este de
      // Greenwich la fecha se guardaba como el día anterior en UTC.
      const ts = Math.floor(new Date(`${fd.get('fecha')}T12:00:00`).getTime() / 1000);
      if (!(pls > 0)) return decir('Pon una cantidad mayor que cero.', true);

      const boton = form.querySelector('.ap-guardar');
      boton.disabled = true;
      decir('Apuntando…');
      try {
        const r = await fetch('/api/val/aportaciones', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ts, pls }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        decir(d.motivo_sin_precio === 'fecha_pasada'
          ? 'Apuntada. Sin valor en dólares: solo se guarda el precio de las que se apuntan el mismo día.'
          : d.motivo_sin_precio === 'sin_precio'
            ? 'Apuntada, pero no había precio de PLS en ese momento y no se ha guardado.'
            : 'Apuntada.');
        form.reset();
        repintar();
      } catch (e) {
        decir(`No se pudo apuntar: ${e.message}`, true);
      } finally {
        boton.disabled = false;
      }
    });
  }

  raiz.querySelectorAll('.ap-x').forEach(b => {
    b.addEventListener('click', async () => {
      // Sin ventana de confirmación: la lista es corta, se ve lo que se borra y
      // volver a apuntarlo son diez segundos. Un `confirm()` en cada línea
      // enseña a darle a «sí» sin leer.
      b.disabled = true;
      try {
        const r = await fetch(`/api/val/aportaciones?id=${encodeURIComponent(b.dataset.borrar)}`,
          { method: 'DELETE', credentials: 'same-origin' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        repintar();
      } catch (e) {
        b.disabled = false;
        decir(`No se pudo borrar: ${e.message}`, true);
      }
    });
  });
}
