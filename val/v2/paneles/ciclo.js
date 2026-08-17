/**
 * Panel 3 — Ciclo de barrido.
 *
 * Lo más característico del sistema y lo que ningún panel genérico enseña: el
 * protocolo retira el excedente de cada validador hacia la wallet cada ~8 h,
 * así que `snapshots.ganado` sube y cae en diente de sierra.
 *
 * ⚠ UNA BAJADA ES UN BARRIDO, NO UN FALLO. Aquí no hay ni puede haber una
 *   validación que descarte las bajadas: hubo una, escrita cuando los barridos
 *   se tomaban por datos corruptos, y descartaba cada lectura posterior a un
 *   barrido — hundía el ritmo calculado. El único sitio donde se decide qué es
 *   una bajada es `ganadoEntre()`, en el módulo compartido.
 *
 * Fuentes: `serie` (snapshots) para el dibujo, y `ganancia.ciclos` (que sale de
 * la tabla `barridos`, reconciliada contra la cadena) para los ciclos y sus
 * importes.
 */

import { proximoBarrido } from '/val/compartido/ganancias.js';
import { fmt, fmtCompacto, escapar } from './formato.js';

export const TITULO = 'Ciclo de barrido';

// Ventana del dibujo. Con ciclos de ~8 h, 72 h enseñan unos nueve dientes:
// suficientes para que el patrón se lea como patrón y no como una anécdota,
// y pocos para que cada diente siga siendo distinguible a 320px de ancho.
const VENTANA_S = 72 * 3600;

const ALTO = 68;      // unidades del viewBox; el ancho es 100 y escala solo
const ANCHO = 100;

/** Duración en segundos → «2 h 14 min», «14 min». */
function fmtFalta(s) {
  s = Math.round(s);
  if (s < 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/**
 * Puntos del diente de sierra, ya en coordenadas del viewBox.
 * Devuelve también dónde cae cada barrido, para marcarlos.
 */
function trazar(serie, ahoraS) {
  const desde = ahoraS - VENTANA_S;
  const pts = serie.filter(p => p.ts >= desde);
  if (pts.length < 2) return null;

  const t0 = pts[0].ts;
  const t1 = pts[pts.length - 1].ts;
  const span = Math.max(1, t1 - t0);
  const max = Math.max(...pts.map(p => p.ganado), 1);

  const x = t => ((t - t0) / span) * ANCHO;
  const y = g => ALTO - (g / max) * (ALTO - 4) - 2;

  // La línea se corta en cada barrido en vez de cruzar la caída en diagonal:
  // el protocolo retira de golpe, no descendiendo, y una diagonal dibujaría
  // una bajada gradual que no ocurre.
  const tramos = [];
  let actual = [];
  const caidas = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i].ganado < pts[i - 1].ganado) {
      tramos.push(actual);
      caidas.push({ x: x(pts[i].ts), yAlto: y(pts[i - 1].ganado), pls: pts[i - 1].ganado, ts: pts[i].ts });
      actual = [];
    }
    actual.push(`${x(pts[i].ts).toFixed(2)},${y(pts[i].ganado).toFixed(2)}`);
  }
  tramos.push(actual);

  return { tramos: tramos.filter(t => t.length > 1), caidas, max, desde: t0, hasta: t1, n: pts.length };
}

