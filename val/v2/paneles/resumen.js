/**
 * Pestaña 1 — Resumen.
 *
 * El panel que se mira veinte veces al día. Tiene que contestar dos preguntas
 * **sin desplazarse**:
 *
 *   ¿cuánto llevo?  → la cifra de portada, y el ritmo debajo.
 *   ¿va todo bien?  → la cabecera entera: el pulso de datos a la izquierda y la
 *                     palabra de estado a la derecha, en una sola línea.
 *
 * Todo lo demás está en las otras tres pestañas. Aquí no entra nada que no
 * responda a una de esas dos preguntas, por interesante que sea: cada línea de
 * más es una línea que empuja algo fuera de la primera pantalla en 390px, y
 * entonces deja de contestar sin desplazarse.
 *
 * ## El conmutador PLS/USD
 *
 * La cifra de portada es un `<button>`, no un `<span>` con un `click` encima.
 * Así llega el foco por teclado, la barra espaciadora y el enter funcionan sin
 * escribir nada, y el lector de pantalla la anuncia como lo que es. Un `div`
 * pinchable habría necesitado `role`, `tabindex` y dos manejadores de teclado
 * para llegar al mismo sitio.
 *
 * La elección se guarda en `localStorage`. Es una preferencia de lectura, no un
 * dato: si el navegador la pierde, se vuelve a PLS y no pasa nada.
 *
 * ⚠ El conmutador afecta SOLO a la portada. La tabla del ritmo enseña las dos
 *   unidades a la vez, en dos columnas, porque ahí la pregunta es «¿cuánto por
 *   periodo?» y comparar PLS con dólares en la misma fila es parte de la
 *   respuesta. Conmutarla también obligaría a tocar dos veces para ver algo que
 *   cabe entero.
 *
 * ## Qué se repite a propósito
 *
 * La palabra de estado sale también en el panel «Estado global» de la pestaña
 * Nodo, y el total generado sale también en «Ganancias». No es duplicación por
 * descuido: un resumen que no repite nada no es un resumen. Lo que NO se repite
 * es el detalle —de dónde sale el total, qué validador falla, cuánto lleva el
 * nodo en línea—, que es lo que hace falta cuando ya sabes que algo pasa.
 */

import { gananciaAcumulada, aprValidadorHora } from '/val/compartido/ganancias.js';
import { ACTIVACION_TS, saludGlobal } from '../datos.js';
import { fmt, fmtPrecio, escapar } from './formato.js';
import { tablaRitmo } from './ritmo.js';
import { htmlPulso, estadoPulso } from './pulso.js';

export const TITULO = 'Resumen';

/**
 * La palabra de estado, reconciliada con el pulso.
 *
 * `saludGlobal()` da por desfasado el dato a los 15 minutos; el pulso lo da por
 * tarde a los 4. Entre esas dos cifras hay una franja en la que el pulso decía
 * «SIN SEÑAL DESDE HACE 10:00» en naranja y, dos centímetros a la derecha, la
 * cabecera seguía diciendo «OPERATIVO» en verde. Los dos eran ciertos —el nodo
 * estaba bien la última vez que se supo de él— y juntos parecían un fallo del
 * panel.
 *
 * Aquí manda el pulso, porque es la pregunta que se hace de verdad: «¿esto que
 * estoy mirando es de ahora?». Los estados peores —sin sesión, sin datos,
 * desfasado, crítico— siguen ganándole: son más graves, no menos.
 *
 * ⚠ No se toca `saludGlobal()`: la usa también el panel «Estado global» de la
 *   pestaña Nodo, donde la pregunta es otra —cómo está la máquina— y los 15
 *   minutos son el umbral correcto.
 */
function palabraDeEstado(salud, pulsoTarde) {
  if (salud.tono !== 'ok' || !pulsoTarde) return salud;
  return { ...salud, palabra: 'SIN SEÑAL', tono: 'aviso',
           nota: 'El NUC no ha empujado dato nuevo en plazo. Lo de abajo es lo último que llegó.' };
}

const CLAVE = 'plsdash.v2.unidad';

/**
 * Unidad de la portada. Vive en el módulo y no en el DOM porque el panel se
 * repinta entero cada 15-20 s: guardarla en una clase del botón la perdería en
 * el primer refresco.
 */
let unidad = leerUnidad();

function leerUnidad() {
  try {
    return localStorage.getItem(CLAVE) === 'usd' ? 'usd' : 'pls';
  } catch {
    // Modo privado o almacenamiento bloqueado. No es un fallo: es PLS.
    return 'pls';
  }
}

function guardarUnidad(u) {
  try { localStorage.setItem(CLAVE, u); } catch { /* da igual */ }
}

