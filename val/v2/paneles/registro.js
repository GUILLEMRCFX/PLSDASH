/**
 * Panel — Registro de eventos.
 *
 * ⚠ ES UN REGISTRO, NO UN FEED. Pasan unos 6 sucesos al día: un barrido cada
 *   ~8 h y algún bloque suelto. Rotularlo «LIVE» o darle animación de tiempo
 *   real prometería un movimiento que no existe y enseñaría a mirar una
 *   pantalla que casi siempre está quieta. Cuando no pasa nada, lo dice.
 *
 * ## Los tipos son solo tres
 *
 * `activacion`, `barrido` y `bloque`. Comprobado contra D1: no hay más. No se
 * inventan atestaciones ni epochs — el recolector no los escribe.
 *
 * ## Fusión por ciclo, y deduplicación
 *
 * Un barrido y los bloques que cayeron con él comparten `ts` exacto y son un
 * mismo suceso: se juntan en una línea.
 *
 * Y hay que DEDUPLICAR. En D1 el ciclo del 16-ago-2026 a las 21:20:45 tiene el
 * barrido escrito dos veces y el bloque del validador 109555 también, porque
 * `/api/val/ganancia` lo registró en dos pasadas. Sin deduplicar, ese ciclo
 * enseñaría el doble de PLS y dos bloques donde hubo uno. La clave real de un
 * evento es `(ts, tipo, validador)`.
 */

import { fmt, escapar } from './formato.js';

export const TITULO = 'Registro';

const ETIQUETA = {
  activacion: 'Activación',
  barrido: 'Barrido',
  bloque: 'Bloque',
};

/** Fecha corta en UTC: «17 ago · 05:30». */
function fmtFecha(ts) {
  const d = new Date(ts * 1000);
  const mes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
               'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${mes} · ${hh}:${mm}`;
}

/**
 * Deduplica y agrupa por instante.
 * @returns {Array} ciclos de más nuevo a más viejo.
 */
export function agruparEventos(eventos = []) {
  const vistos = new Set();
  const porTs = new Map();

  for (const e of eventos) {
    const ts = Number(e.ts);
    if (!Number.isFinite(ts)) continue;

    const clave = `${ts}|${e.tipo}|${e.validador ?? ''}`;
    if (vistos.has(clave)) continue;      // la copia duplicada de D1
    vistos.add(clave);

    if (!porTs.has(ts)) porTs.set(ts, { ts, barrido: null, bloques: [], otros: [] });
    const c = porTs.get(ts);

    if (e.tipo === 'barrido') c.barrido = e;
    else if (e.tipo === 'bloque') c.bloques.push(e);
    else c.otros.push(e);
  }

  return [...porTs.values()].sort((a, b) => b.ts - a.ts);
}

export function panelRegistro(datos) {
  const ciclos = agruparEventos(datos.eventos);

  if (!ciclos.length) {
    return `
      <section class="panel" aria-labelledby="pl-t">
        <header class="p-cab"><h2 id="pl-t">${TITULO}</h2></header>
        <p class="vacio">Sin sucesos registrados todavía.</p>
      </section>`;
  }

  const filas = ciclos.slice(0, 12).map(c => {
    const partes = [];

    if (c.barrido) {
      partes.push(`<span class="e-tipo">${ETIQUETA.barrido}</span>`
        + `<span class="e-pls">${fmt(c.barrido.pls)}<span class="u">PLS</span></span>`);
    }
    for (const o of c.otros) {
      partes.push(`<span class="e-tipo">${escapar(ETIQUETA[o.tipo] || o.tipo)}</span>`
        + `<span class="e-pls">${o.pls != null ? fmt(o.pls) : ''}</span>`);
    }

    // Los bloques del ciclo van juntos, con los índices: es lo que se quiere
    // saber cuando se mira («¿a quién le tocó?»).
    // Ordenados por índice: llegan en el orden en que los escribió el
    // recolector, que no significa nada y hace bailar la lista entre cargas.
    c.bloques.sort((a, b) => Number(a.validador) - Number(b.validador));
    const nb = c.bloques.length;
    const detalleBloques = nb
      ? `<div class="e-sub">${nb} bloque${nb === 1 ? '' : 's'} · ${
          c.bloques.map(b => escapar(b.validador ?? '?')).join(', ')
        }${
          c.bloques.some(b => b.pls != null)
            ? ` · ${fmt(c.bloques.reduce((a, b) => a + (Number(b.pls) || 0), 0))} PLS`
            : ''
        }</div>`
      : '';

    return `
      <li class="efila">
        <div class="e-cab">
          <span class="e-fecha">${fmtFecha(c.ts)}</span>
          ${partes.join('') || `<span class="e-tipo">${escapar(ETIQUETA[c.otros[0]?.tipo] || '—')}</span>`}
        </div>
        ${detalleBloques}
      </li>`;
  }).join('');

  const ultimo = ciclos[0].ts;
  // Nunca negativo: si el reloj del navegador va por detrás del recolector, un
  // «hace -1 h» sería peor que redondear a cero.
  const horas = Math.max(0, (datos.ahoraS - ultimo) / 3600);

  return `
    <section class="panel" aria-labelledby="pl-t">
      <header class="p-cab">
        <h2 id="pl-t">${TITULO}</h2>
        <span class="p-marca">${fmt(ciclos.length)} sucesos</span>
      </header>

      <ul class="elista">${filas}</ul>

      <p class="c-sub">${
        horas < 1
          ? 'Último suceso hace menos de una hora.'
          : `Sin novedades desde hace ${fmt(horas, 0)} h. Es lo normal: hay unos seis sucesos al día.`
      }</p>
    </section>`;
}
