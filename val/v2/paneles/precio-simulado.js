/**
 * Panel — Si PLS valiera otra cosa.
 *
 * La otra pregunta del dinero. El deslizador del validador contesta «¿cuánto
 * tardo?»; esta contesta «¿cuánto vale esto, y a qué precio dejo de perder?».
 *
 * Un deslizador de PRECIO, y debajo: qué vale el stake, qué vale lo ganado, qué
 * valdría un año a ese precio, y cuánto falta para volver al precio del
 * sacrificio.
 *
 * ## El precio del sacrificio es una constante, y es deliberado
 *
 * Antes se guardaba en D1 vía `/api/val/ajustes`, con su plegable, su campo y su
 * botón de guardar dentro del panel. Se ha quitado entero —endpoint incluido—
 * porque el dato no cambia: el sacrificio de PulseChain ocurrió una vez, a un
 * precio que ya pasó. Un ajuste editable para un número que no se va a volver a
 * editar es un formulario que ocupa sitio, una tabla que mantener y un endpoint
 * más que puede fallar, a cambio de nada.
 *
 * Que quede claro por qué esto NO es el vicio del `V11 = 32_000_000` que sí se
 * quitó: aquel era un parámetro VIVO —el depósito puede cambiar y el número
 * mentiría en silencio— y aquí se calcula. Éste es un hecho cerrado del pasado.
 * Escribir a fuego lo que ya no puede cambiar no tiene ningún riesgo; escribir a
 * fuego lo que cambia, sí.
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

/**
 * El precio del sacrificio, en dólares. Fijo y no editable: ver la cabecera.
 *
 * 0,0001, el mismo que lleva el v1, y cerrado.
 *
 * ⚠ Y AQUÍ ESTÁ EL MEJOR ARGUMENTO PARA QUE SEA UNA CONSTANTE. En la tabla de
 *   ajustes había guardado un 0,001 — un cero de menos, tecleado a mano en su
 *   día— y con él el panel daba −98,6 % y ×70 donde el v1 daba −85,7 % y ×7,0.
 *   Un factor de diez en la cifra de cabecera, sin que nada avisara, porque un
 *   campo de texto acepta lo que le pongas. Comprobado contra el gráfico de
 *   WPLS/DAI: 0,0001 es donde estuvo, con el precio de ahora en 0,0₄1092.
 */
export const SACRIFICIO = 0.0001;

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
 * @param entrada El precio de referencia. Por omisión el del sacrificio, que es
 *   lo único contra lo que se compara ya. Sigue siendo un parámetro para poder
 *   probar la cuenta con números a mano sin depender de la constante.
 */
export function valorar({ precio, stakePls, ganadoPls, plsDia, entrada = SACRIFICIO }) {
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

  const r = valorar({
    precio: real, stakePls: v.stake_total, ganadoPls: acum ? acum.total : null,
    plsDia: ritmo?.pls_dia,
  });

  const pos = posicionDe(real);

  return `
    <section class="panel" aria-labelledby="pps-t">
      <header class="p-cab">
        <h2 id="pps-t">${TITULO}</h2>
        <!-- Los dos precios que importan, como atajos. No son ajustes: son los
             dos sitios del carril a los que uno quiere volver. -->
        <div class="ps-atajos">
          <button type="button" class="p-marca ps-ir" id="psAhora"
                  title="Llevar el deslizador al precio de ahora">ahora</button>
          <button type="button" class="p-marca ps-ir" id="psSacrificio"
                  title="Llevar el deslizador al precio del sacrificio: ${escapar(fmtPrecio(SACRIFICIO))} $">sacrificio</button>
        </div>
      </header>

      <div class="ps-valor" id="psPrecio">${escapar(fmtPrecio(real))}<span class="u">$</span></div>

      <div class="ps-mando">
        <input type="range" class="sim-rango ps-rango" id="psRango"
               style="--t:${(pos / PASOS * 100).toFixed(1)}%"
               min="0" max="${PASOS}" step="1" value="${pos}"
               aria-label="Precio de PLS simulado"
               aria-valuetext="${escapar(fmtPrecio(real))} dólares">
        <!-- Las DOS marcas, en la misma escala logarítmica que el mando: así no
             se descuadran si algún día cambia el rango. La de «ahora» se mueve
             con el precio en cada repintado; la del sacrificio no se mueve
             nunca. Antes solo se veía una y no había forma de situar la otra. -->
        ${marcas(real)}
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
    </section>`;
}