export function panelResumen(datos) {
  const { estado, serie, ganancia, precio } = datos;

  // El pulso se evalúa con el reloj de verdad, no con `datos.ahoraS`: ese es
  // el instante en que se pidieron los datos y aquí lo que importa es cuánto
  // hace de eso ahora mismo.
  const pulso = estadoPulso(estado?.generado_ts, Math.floor(Date.now() / 1000));
  const salud = palabraDeEstado(saludGlobal(datos), pulso.tarde);
  const alerta = salud.tono !== 'ok';
  const v = estado?.validadores || {};

  const acum = gananciaAcumulada({ estado, ganancia, serie, activacionTs: ACTIVACION_TS });
  const hayPrecio = precio && precio.disponible !== false && precio.precio > 0;

  // El APR ponderado por validador-hora. Ver la nota larga en el módulo
  // compartido: la cuenta ingenua (`total / stake_total × 8760`) miente en
  // cuanto los validadores tienen distinta antigüedad, y aquí la tienen.
  const deposito = Number(v.total) > 0 ? Number(v.stake_total) / Number(v.total) : null;
  const apr = acum ? aprValidadorHora({
    total: acum.total, detalle: v.detalle || [], deposito, ahoraS: datos.ahoraS,
  }) : null;

  const ritmo = tablaRitmo(datos);

  // ── la portada ────────────────────────────────────────────────────────────
  // Sin precio no hay dólares que enseñar, así que el conmutador desaparece y
  // la cifra vuelve a ser un número. Un botón que no conmuta nada es peor que
  // ningún botón.
  const conmutable = acum != null && hayPrecio;
  const enUsd = conmutable && unidad === 'usd';

  const portada = acum == null
    ? '<span class="p-num" aria-disabled="true">–</span>'
    : conmutable
      ? `<button type="button" class="p-num" data-unidad="${unidad}"
                 aria-label="Total generado: ${
                   enUsd ? `${fmt(acum.total * precio.precio, 2)} dólares`
                         : `${fmt(acum.total)} PLS`
                 }. Pulsa para cambiar de unidad.">${
          enUsd ? `${fmt(acum.total * precio.precio, 2)}<span class="u">USD</span>`
                : `${fmt(acum.total)}<span class="u">PLS</span>`
        }</button>`
      : `<span class="p-num">${fmt(acum.total)}<span class="u">PLS</span></span>`;

  // El pie cabe en una línea a 390px. «Toca para ver en dólares» la partía en
  // dos y el panel crecía 24px justo donde no sobran.
  const pie = acum == null
    ? 'Sin datos para calcular el total'
    : conmutable
      ? `Total generado · toca para ${enUsd ? 'PLS' : '$'}`
      : 'Total generado · sin precio de PLS';

  // ── el pie de datos ───────────────────────────────────────────────────────
  // Tres cifras que caben en una línea y no necesitan explicación. El APR se
  // marca en verde cuando existe porque es la única de las tres que es un
  // resultado y no una constatación.
  const aprTxt = apr
    ? `<dd class="bien">${fmt(apr.pct, 2)}<span class="u pct">%</span></dd>`
    : '<dd>–</dd>';

  const faltanActivaciones = apr && !apr.deTodos;
  const fueraDeServicio = Number(v.total) - Number(v.activos) > 0;

  return `
    <section class="panel resumen"${alerta ? ' data-alerta' : ''} aria-labelledby="prs-t">
      <header class="p-cab">
        <!-- El título va oculto a la vista pero presente para el lector de
             pantalla: la pestaña activa ya pone «RESUMEN» tres centímetros más
             arriba, y repetirlo gastaba una línea entera del único panel que
             tiene prohibido desplazarse. La fila la ocupan las dos cosas que
             sí hacen falta: si el dato es de ahora, y si algo va mal. -->
        <h2 id="prs-t" class="oculto">${TITULO}</h2>
        ${htmlPulso(datos)}
        <span class="p-marca ${alerta ? 'alerta' : 'bien'}">${escapar(salud.palabra)}</span>
      </header>

      ${salud.nota ? `<p class="p-aviso">${escapar(salud.nota)}</p>` : ''}

      <div class="portada">
        ${portada}
        <span class="p-pie">${escapar(pie)}</span>
      </div>

      ${ritmo
        ? ritmo.html
        : '<p class="vacio">Sin ritmo medible todavía.</p>'}

      <dl class="p-fondo">
        <div><dt>Rendimiento</dt>${aprTxt}</div>
        <div><dt>Validadores</dt><dd${fueraDeServicio ? ' class="alerta"' : ''}>${
          fmt(v.activos)} / ${fmt(v.total)}</dd></div>
        <div><dt>Precio</dt><dd>${hayPrecio ? `${fmtPrecio(precio.precio)} $` : '–'}</dd></div>
      </dl>

      <p class="c-sub">${
        ritmo ? escapar(ritmo.nota) : 'Aún no hay tramo medido suficiente para proyectar.'
      }${faltanActivaciones
        ? ` El rendimiento sale de ${fmt(apr.conActivacion)} de ${fmt(v.detalle.length)} validadores:`
          + ' del resto no se conoce la hora de activación.'
        : ''}</p>
    </section>`;
}

/**
 * Engancha el conmutador. Hay que volver a llamarla en cada repintado, igual
 * que `engancharCiclo`: el HTML se regenera entero.
 *
 * @param {Function} repintar  Se llama tras cambiar la unidad. El panel se
 *   redibuja con los datos que ya hay en memoria — no se vuelve a pedir nada a
 *   la red por tocar un botón.
 */
export function engancharResumen(raiz, repintar) {
  const b = raiz.querySelector('.p-num[data-unidad]');
  if (!b) return;
  b.addEventListener('click', () => {
    unidad = unidad === 'pls' ? 'usd' : 'pls';
    guardarUnidad(unidad);
    repintar();
  });
}
