/**
 * Panel — Precio de PLS, con su histórico.
 *
 * ## De dónde sale cada cosa
 *
 * El precio de AHORA sale de `/api/precio`, que es el mismo endpoint que usa la
 * portada pública y el que llama el recolector. Un solo camino, un solo precio:
 * si aquí saliera otro número que en `plsdash.com`, la pregunta siguiente sería
 * cuál de los dos creer.
 *
 * El HISTÓRICO sale de `snapshots.precio_pls`, que el recolector escribe en
 * cada pasada horaria. No hay más sitio de donde sacarlo: DexScreener no da
 * serie histórica en el plan gratuito, así que el histórico es exactamente el
 * que se haya ido guardando y ni un minuto más. Se dice cuánto abarca en vez de
 * fingir una ventana fija.
 *
 * ⚠ Las filas anteriores a que el recolector empezara a guardar el precio
 *   tienen `precio_pls` a NULL. Se filtran en el endpoint (`?rango=precio`), no
 *   aquí: si se filtrasen aquí, cualquier otro consumidor tendría que acordarse
 *   de hacerlo, y tarde o temprano uno no se acordaría y dibujaría una caída a
 *   cero preciosa.
 *
 * ## El dibujo
 *
 * Línea con área, no barras: es una magnitud continua muestreada cada hora, y
 * las barras insinuarían que cada hora es una unidad con su propio valor.
 *
 * El eje vertical NO empieza en cero. A 0,00001 $ el PLS, un eje desde cero
 * dejaría la línea aplastada contra el borde superior y todo el movimiento
 * —que en estos días ha sido de un 47%— cabría en dos píxeles. Se encuadra en
 * el rango observado con un 8% de aire arriba y abajo. Es la decisión correcta
 * para una serie de precio y la incorrecta para una de volumen; por eso se
 * escribe aquí, para que nadie la copie sin pensar.
 *
 * El color de la línea sigue la dirección de la ventana entera —verde si sube,
 * naranja si baja— y NUNCA va solo: al lado hay siempre el porcentaje con su
 * signo. Quien no distinga los dos colores lee el mismo dato en el número.
 */

import { fmt, fmtPrecio, fmtEdad, escapar } from './formato.js';

export const TITULO = 'Precio de PLS';

const ALTO = 60;      // unidades del viewBox; el ancho es 100 y escala solo
const ANCHO = 100;
const AIRE = 0.08;    // margen vertical sobre el rango observado

/**
 * Encuadra la serie en el viewBox.
 * @returns {object|null} null si no hay al menos dos puntos.
 */
function trazar(serie) {
  const pts = serie
    .map(p => ({ ts: Number(p.ts), v: Number(p.precio_pls) }))
    .filter(p => Number.isFinite(p.ts) && Number.isFinite(p.v) && p.v > 0);
  if (pts.length < 2) return null;

  const min = Math.min(...pts.map(p => p.v));
  const max = Math.max(...pts.map(p => p.v));
  const t0 = pts[0].ts;
  const t1 = pts[pts.length - 1].ts;
  const span = Math.max(1, t1 - t0);

  // Si el precio no se ha movido nada, `max - min` es cero y la escala se va al
  // infinito. Se le da un rango artificial y la línea queda plana en el centro,
  // que es exactamente lo que ha pasado.
  const rango = max - min || max * 0.02 || 1;
  const bajo = min - rango * AIRE;
  const alto = max + rango * AIRE;

  const x = t => ((t - t0) / span) * ANCHO;
  const y = v => ALTO - ((v - bajo) / (alto - bajo)) * ALTO;

  const coords = pts.map(p => `${x(p.ts).toFixed(2)},${y(p.v).toFixed(2)}`);

  return {
    linea: coords.join(' '),
    // El área se cierra por abajo del viewBox, no por el mínimo: cerrar por el
    // mínimo dejaría una franja vacía bajo la línea que se lee como un suelo
    // que no existe.
    area: `0,${ALTO} ${coords.join(' ')} ${ANCHO},${ALTO}`,
    min, max, desde: t0, hasta: t1, n: pts.length,
    primero: pts[0].v,
    final: pts[pts.length - 1].v,
  };
}

/** Segundos de ventana → «4,5 días» o «19 h». */
const fmtVentana = s =>
  s >= 48 * 3600 ? `${fmt(s / 86400, 1)} días` : `${fmt(s / 3600, 0)} h`;

