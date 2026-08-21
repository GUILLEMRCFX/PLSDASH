/**
 * Panel — Salud del nodo.
 *
 * Temperaturas, RAM y disco de la máquina, más el runway del disco.
 *
 * `temp_nvme` NO está en el estado de KV: solo vive en `snapshots`, así que
 * sale de la última fila de las 24 h (ver `tempNvme` en datos.js). El resto
 * viene de `estado.nodo`, que es lo más fresco que hay.
 *
 * ⚠ Los peers ESTABAN también aquí, repetidos a sabiendas, con el argumento de
 *   que este panel y «Estado global» caían en columnas distintas y nunca se
 *   veían juntos. Con las cuatro pestañas eso dejó de ser verdad: los dos
 *   viven en «Nodo», uno al lado del otro, y en la captura se leía «PEERS 64»
 *   dos veces en la misma fila de pantalla. Se quedan en «Estado global», que
 *   es donde llevan la marca de «· pocos».
 *
 *   El recuento SIGUE contando para el estado del panel (`alerta`): pocos peers
 *   marcan este panel para revisar aunque el número se lea en el de al lado.
 */

import { tempNvme } from '../datos.js';
import { fmt } from './formato.js';

export const TITULO = 'Salud del nodo';

// Umbrales. Por encima, el número se marca.
const CPU_ALTA = 75;      // °C
const NVME_ALTA = 65;     // °C — los NVMe hacen throttling bastante antes que la CPU
const RAM_ALTA = 90;      // %
const DISCO_ALTO = 85;    // %
const PEERS_POCOS = 10;

/**
 * Runway del disco: a qué ritmo crece y cuándo tocaría podar.
 *
 * Mismo criterio que el panel de /val/: primero `daily`, que cubre días
 * enteros, y solo si no alcanza se mide sobre las 24 h —marcándolo como
 * provisional, porque `disco_pct` viene redondeado a una décima y en un solo
 * día esa décima es casi todo lo que se mueve—.
 */
function runway(daily, snapshots24h, discoActual) {
  let pctPorDia = null;
  let provisional = false;

  if (daily.length >= 3) {
    const a = daily[0], b = daily[daily.length - 1];
    const dias = (new Date(b.fecha) - new Date(a.fecha)) / 86400000;
    if (dias >= 1) pctPorDia = (b.disco_pct - a.disco_pct) / dias;
  }

  if (pctPorDia === null && snapshots24h.length >= 3) {
    const a = snapshots24h[0], b = snapshots24h[snapshots24h.length - 1];
    const dias = (b.ts - a.ts) / 86400;
    if (dias >= 0.2) { pctPorDia = (b.disco_pct - a.disco_pct) / dias; provisional = true; }
  }

  if (pctPorDia === null) return { texto: 'Faltan horas de historial para estimar el crecimiento.' };

  // Con la resolución de una décima, cualquier cosa por debajo de esto es
  // ruido de redondeo y no un crecimiento.
  if (pctPorDia <= 0.01) {
    return { texto: 'Uso estable, sin crecimiento apreciable.', estable: true };
  }

  const dias = (95 - discoActual) / pctPorDia;
  const fecha = new Date(Date.now() + dias * 86400000);
  return {
    texto: `Crece ~${fmt(pctPorDia * 7, 2)} %/semana · prune hacia ${
      fecha.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}`,
    dias,
    provisional,
  };
}

export function panelSaludNodo(datos) {
  const n = datos.estado?.nodo;

  if (!n) {
    return `
      <section class="panel" aria-labelledby="ps-t">
        <header class="p-cab"><h2 id="ps-t">${TITULO}</h2></header>
        <p class="vacio">Sin lectura de la máquina.</p>
      </section>`;
  }

  const nvme = tempNvme(datos.snapshots24h);
  const ramUsada = Number(n.ram_total_gb) - Number(n.ram_libre_gb);
  const ramPct = Number(n.ram_total_gb) > 0 ? (ramUsada / Number(n.ram_total_gb)) * 100 : null;
  const disco = Number(n.disco_usado_pct);
  const rw = runway(datos.daily || [], datos.snapshots24h || [], disco);

  const alerta = Number(n.temp_cpu) >= CPU_ALTA
    || (nvme != null && nvme >= NVME_ALTA)
    || (ramPct != null && ramPct >= RAM_ALTA)
    || disco >= DISCO_ALTO
    || Number(n.peers) < PEERS_POCOS;

  const cifra = (valor, unidad, etiqueta, sub, mal) => `
    <div class="cifra">
      <span class="c-num${mal ? ' alerta' : ''}">${valor}${
        unidad ? `<span class="u${unidad === '%' ? ' pct' : ''}">${unidad}</span>` : ''}</span>
      <span class="c-eti">${etiqueta}</span>
      ${sub ? `<span class="c-sub">${sub}</span>` : ''}
    </div>`;

  return `
    <section class="panel"${alerta ? ' data-alerta' : ''} aria-labelledby="ps-t">
      <header class="p-cab">
        <h2 id="ps-t">${TITULO}</h2>
        <span class="p-marca${alerta ? ' alerta' : ''}">${alerta ? 'Revisar' : 'Sin novedad'}</span>
      </header>

      <div class="rejilla">
        ${cifra(fmt(n.temp_cpu, 0), '°C', 'CPU', null, Number(n.temp_cpu) >= CPU_ALTA)}
        ${cifra(nvme == null ? '–' : fmt(nvme, 1), nvme == null ? '' : '°C', 'NVMe',
                nvme == null ? 'sin lectura' : null, nvme != null && nvme >= NVME_ALTA)}
      </div>

      <div class="rejilla">
        ${cifra(ramPct == null ? '–' : fmt(ramPct, 1), ramPct == null ? '' : '%', 'RAM',
                Number.isFinite(ramUsada) ? `${fmt(ramUsada, 1)} de ${fmt(n.ram_total_gb, 0)} GB` : null,
                ramPct != null && ramPct >= RAM_ALTA)}
        ${cifra(fmt(disco, 1), '%', 'Disco', `${fmt(n.disco_libre_gb, 0)} GB libres`, disco >= DISCO_ALTO)}
      </div>

      <p class="c-sub${rw.provisional ? '' : ''}">${rw.texto}${
        rw.provisional ? ' · medido en pocas horas' : ''}</p>

      <dl class="p-fondo">
        <div><dt>Carga</dt><dd>${n.carga_pct == null ? '–' : `${fmt(n.carga_pct, 1)} %`}</dd></div>
        <div><dt>Slot</dt><dd>${fmt(n.head_slot)}</dd></div>
      </dl>
    </section>`;
}
