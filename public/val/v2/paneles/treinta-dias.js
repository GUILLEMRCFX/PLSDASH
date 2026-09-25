/**
 * La franja de los últimos 30 días.
 *
 * Una barra por día, con la ALTURA proporcional a lo ganado y el color según
 * la salud de ese día. Responde de un vistazo lo que ninguna cifra contesta:
 * ¿esto es estable, o hay días que se salen?
 *
 * ## Qué añade sobre lo que ya hay
 *
 * La tabla del ritmo da la media por periodo, que aplana. La sierra del ciclo
 * de barrido enseña la FORMA de un ciclo de ocho horas, no la de un mes. Esto
 * es la tercera pregunta: cómo se reparte el mes.
 *
 * ⚠ Y por eso lleva altura, que es lo que el v1 no tiene. Allí los treinta
 *   cuadraditos son todos iguales y solo cambian de color con la salud: dicen
 *   «este día hubo un aviso» y no dicen cuánto se ganó. Con el ganado en la
 *   altura, un día flojo se ve aunque no diera aviso — que es justo el caso que
 *   interesa pillar.
 *
 * ## De dónde salen los días
 *
 * De `diarioReal(serie)`, igual que el ritmo: los días RECONSTRUIDOS a partir
 * de los snapshots, sumando tramo a tramo para que los barridos no resten.
 * `daily.ganado_dia` NO vale — se comprobó en agosto que `ganado_acum` guarda
 * lo no barrido y se desploma en cada barrido, así que la diferencia entre días
 * sale cero la mitad de las veces.
 *
 * La salud sí sale de `daily`, que es donde la escribe el recolector.
 */

import { diarioReal } from '/val/compartido/ganancias.js';
import { fmt, escapar } from './formato.js';

export const DIAS = 30;

/**
 * Los días a pintar, del más viejo al más nuevo.
 *
 * @returns {Array<{fecha, pls, salud, alto}>} `alto` va de 0 a 1, relativo al
 *   mejor día del tramo. Vacío si no hay ningún día cerrado.
 */
export function franja(serie = [], daily = [], hoy = new Date().toISOString().slice(0, 10)) {
  const saludPorDia = new Map((daily || []).map(d => [d.fecha, d.salud]));
  const dias = diarioReal(serie)
    // El día en curso NO entra: lleva unas horas y saldría como el peor del mes
    // por estar a medias, que es una alarma falsa cada mañana.
    .filter(d => d.fecha !== hoy && d.completo)
    .slice(-DIAS);
  if (!dias.length) return [];

  // Relativo al mejor día y no a un techo fijo: lo que importa es la forma del
  // reparto, y un techo absoluto dejaría la franja plana en cuanto el ritmo
  // cambie de orden de magnitud.
  const tope = Math.max(...dias.map(d => Number(d.ganado_dia) || 0), 1);
  return dias.map(d => {
    const pls = Number(d.ganado_dia) || 0;
    return {
      fecha: d.fecha,
      pls,
      salud: saludPorDia.get(d.fecha) || null,
      // Suelo del 6 %: un día a cero tiene que verse como una barra mínima y no
      // como un hueco, o se confunde con «no hay dato de ese día».
      alto: Math.max(0.06, pls / tope),
    };
  });
}

/** «14 ago». Corto, que van treinta en una línea. */
function dia(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d))
    .toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function htmlTreintaDias(datos) {
  const f = franja(datos.serie, datos.daily,
    new Date((datos.ahoraS || Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10));
  if (!f.length) return '';

  const barras = f.map(d => `
    <i class="td-b${d.salud === 'aviso' ? ' aviso' : d.salud === 'critico' ? ' mal' : ''}"
       style="--h:${(d.alto * 100).toFixed(1)}%"
       title="${escapar(dia(d.fecha))} · ${escapar(fmt(d.pls))} PLS${
         d.salud && d.salud !== 'ok' ? ` · ${escapar(d.salud)}` : ''}"></i>`).join('');

  const mejor = f.reduce((a, d) => (d.pls > a.pls ? d : a), f[0]);
  const peor = f.reduce((a, d) => (d.pls < a.pls ? d : a), f[0]);

  return `
    <div class="td">
      <div class="td-barras" role="img"
           aria-label="Lo ganado cada uno de los últimos ${f.length} días. Mejor: ${
             escapar(dia(mejor.fecha))}, ${escapar(fmt(mejor.pls))} PLS. Peor: ${
             escapar(dia(peor.fecha))}, ${escapar(fmt(peor.pls))} PLS.">${barras}</div>
      <div class="td-pie">
        <span>${escapar(dia(f[0].fecha))}</span>
        <span class="td-rango">${escapar(fmt(peor.pls))} – ${escapar(fmt(mejor.pls))} PLS al día</span>
        <span>${escapar(dia(f[f.length - 1].fecha))}</span>
      </div>
    </div>`;
}