/** Porcentaje con signo explícito. El signo es el que lleva la información. */
const fmtPct = p => `${p >= 0 ? '+' : '−'}${fmt(Math.abs(p), 2)} %`;

export function panelPrecio(datos) {
  const { precio, precioSerie } = datos;

  const hayPrecio = precio && precio.disponible !== false && precio.precio > 0;
  const precioViejo = hayPrecio && precio.obsoleto;

  if (!hayPrecio && !(precioSerie || []).length) {
    return `
      <section class="panel" data-alerta aria-labelledby="ppr-t">
        <header class="p-cab"><h2 id="ppr-t">${TITULO}</h2></header>
        <p class="p-aviso">Sin precio de PLS: ni el endpoint responde ni hay histórico guardado.</p>
      </section>`;
  }

  const d = trazar(precioSerie || []);

  // El cambio de 24 h es el de DexScreener cuando lo hay: es su ventana móvil
  // exacta, mejor que restar dos snapshots horarios. El de la ventana entera se
  // calcula aquí porque nadie más lo sabe.
  const cambio24 = hayPrecio && Number.isFinite(Number(precio.cambio24))
    ? Number(precio.cambio24) : null;
  const cambioVentana = d ? ((d.final - d.primero) / d.primero) * 100 : null;
  const sube = cambioVentana == null ? null : cambioVentana >= 0;

  const grafico = d ? `
    <figure class="pgraf${sube ? ' sube' : ' baja'}">
      <svg viewBox="0 0 ${ANCHO} ${ALTO}" preserveAspectRatio="none" role="img"
           aria-label="Precio de PLS en las últimas ${escapar(fmtVentana(d.hasta - d.desde))}: ${
             escapar(fmtPct(cambioVentana))}, entre ${escapar(fmtPrecio(d.min))} y ${
             escapar(fmtPrecio(d.max))} dólares">
        <polygon class="pg-area" points="${d.area}"/>
        <polyline class="pg-linea" points="${d.linea}"/>
      </svg>
      <!-- Dos bloques y no tres, y en minúsculas: con tres bloques en
           versalitas espaciadas el pie se partía en dos líneas escalonadas en
           una columna de 300px. La ventana y su tamaño van juntos a la
           izquierda; el movimiento, a la derecha, que es lo que se compara con
           el «· 24 h» de la cabecera. -->
      <figcaption class="pg-pie">
        <span>${escapar(fmtVentana(d.hasta - d.desde))} · ${fmt(d.n)} lecturas</span>
        <span class="pg-cambio">${escapar(fmtPct(cambioVentana))} en total</span>
      </figcaption>
    </figure>`
    : '<p class="vacio">Aún no hay histórico de precio suficiente para dibujarlo.</p>';

  return `
    <section class="panel" aria-labelledby="ppr-t">
      <header class="p-cab">
        <h2 id="ppr-t">${TITULO}</h2>
        ${cambio24 != null
          ? `<span class="p-marca ${cambio24 >= 0 ? 'bien' : 'alerta'}">${
              escapar(fmtPct(cambio24))} · 24 h</span>`
          : precioViejo ? '<span class="p-marca alerta">No fresco</span>' : ''}
      </header>

      <div class="cifra">
        <span class="c-num">${hayPrecio ? fmtPrecio(precio.precio) : '–'}<span class="u">$</span></span>
        <!-- El símbolo del par, no precio.par: ese campo es la DIRECCIÓN del
             contrato del par, y en mayúsculas bajo la cifra se leía
             «0XDAIPAIR», que no dice nada de nada.
             (Sin acentos graves aquí dentro: cerrarían la plantilla.) -->
        <span class="c-eti">${escapar(precio?.simbolo || 'PLS')} · precio actual</span>
        ${precioViejo
          ? `<span class="c-sub alerta">Precio de ${escapar(fmtEdad(precio.edad_s))}: no está fresco.</span>`
          : hayPrecio ? '' : '<span class="c-sub alerta">El endpoint de precio no responde.</span>'}
      </div>

      ${grafico}

      ${d ? `
      <dl class="p-fondo">
        <div><dt>Máximo</dt><dd>${escapar(fmtPrecio(d.max))} $</dd></div>
        <div><dt>Mínimo</dt><dd>${escapar(fmtPrecio(d.min))} $</dd></div>
      </dl>` : ''}

      <p class="c-sub">Histórico guardado por el recolector, una lectura por hora.</p>
    </section>`;
}
