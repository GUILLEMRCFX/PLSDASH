/**
 * Panel 1 — Estado global.
 *
 * Validadores activos sobre el total, una palabra de salud, uptime y
 * disponibilidad; y en segundo plano epoch, peers y sincronía.
 *
 * El número de validadores sale del estado real (`validadores.total`), no de
 * un 10 escrito a mano: el día que se añada uno, el panel se entera solo.
 */

import { saludGlobal, disponibilidad } from '../datos.js';
import { ritmoDiario } from '/val/compartido/ganancias.js';
import { fmt, fmtHoras, escapar } from './formato.js';

/**
 * Lo que cuesta una hora sin servicio, en PLS.
 *
 * ⚠ Se valora al ritmo MEDIDO y no a la media desde la activación. El v1 dejó
 *   escrito por qué, y merece repetirse: con la media desde el arranque la
 *   pérdida sale infravalorada por un factor de diez, porque los primeros días
 *   el nodo rendía mucho menos.
 */
export function costeHora(datos) {
  const r = ritmoDiario({
    serie: datos.serie, snapshots24h: datos.snapshots24h,
    plsDiaKV: datos.estado?.validadores?.pls_dia, fmt,
  });
  const d = Number(r?.pls_dia);
  return d > 0 ? d / 24 : null;
}

export const TITULO = 'Estado global';

export function panelEstadoGlobal(datos) {
  const salud = saludGlobal(datos);
  const alerta = salud.tono !== 'ok';
  const e = datos.estado;
  const v = e?.validadores || {};
  const n = e?.nodo || {};

  // Sin estado no hay panel que pintar. Se dice, y se dice por qué.
  if (!e) {
    return `
      <section class="panel" data-alerta aria-labelledby="pg-t">
        <header class="p-cab">
          <h2 id="pg-t">${TITULO}</h2>
          <span class="p-marca alerta">${escapar(salud.palabra)}</span>
        </header>
        <p class="p-aviso">${escapar(salud.nota || 'Sin datos del nodo.')}</p>
      </section>`;
  }

  const disp = disponibilidad(datos.daily);
  const porHora = costeHora(datos);
  const vals = Number(e?.validadores?.total) || 0;

  // El aviso solo aparece cuando hay algo que avisar. Un panel que siempre
  // lleva una franja de color enseña a ignorarla.
  const aviso = salud.nota
    ? `<p class="p-aviso">${escapar(salud.nota)}</p>`
    : '';

  const sincronia = n.sincronizado === false
    ? '<dd class="alerta">No</dd>'
    : `<dd${n.optimistic ? ' class="alerta"' : ''}>${n.optimistic ? 'Optimistic' : 'Verified'}</dd>`;

  // Un estado no puede viajar solo en el color: un «8» no dice por sí mismo
  // que sean pocos peers, y quien no distinga el naranja no ve nada. El color
  // acompaña a la palabra, no la sustituye. («Verified»/«No» de sincronía ya
  // se explican solos, por eso allí no hace falta añadir nada.)
  const pocosPeers = Number(n.peers) < 10;

  return `
    <section class="panel"${alerta ? ' data-alerta' : ''} aria-labelledby="pg-t">
      <header class="p-cab">
        <h2 id="pg-t">${TITULO}</h2>
        <span class="p-marca${alerta ? ' alerta' : ''}">${escapar(salud.palabra)}</span>
      </header>

      ${aviso}

      <div class="cifra">
        <span class="c-num${Number(v.activos) < Number(v.total) ? ' alerta' : ''}">
          ${fmt(v.activos)}<span class="de">/${fmt(v.total)}</span>
        </span>
        <span class="c-eti">Validadores activos</span>
      </div>

      <div class="rejilla">
        <div class="cifra">
          <span class="c-num">${fmtHoras(n.uptime_horas)}</span>
          <span class="c-eti">Nodo en línea</span>
          <span class="c-sub">desde el arranque</span>
        </div>
        ${disp ? `
        <div class="cifra">
          <span class="c-num${disp.pct < 99.5 ? ' alerta' : ''}">${fmt(disp.pct, 2)}<span class="u pct">%</span></span>
          <span class="c-eti">Disponibilidad</span>
          <span class="c-sub">${disp.dias} días · ${
            disp.minutosCaidos > 0
              ? `${fmt(disp.minutosCaidos)} min caído${
                  porHora ? ` · ≈ −${fmt((disp.minutosCaidos / 60) * porHora)} PLS` : ''}`
              : 'sin caídas'
          }</span>
        </div>` : ''}
      </div>

      ${porHora ? `
      <!-- ⚠ El único sitio del panel donde se dice el riesgo de la ARQUITECTURA
           y no del momento. Los diez validadores cuelgan de una máquina, una
           conexión y un enchufe: una caída larga los para a los diez a la vez.
           Venía del v1 y no estaba en el v2. -->
      <p class="c-sub alerta">Punto único de fallo: los ${fmt(vals)} validadores
        dependen de una máquina, una conexión y un suministro. Una caída los para
        a todos a la vez, y cuesta ~${fmt(porHora)} PLS por hora sin servicio.</p>` : ''}

      <dl class="p-fondo">
        <div><dt>Epoch</dt><dd>${fmt(n.epoch_actual)}</dd></div>
        <div><dt>Peers</dt><dd${pocosPeers ? ' class="alerta"' : ''}>${fmt(n.peers)}${pocosPeers ? ' · pocos' : ''}</dd></div>
        <div><dt>Sincronía</dt>${sincronia}</div>
      </dl>
    </section>`;
}
