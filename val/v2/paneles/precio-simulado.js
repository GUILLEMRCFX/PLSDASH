/**
 * Panel — Si PLS valiera otra cosa.
 *
 * La otra pregunta del dinero. El deslizador del validador contesta «¿cuánto
 * tardo?»; esta contesta «¿cuánto vale esto, y a qué precio dejo de perder?».
 *
 * Un deslizador de PRECIO, y debajo: qué vale el stake, qué vale lo ganado, qué
 * valdría un año a ese precio, y cuánto falta para volver al precio de entrada.
 *
 * ## ⚠ EL PRECIO DE ENTRADA NO ESTÁ ESCRITO AQUÍ
 *
 * El v1 lo lleva así:
 *
 *     const PRECIO_SACRIFICIO = 0.0001;   // en el código
 *
 * Y es peor vicio que el `V11 = 32_000_000` que ya se quitó, porque el depósito
 * al menos es un parámetro público del protocolo. Esto no: es a qué precio
 * entró UNA persona, y esa persona es la única que lo sabe. Escribirlo en un
 * fichero que hay que desplegar para cambiarlo es ponerle una fecha de
 * caducidad a un dato que no debería tenerla.
 *
 * Aquí se guarda en D1 vía `/api/val/ajustes`, se edita desde el propio panel y
 * viaja entre dispositivos. Mientras no se ponga, el panel enseña el valor y
 * calla sobre el breakeven — en vez de compararlo contra un número inventado.
 *
 * ## La escala del deslizador
 *
 * Logarítmica, y aquí no es una mejora sino la única opción: PLS ha cotizado
 * entre 1e-5 y 1e-3, dos órdenes de magnitud. En escala lineal el precio de hoy
 * viviría aplastado contra el cero y el 99 % del recorrido sería territorio que
 * nunca ha pisado.
 *
 * ## Qué NO se proyecta
 *
 * La proyección a un año valora lo que se GANARÁ al ritmo medido, al precio del
 * deslizador. No supone que el ritmo cambie con el precio, y eso es una
 * simplificación consciente: las recompensas son en PLS y no dependen de lo que
 * valga el PLS, pero el número de validadores de la red sí puede moverse con el
 * precio, y eso sí cambiaría el ritmo. Está fuera de lo que se puede saber.
 */

import { gananciaAcumulada, ritmoDiario } from '/val/compartido/ganancias.js';
import { ACTIVACION_TS } from '../datos.js';
import { fmt, fmtPrecio, escapar } from './formato.js';

export const TITULO = 'Si PLS valiera otra cosa';

/* El rango del deslizador, en dólares. Cubre de 1e-6 a 1e-2: cuatro órdenes de
   magnitud alrededor de donde ha vivido PLS, con sitio arriba y abajo. */
export const MIN = 1e-6;
export const MAX = 1e-2;
/* ⚠ 4000 y no 1000. Con mil pasos sobre cuatro órdenes de magnitud, cada paso
   es un factor de 10^(4/1000) = 1,0092: casi un 1 % de resolución. Suena poco
   hasta que se ve el efecto — el precio real de 0,0₄1426 caía en una posición
   que devolvía 0,0₄1432, así que el panel arrancaba enseñando un precio que NO
   era el real y marcándose «simulado» sin que nadie hubiera tocado nada.
   Con 4000 el paso baja al 0,23 %, y además la función de pintado acepta el
   precio exacto para no tener que redondearlo al volver a «ahora». */
export const PASOS = 4000;

/** Posición (0..PASOS) → precio. Logarítmica: ver la nota de arriba. */
export function precioDesde(pos) {
  const t = Math.max(0, Math.min(1, Number(pos) / PASOS));
  return MIN * Math.pow(MAX / MIN, t);
}

/** Precio → posición. La inversa. */
export function posicionDe(precio) {
  const p = Math.max(MIN, Math.min(MAX, Number(precio) || MIN));
  return Math.round((Math.log(p / MIN) / Math.log(MAX / MIN)) * PASOS);
}

/**
 * Las cuatro cifras, sin DOM para poder probarlas con números a mano.
 *
 * @param entrada El precio al que se entró, o null si no se ha puesto. Cuando
 *   es null, `vsEntrada` sale null y el panel calla en vez de comparar contra
 *   un número inventado.
 */
