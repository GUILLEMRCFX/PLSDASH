/**
 * Panel — Cómo se ha construido esto.
 *
 * La historia de las activaciones, en orden y con fechas: el 7 de agosto
 * entraron diez de golpe, el 18 entró uno más, y así.
 *
 * ## Por qué va en VALIDADORES y no en Nodo
 *
 * Las cuatro pestañas responden a una pregunta cada una, y ése es el criterio:
 *
 *   Nodo        → ¿cómo está la máquina, y qué ha pasado?
 *   Validadores → ¿cuál de ellos está raro?
 *
 * Esto no habla de la máquina. La máquina es una y no ha cambiado; lo que ha
 * crecido es el grupo de validadores, y cada hito ES un puñado de validadores
 * con su índice. Puesto en Nodo, quedaría al lado del uptime y la temperatura
 * —cosas que se miran cuando algo va mal— cuando esto se mira justo al revés:
 * cuando algo ha ido bien.
 *
 * Y hay un argumento más fuerte que la taxonomía: aquí abajo está la tabla con
 * los once índices y su ganancia. La pregunta que dispara esta línea temporal
 * es «¿por qué el 109876 tiene menos que los demás?», y la respuesta —entró
 * once días más tarde— tiene que estar a un palmo, no en otra pestaña.
 *
 * ## De dónde salen los datos
 *
 * De `estado.validadores.detalle`, que ya trae `activacion_ts` por validador
 * —lo pone el recolector con `epoch_a_fecha(activation_epoch)`—. Aquí no se
 * pide nada nuevo: se agrupa lo que ya está.
 *
 * ⚠ Los que están EN COLA no tienen fecha, y eso no es un hueco: es que aún no
 *   la tienen. `activation_epoch` vale el futuro lejano hasta que el protocolo
 *   les asigna turno. Salen como un hito abierto al final, sin fecha, que es
 *   exactamente lo que son.
 */

import { fmt, escapar } from './formato.js';

export const TITULO = 'Cómo se ha construido';

/**
 * Agrupa las activaciones que ocurrieron juntas.
 *
 * «Juntas» es el mismo día natural: diez validadores depositados a la vez
 * entran en epochs consecutivas, con minutos de diferencia, y enseñarlos como
 * diez hitos sería enseñar el mismo hecho diez veces.
 *
 * @returns {{hitos:Array, enCola:Array}} hitos de más antiguo a más nuevo.
 */
export function hitosDesde(detalle = [], tzMin = new Date().getTimezoneOffset()) {
  const enCola = [];
  const porDia = new Map();

  for (const d of detalle) {
    const ts = Number(d.activacion_ts);
    if (!Number.isFinite(ts) || ts <= 0) { enCola.push(d); continue; }
    // El día, en la hora de quien mira: una activación de las 00:30 en España
    // es del día anterior en UTC, y la fecha que se enseña sería la de ayer.
    const dia = new Date((ts - tzMin * 60) * 1000).toISOString().slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, { dia, ts, indices: [] });
    const g = porDia.get(dia);
    g.ts = Math.min(g.ts, ts);
    g.indices.push(Number(d.indice));
  }

  const hitos = [...porDia.values()]
    .map(g => ({ ...g, indices: g.indices.sort((a, b) => a - b) }))
    .sort((a, b) => a.ts - b.ts);

  // Acumulado: cuántos había en total después de cada hito.
  let suma = 0;
  for (const h of hitos) { suma += h.indices.length; h.acumulado = suma; }

  return { hitos, enCola: enCola.sort((a, b) => Number(a.indice) - Number(b.indice)) };
}

const FECHA = { day: 'numeric', month: 'long', year: 'numeric' };

/** «10 validadores» / «1 validador». */
const cuantos = n => (n === 1 ? '1 validador' : `${fmt(n)} validadores`);

/**
 * Los índices de un hito, abreviados si son muchos.
 *
 * Con diez, la lista entera ocupa dos líneas a 390px y no aporta nada: lo que
 * importa es cuántos entraron. Con uno o dos, el índice SÍ importa — es el que
 * luego se busca en la tabla de abajo.
 */
function indicesDe(lista) {
  if (lista.length <= 3) return lista.join(' · ');
  return `${lista[0]} … ${lista[lista.length - 1]}`;
}

export function panelHitos(datos) {
  const detalle = datos?.estado?.validadores?.detalle || [];
  if (!detalle.length) {
    return `
      <section class="panel" aria-labelledby="ph-t">
        <header class="p-cab"><h2 id="ph-t">${TITULO}</h2></header>
        <p class="vacio">Sin detalle de validadores.</p>
      </section>`;
  }

  const { hitos, enCola } = hitosDesde(detalle);
  if (!hitos.length && !enCola.length) {
    return `
      <section class="panel" aria-labelledby="ph-t">
        <header class="p-cab"><h2 id="ph-t">${TITULO}</h2></header>
        <p class="vacio">Ninguna activación con fecha conocida.</p>
      </section>`;
  }

  const filas = hitos.map(h => {
    const f = new Date(h.ts * 1000).toLocaleDateString('es-ES', FECHA);
    return `
      <li class="hi-fila">
        <span class="hi-punto" aria-hidden="true"></span>
        <span class="hi-fecha">${escapar(f)}</span>
        <span class="hi-que">${escapar(cuantos(h.indices.length))}</span>
        <span class="hi-idx mono" title="Índices: ${escapar(h.indices.join(', '))}">${
          escapar(indicesDe(h.indices))}</span>
        <span class="hi-acum">${fmt(h.acumulado)} en total</span>
      </li>`;
  }).join('');

  /* El hito abierto: los que están en cola. Va al final, sin fecha y con el
     punto latiendo — el mismo lenguaje que usa la esfera para ellos. */
  const cola = !enCola.length ? '' : `
      <li class="hi-fila hi-cola">
        <span class="hi-punto" aria-hidden="true"></span>
        <span class="hi-fecha">en cola</span>
        <span class="hi-que">${escapar(cuantos(enCola.length))}</span>
        <span class="hi-idx mono">${escapar(indicesDe(enCola.map(d => Number(d.indice))))}</span>
        <span class="hi-acum">esperando turno</span>
      </li>`;

  return `
    <section class="panel" aria-labelledby="ph-t">
      <header class="p-cab">
        <h2 id="ph-t">${TITULO}</h2>
        <span class="p-marca">${fmt(detalle.length)}</span>
      </header>
      <ol class="hi-lista">${filas}${cola}</ol>
      <p class="c-sub">Cada hito es un día con activaciones. Los que entraron
        juntos van en la misma línea: diez depósitos a la vez se activan con
        minutos de diferencia y contarlos por separado sería el mismo hecho
        diez veces.</p>
    </section>`;
}
