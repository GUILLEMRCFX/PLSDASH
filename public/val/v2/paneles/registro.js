/**
 * Panel — Registro de eventos.
 *
 * ⚠ ES UN REGISTRO, NO UN FEED. Pasan unos 6 sucesos al día: un barrido cada
 *   ~8 h y algún bloque suelto. Rotularlo «LIVE» o darle animación de tiempo
 *   real prometería un movimiento que no existe y enseñaría a mirar una
 *   pantalla que casi siempre está quieta. Cuando no pasa nada, lo dice.
 *
 * ## Los tipos son cinco
 *
 * `activacion`, `barrido`, `bloque`, `aviso` y `recuperacion`. Comprobado contra
 * D1 el 29-oct-2026 (decía tres: los dos últimos llegaron en septiembre). No se
 * inventan atestaciones ni epochs — el recolector no los escribe.
 *
 * ## Fusión por ciclo, y deduplicación
 *
 * Un barrido y los bloques que cayeron con él comparten `ts` exacto y son un
 * mismo suceso: se juntan en una línea.
 *
 * La deduplicación es DEFENSA EN PROFUNDIDAD, no la protección principal.
 *
 * El origen ya está arreglado: `/api/val/ganancia` escribía con un SELECT
 * seguido de un INSERT, y dos peticiones simultáneas se colaban las dos —así
 * salió el ciclo del 16-ago-2026 a las 21:20:45 con el barrido y el bloque del
 * validador 109555 por duplicado—. Ahora la unicidad la impone la base con el
 * índice `ix_eventos_unico` sobre `(ts, tipo, COALESCE(validador, -1))`, y el
 * INSERT lleva `ON CONFLICT DO NOTHING`.
 *
 * Esto se queda porque el panel también lee filas escritas antes de que
 * existiera el índice, y porque una vista que se rompe con un dato repetido es
 * una vista frágil aunque hoy nadie los escriba. La clave de un evento es
 * `(ts, tipo, validador)`, aquí y en la base.
 */

import { fmt, escapar } from './formato.js';

export const TITULO = 'Registro';

/* Los tipos que hay en D1, comprobado el 29-oct-2026: `barrido`, `bloque`,
   `activacion`, `aviso` y `recuperacion`. La nota de arriba decía tres; los
   dos últimos los escribe el recolector desde septiembre y aquí se pintaban
   como «aviso» o «recuperacion» a secas, sin su título — que es justo lo que
   dice qué ha pasado. Cualquier tipo nuevo cae en `otro` y enseña su título. */
const ICONO = {
  barrido: '<path d="M12 4v10m0 0-4-4m4 4 4-4"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  bloque: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  activacion: '<path d="M12 3v8"/><path d="M6.3 7.2a8 8 0 1 0 11.4 0"/>',
  aviso: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  recuperacion: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>',
  otro: '<circle cx="12" cy="12" r="3.5"/>',
};
const icono = t => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONO[t] || ICONO.otro}</svg>`;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Hora en UTC: «05:30». La fecha la pone la cabecera del día. */
function fmtHora(ts) {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** El día, en UTC como la hora: «Hoy», «Ayer» o «27 oct». */
export function fmtDia(ts, ahoraS) {
  const dia = t => Math.floor(t / 86400);
  const n = Number.isFinite(ahoraS) ? dia(ahoraS) - dia(ts) : NaN;
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Ayer';
  const d = new Date(ts * 1000);
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

const lista = vs => vs.map(v => escapar(v ?? '?')).join(', ');

/**
 * Qué dice una línea del registro: tipo (para el icono), título completo,
 * detalle y PLS. Sin DOM, para poder probarlo.
 *
 * ⚠ NUNCA SALE UN «—» NI UN TIPO A SECAS. Antes, un bloque suelto —sin barrido
 *   en el mismo instante— no entraba en ninguna rama y la línea decía «—», y
 *   un aviso decía «aviso» sin su texto. Ahora cada caso tiene su frase.
 */
export function describirCiclo(c) {
  const bloques = [...c.bloques].sort((a, b) => Number(a.validador) - Number(b.validador));
  const nb = bloques.length;
  const plsBloques = bloques.some(b => b.pls != null)
    ? bloques.reduce((a, b) => a + (Number(b.pls) || 0), 0) : null;
  const extras = c.otros.map(o => escapar(o.titulo || o.tipo));

  if (c.barrido) {
    const sub = [];
    if (nb) sub.push(`con ${nb === 1 ? 'el bloque' : `${nb} bloques`} de ${lista(bloques.map(b => b.validador))}${
      plsBloques != null ? ` · ${fmt(plsBloques)} PLS` : ''}`);
    sub.push(...extras);
    return { tipo: 'barrido', titulo: 'Barrido a la wallet', sub: sub.join(' · '),
             pls: c.barrido.pls != null ? Number(c.barrido.pls) : null };
  }
  if (nb) {
    return {
      tipo: 'bloque',
      titulo: nb === 1 ? `Bloque propuesto por ${escapar(bloques[0].validador ?? '?')}` : `${nb} bloques propuestos`,
      sub: [nb > 1 ? `de ${lista(bloques.map(b => b.validador))}` : '', ...extras].filter(Boolean).join(' · '),
      pls: plsBloques,
    };
  }
  if (!c.otros.length) return { tipo: 'otro', titulo: 'Suceso sin detalle', sub: '', pls: null };

  // Varias activaciones en el mismo instante —una ampliación— son una línea.
  const act = c.otros.filter(o => o.tipo === 'activacion');
  if (act.length > 1 && act.length === c.otros.length) {
    return { tipo: 'activacion', titulo: `${act.length} validadores activados`,
             sub: lista(act.map(o => o.validador).sort((a, b) => Number(a) - Number(b))), pls: null };
  }
  const [o, ...resto] = c.otros;
  const tipo = ICONO[o.tipo] ? o.tipo : 'otro';
  const titulo = o.titulo ? escapar(o.titulo)
    : o.tipo === 'activacion' && o.validador != null ? `Validador ${escapar(o.validador)} activado`
    : escapar(o.tipo || 'Suceso');
  const sub = [o.detalle ? escapar(o.detalle) : '', ...resto.map(x => escapar(x.titulo || x.tipo))].filter(Boolean).join(' · ');
  return { tipo, titulo, sub, pls: o.pls != null ? Number(o.pls) : null };
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

  /* Una línea de tiempo por días, con un icono por tipo y el título entero.
     El día va en su cabecera y cada línea lleva solo la hora: «17 ago · 05:30»
     repetido doce veces era lo que más ocupaba y lo que menos decía. */
  let diaPrevio = null;
  const filas = ciclos.slice(0, 12).map((c, i, arr) => {
    const e = describirCiclo(c);
    const dia = fmtDia(c.ts, datos.ahoraS);
    const cab = dia !== diaPrevio ? `<li class="e-dia">${dia}</li>` : '';
    diaPrevio = dia;
    const ultimoDelDia = i === arr.length - 1 || fmtDia(arr[i + 1].ts, datos.ahoraS) !== dia;
    return `${cab}
      <li class="efila t-${e.tipo}${ultimoDelDia ? ' fin' : ''}">
        <span class="e-ico">${icono(e.tipo)}</span>
        <span class="e-txt"><b class="e-tit">${e.titulo}</b>${e.sub ? `<span class="e-sub">${e.sub}</span>` : ''}</span>
        <span class="e-der">${e.pls != null ? `<span class="e-pls">${fmt(e.pls)}<span class="u">PLS</span></span>` : ''}<span class="e-hora">${fmtHora(c.ts)}</span></span>
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