/**
 * Las dos rayitas del carril. Se saca aparte porque la de «ahora» hay que
 * recolocarla cuando llega un precio nuevo, sin tocar el resto del panel.
 *
 * El `left` va en la escala del mando, no en la del precio: es la misma cuenta
 * que `posicionDe`, así que las marcas y el pulgar caen en el mismo sitio por
 * construcción y no por coincidencia.
 */
export function marcas(real) {
  const uno = (clase, p, texto) =>
    `<span class="ps-marca ${clase}" style="--p:${(posicionDe(p) / PASOS).toFixed(4)}"
           title="${escapar(texto)}: ${escapar(fmtPrecio(p))} $" aria-hidden="true"></span>`;
  return (real != null && real > 0 ? uno('ps-marca-ahora', real, 'Precio de ahora') : '')
    + uno('ps-marca-sac', SACRIFICIO, 'Precio del sacrificio');
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
    /* El subtítulo NOMBRA la referencia. Antes decía «para volver» a secas
       porque el precio de entrada lo había escrito el propio usuario y lo tenía
       en la cabeza; ahora es una constante, así que la cifra tiene que decir
       contra qué se compara o se convierte en un porcentaje sin origen. */
    const ref = `${escapar(fmtPrecio(r.entrada))} $`;
    partes.push(fila(
      'Frente a tu entrada',
      `<span class="${baja ? 'ps-baja' : 'ps-sube'}">${
        r.vsEntrada > 0 ? '+' : ''}${fmt(r.vsEntrada, 1)}<span class="u pct">%</span></span>`,
      r.paraVolver
        ? `necesita ×${escapar(fmt(r.paraVolver, r.paraVolver < 10 ? 1 : 0))} para volver a ${ref}`
        : `por encima del sacrificio, ${ref}`));
  }
  return partes.join('');
}

/**
 * El deslizador y los dos atajos.
 *
 * ⚠ Recalcula EN EL SITIO, como el del validador y por el mismo motivo: el
 *   panel se regenera cada 18 segundos y un repintado en mitad de un arrastre
 *   devolvería el mando a donde estaba el HTML.
 */
export function engancharPrecioSimulado(raiz, datos) {
  const mando = raiz.querySelector('#psRango');
  if (!mando) return;

  const { estado, serie, snapshots24h, ganancia, precio } = datos;
  const v = estado?.validadores || {};
  const real = Number(precio?.precio) || null;
  const acum = gananciaAcumulada({ estado, ganancia, serie, activacionTs: ACTIVACION_TS });
  const ritmo = ritmoDiario({ serie, snapshots24h, plsDiaKV: v.pls_dia, fmt });

  const salida = raiz.querySelector('#psPrecio');
  const caja = raiz.querySelector('#psCifras');

  /* `exacto` evita el redondeo de la escala cuando se sabe el precio de
     verdad: al arrancar y al pulsar «ahora». Sin él, volver a «ahora» dejaba el
     panel en el precio de la posición más cercana, que no es el mismo. */
  const pintar = (exacto = null) => {
    const p = exacto != null ? exacto : precioDesde(mando.value);
    const r = valorar({
      precio: p, stakePls: v.stake_total, ganadoPls: acum ? acum.total : null,
      plsDia: ritmo?.pls_dia,
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

  /* Los dos atajos. Los dos llevan el precio EXACTO por `pintar(p)` y no el que
     salga de la posición: la escala tiene 4000 pasos, así que redondear al paso
     más cercano desplaza el precio un 0,2 % y el panel se marcaría «simulado»
     nada más pulsar «ahora», que es justo lo contrario de lo que hace el botón. */
  const irA = (boton, p) => {
    if (!boton || !(p > 0)) return;
    boton.addEventListener('click', () => {
      mando.value = String(posicionDe(p));
      pintar(p);
    });
  };
  irA(raiz.querySelector('#psAhora'), real);
  irA(raiz.querySelector('#psSacrificio'), SACRIFICIO);
}