export function panelCiclo(datos) {
  const { serie, estado, ganancia, ahoraS } = datos;

  if (!serie || serie.length < 2) {
    return `
      <section class="panel" aria-labelledby="pc-t">
        <header class="p-cab"><h2 id="pc-t">${TITULO}</h2></header>
        <p class="vacio">Sin serie suficiente para dibujar el ciclo.</p>
      </section>`;
  }

  const dibujo = trazar(serie, ahoraS);
  const prox = proximoBarrido(ganancia?.ciclos || [], ahoraS);
  const ultimo = (ganancia?.ciclos || []).slice(-1)[0] || null;
  const acumulado = estado?.validadores?.ganado_total;

  const horasPeriodo = prox ? prox.periodo / 3600 : null;
  const falta = prox ? fmtFalta(prox.falta) : null;

  // Cada tramo es una acumulación completa entre dos barridos.
  const svg = dibujo ? `
    <figure class="sierra" id="sierra" data-desde="${dibujo.desde}" data-hasta="${dibujo.hasta}">
      <svg viewBox="0 0 ${ANCHO} ${ALTO}" preserveAspectRatio="none" role="img"
           aria-label="Acumulación del excedente en las últimas 72 horas, con ${dibujo.caidas.length} barridos">
        ${dibujo.caidas.map(c =>
          `<line class="s-caida" x1="${c.x.toFixed(2)}" y1="${c.yAlto.toFixed(2)}"
                 x2="${c.x.toFixed(2)}" y2="${ALTO - 2}"/>`).join('')}
        ${dibujo.tramos.map(t => `<polyline class="s-linea" points="${t.join(' ')}"/>`).join('')}
        <line class="s-cursor" id="sCursor" x1="0" y1="0" x2="0" y2="${ALTO}" style="display:none"/>
      </svg>
      <figcaption class="s-pie">
        <span>72 h</span>
        <span id="sLectura"></span>
        <span>${dibujo.caidas.length} barrido${dibujo.caidas.length === 1 ? '' : 's'}</span>
      </figcaption>
    </figure>` : '<p class="vacio">Sin datos en las últimas 72 h.</p>';

  return `
    <section class="panel" aria-labelledby="pc-t">
      <header class="p-cab">
        <h2 id="pc-t">${TITULO}</h2>
        ${horasPeriodo ? `<span class="p-marca">cada ${fmt(horasPeriodo, 1)} h</span>` : ''}
      </header>

      ${svg}

      <div class="rejilla">
        <div class="cifra">
          <span class="c-num">${acumulado == null ? '–' : fmt(acumulado)}<span class="u">PLS</span></span>
          <span class="c-eti">Sin barrer</span>
          ${prox ? `<span class="c-sub">desde hace ${fmt(prox.desde / 3600, 1)} h</span>` : ''}
        </div>
        <div class="cifra">
          <span class="c-num">${ultimo ? fmt(ultimo.pls) : '–'}<span class="u">PLS</span></span>
          <span class="c-eti">Último barrido</span>
          ${ultimo ? `<span class="c-sub">${fmt(ultimo.validadores)} val.${
            ultimo.bloques > 0 ? ` · ${fmt(ultimo.bloques)} bloque${ultimo.bloques === 1 ? '' : 's'}` : ''
          }</span>` : ''}
        </div>
      </div>

      ${prox ? `
      <div class="avance" role="presentation">
        <div class="a-barra"><i style="width:${(prox.avance * 100).toFixed(1)}%"></i></div>
        <div class="a-pie">${
          falta
            ? `Próximo barrido en <b>${escapar(falta)}</b>`
            : '<b class="tarde">Previsto ya · puede caer en cualquier momento</b>'
        }<span>${fmt(prox.n)} ciclos medidos</span></div>
      </div>` : ''}
    </section>`;
}

/**
 * Capa de exploración del diente de sierra.
 *
 * Un gráfico en HTML es interactivo por naturaleza y dejarlo mudo desaprovecha
 * lo único que lo distingue de una imagen. El valor no queda escondido detrás
 * del puntero: las cifras que importan ya están en el panel, esto solo permite
 * mirar un instante concreto.
 *
 * Hay que volver a llamarla en cada repintado: el HTML se regenera entero.
 */
export function engancharCiclo(raiz, datos) {
  const fig = raiz.getElementById ? raiz.getElementById('sierra') : raiz.querySelector('#sierra');
  if (!fig) return;

  const svg = fig.querySelector('svg');
  const cursor = fig.querySelector('#sCursor');
  const lectura = fig.querySelector('#sLectura');
  const desde = Number(fig.dataset.desde);
  const hasta = Number(fig.dataset.hasta);
  const serie = (datos.serie || []).filter(p => p.ts >= desde);
  if (!serie.length) return;

  const limpiar = () => { cursor.style.display = 'none'; lectura.textContent = ''; };

  function mover(ev) {
    const caja = svg.getBoundingClientRect();
    if (!caja.width) return;
    const frac = Math.max(0, Math.min(1, (ev.clientX - caja.left) / caja.width));
    const t = desde + frac * (hasta - desde);

    // Punto más cercano en el tiempo, no interpolado: los snapshots son
    // horarios y fingir un valor intermedio sería inventárselo.
    let mejor = serie[0];
    for (const p of serie) if (Math.abs(p.ts - t) < Math.abs(mejor.ts - t)) mejor = p;

    cursor.setAttribute('x1', (frac * ANCHO).toFixed(2));
    cursor.setAttribute('x2', (frac * ANCHO).toFixed(2));
    cursor.style.display = '';

    const d = new Date(mejor.ts * 1000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    lectura.textContent = `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${hh}:00 · ${fmtCompacto(mejor.ganado)} PLS`;
  }

  fig.addEventListener('pointermove', mover);
  fig.addEventListener('pointerleave', limpiar);
}