export function valorar({ precio, stakePls, ganadoPls, plsDia, entrada }) {
  const p = Number(precio);
  if (!Number.isFinite(p) || p <= 0) return null;

  const stake = Number(stakePls) > 0 ? Number(stakePls) * p : null;
  const ganado = Number(ganadoPls) >= 0 ? Number(ganadoPls) * p : null;
  /* ⚠ Es lo que habrá DENTRO de un año, no lo que se gana en un año: lo ya
     ganado MÁS lo que caerá. El v1 hace la misma suma pero la rotula
     «Proyección 1 año», que se lee como lo segundo y no lo es. Aquí la cifra
     es la del v1 y la etiqueta dice lo que de verdad hay dentro.

     365,25 y no 365 como el v1: el cuarto de día es el año bisiesto, y es el
     mismo número que usa el resto del proyecto. Sobre esta cifra la diferencia
     es de 0,07 %. */
  const enUnAno = Number(plsDia) > 0 && Number(ganadoPls) >= 0
    ? (Number(ganadoPls) + Number(plsDia) * 365.25) * p : null;

  const e = Number(entrada);
  const hayEntrada = Number.isFinite(e) && e > 0;

  return {
    precio: p, stake, ganado, enUnAno,
    // Cuánto se ha movido respecto al precio de entrada, y cuánto haría falta
    // para volver. El «×7,0» dice más que el «−85,7 %»: uno es la distancia
    // recorrida y el otro la que queda.
    vsEntrada: hayEntrada ? (p / e - 1) * 100 : null,
    paraVolver: hayEntrada && p < e ? e / p : null,
    entrada: hayEntrada ? e : null,
  };
}

function fila(etiqueta, valor, extra = '') {
  return `
    <div class="cifra">
      <span class="c-num">${valor}</span>
      <span class="c-eti">${escapar(etiqueta)}</span>
      ${extra ? `<span class="c-sub">${extra}</span>` : ''}
    </div>`;
}

export function panelPrecioSimulado(datos) {
  const { estado, serie, snapshots24h, ganancia, precio } = datos;
  const v = estado?.validadores || {};

  const real = precio && precio.disponible !== false && precio.precio > 0
    ? Number(precio.precio) : null;
  if (real == null) {
    return `
      <section class="panel" aria-labelledby="pps-t">
        <header class="p-cab"><h2 id="pps-t">${TITULO}</h2></header>
        <p class="vacio">Sin precio de PLS: no hay desde dónde partir.</p>
      </section>`;
  }

  const acum = gananciaAcumulada({ estado, ganancia, serie, activacionTs: ACTIVACION_TS });
  const ritmo = ritmoDiario({ serie, snapshots24h, plsDiaKV: v.pls_dia, fmt });
  const entrada = Number(datos.ajustes?.precio_entrada?.valor) || null;

  const r = valorar({
    precio: real, stakePls: v.stake_total, ganadoPls: acum ? acum.total : null,
    plsDia: ritmo?.pls_dia, entrada,
  });

  const pos = posicionDe(real);
  const marca = posicionDe(entrada || real);

  return `
    <section class="panel" aria-labelledby="pps-t">
      <header class="p-cab">
        <h2 id="pps-t">${TITULO}</h2>
        <button type="button" class="p-marca ps-volver" id="psAhora"
                title="Volver al precio de ahora">ahora</button>
      </header>

      <div class="ps-valor" id="psPrecio">${escapar(fmtPrecio(real))}<span class="u">$</span></div>

      <div class="ps-mando">
        <input type="range" class="sim-rango ps-rango" id="psRango"
               style="--t:${(pos / PASOS * 100).toFixed(1)}%"
               min="0" max="${PASOS}" step="1" value="${pos}"
               aria-label="Precio de PLS simulado"
               aria-valuetext="${escapar(fmtPrecio(real))} dólares">
        ${entrada ? `
        <!-- La marca de por dónde entraste, en la misma escala que el mando:
             así no se descuadra si algún día cambia el rango. -->
        <span class="ps-marca" style="left:${(marca / PASOS * 100).toFixed(1)}%"
              title="Tu precio de entrada: ${escapar(fmtPrecio(entrada))} $"
              aria-hidden="true"></span>` : ''}
        <!-- Los extremos en potencias de diez y no con el formateador de
             precios, que para 1e-6 daba «0,0₅1000» y para 1e-2 «0,010000»: dos
             formatos distintos en los dos extremos de la misma escala, y
             ninguno legible de un vistazo. Aquí hace falta el orden de
             magnitud, no la precisión. -->
        <div class="sim-topes" aria-hidden="true">
          <span>0,000001 $</span><span>0,01 $</span>
        </div>
      </div>

      <div class="rejilla" id="psCifras">${cifras(r)}</div>

      <!-- El precio de entrada, editable. Va plegado porque se toca una vez en
           la vida, y NO está escrito en el código a propósito: ver la cabecera
           de este fichero. -->
      <details class="ps-desp">
        <summary class="ap-abrir ps-abrir">${entrada
          ? `Entraste a ${escapar(fmtPrecio(entrada))} $ · cambiar`
          : 'Pon tu precio de entrada para ver cuánto falta para volver'}</summary>
        <form class="ps-form" id="psForm" autocomplete="off">
          <label class="ap-campo">
            <span>Precio de entrada, en dólares</span>
            <input type="number" name="entrada" step="any" min="0" max="0.99"
                   inputmode="decimal" placeholder="por ejemplo 0,00012"
                   value="${entrada || ''}" required>
          </label>
          <button type="submit" class="ap-guardar ps-guardar">Guardar</button>
        </form>
        <p class="ap-aviso" id="psAviso" role="status" aria-live="polite"></p>
        <p class="c-sub">Es a qué precio compraste o entró tu sacrificio. Solo lo
          sabes tú, así que no está escrito en ninguna parte del código: se guarda
          con tus datos y vale para todos tus dispositivos.</p>
      </details>
    </section>`;
}

/** El bloque de cifras. Se reescribe solo al mover el deslizador. */
export function cifras(r) {
  if (!r) return '';
  const partes = [];
  if (r.stake != null) partes.push(fila('Vale el stake', `${fmt(r.stake, 2)}<span class="u">$</span>`));
  if (r.ganado != null) partes.push(fila('Vale lo ganado', `${fmt(r.ganado, 2)}<span class="u">$</span>`));
  if (r.enUnAno != null) partes.push(fila('Dentro de un año',
    `${fmt(r.enUnAno, 2)}<span class="u">$</span>`, 'al ritmo de ahora, a este precio'));

  if (r.vsEntrada != null) {
    const baja = r.vsEntrada < 0;
    partes.push(fila(
      'Frente a tu entrada',
      `<span class="${baja ? 'ps-baja' : 'ps-sube'}">${
        r.vsEntrada > 0 ? '+' : ''}${fmt(r.vsEntrada, 1)}<span class="u pct">%</span></span>`,
      r.paraVolver
        ? `necesita ×${escapar(fmt(r.paraVolver, r.paraVolver < 10 ? 1 : 0))} para volver`
        : 'por encima del precio al que entraste'));
  }
  return partes.join('');
}

/**
 * El deslizador y el formulario del precio de entrada.
 *
 * ⚠ Recalcula EN EL SITIO, como el del validador y por el mismo motivo: el
 *   panel se regenera cada 18 segundos y un repintado en mitad de un arrastre
 *   devolvería el mando a donde estaba el HTML.
 */
export function engancharPrecioSimulado(raiz, datos, refrescar) {
  const mando = raiz.querySelector('#psRango');
  if (!mando) return;

  const { estado, serie, snapshots24h, ganancia, precio } = datos;
  const v = estado?.validadores || {};
  const real = Number(precio?.precio) || null;
  const acum = gananciaAcumulada({ estado, ganancia, serie, activacionTs: ACTIVACION_TS });
  const ritmo = ritmoDiario({ serie, snapshots24h, plsDiaKV: v.pls_dia, fmt });
  const entrada = Number(datos.ajustes?.precio_entrada?.valor) || null;

  const salida = raiz.querySelector('#psPrecio');
  const caja = raiz.querySelector('#psCifras');

  /* `exacto` evita el redondeo de la escala cuando se sabe el precio de
     verdad: al arrancar y al pulsar «ahora». Sin él, volver a «ahora» dejaba el
     panel en el precio de la posición más cercana, que no es el mismo. */
  const pintar = (exacto = null) => {
    const p = exacto != null ? exacto : precioDesde(mando.value);
    const r = valorar({
      precio: p, stakePls: v.stake_total, ganadoPls: acum ? acum.total : null,
      plsDia: ritmo?.pls_dia, entrada,
    });
    salida.innerHTML = `${fmtPrecio(p)}<span class="u">$</span>`;
    mando.setAttribute('aria-valuetext', `${fmtPrecio(p)} dólares`);
    mando.style.setProperty('--t', `${(Number(mando.value) / PASOS * 100).toFixed(1)}%`);
    caja.innerHTML = cifras(r);
    // Marcado cuando NO está en el precio real: así se sabe que lo que se mira
    // es una hipótesis y no el dato.
    salida.classList.toggle('simulado', real != null && Math.abs(p / real - 1) > 0.01);
  };
  /* ⚠ `() => pintar()` y NO `pintar` a secas. Un manejador recibe el EVENTO
     como primer argumento, así que pasando la función directamente el evento
     entraba por el parámetro `exacto` y el precio salía NaN: el panel enseñaba
     «–» y las cifras se quedaban en blanco en cuanto se tocaba el deslizador.
     Solo apareció al darle a `pintar` un parámetro opcional. */
  mando.addEventListener('input', () => pintar());

  const volver = raiz.querySelector('#psAhora');
  if (volver && real != null) {
    volver.addEventListener('click', () => {
      mando.value = String(posicionDe(real));
      pintar(real);
    });
  }

  const form = raiz.querySelector('#psForm');
  const aviso = raiz.querySelector('#psAviso');
  if (form) {
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const val = Number(new FormData(form).get('entrada'));
      if (!(val > 0 && val < 1)) {
        aviso.textContent = 'Tiene que ser un precio en dólares mayor que cero.';
        aviso.classList.add('mal');
        return;
      }
      const boton = form.querySelector('.ps-guardar');
      boton.disabled = true;
      aviso.classList.remove('mal');
      aviso.textContent = 'Guardando…';
      try {
        const res = await fetch('/api/val/ajustes', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ precio_entrada: val }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
        aviso.textContent = 'Guardado.';
        // Vuelve a PEDIR: el ajuste vive en D1, no en `datos`.
        refrescar();
      } catch (e) {
        aviso.textContent = `No se pudo guardar: ${e.message}`;
        aviso.classList.add('mal');
      } finally {
        boton.disabled = false;
      }
    });
  }
}
