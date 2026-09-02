/**
 * Escáner de rayos X.
 *
 * Una línea barre la pantalla de arriba abajo y, por donde pasa, la interfaz
 * pasa de radiografía a panel: arriba de la línea las tarjetas están reveladas,
 * abajo son todavía el esqueleto.
 *
 * ## Qué se revela
 *
 * No un dibujo inventado: la retícula que se dibuja es la del panel de verdad
 * —dos tarjetas anchas arriba, la lista de validadores, el registro— a las
 * proporciones que tiene a este ancho. Por eso funciona: cuando la carga se va,
 * lo que aparece debajo está donde el barrido dijo que estaba, y la transición
 * se lee como que la pantalla ya estaba ahí y solo faltaba luz.
 *
 * ## Por qué lienzo y no CSS
 *
 * Se probó primero con `clip-path` sobre un esqueleto de divs. Dos problemas:
 * el borde del barrido no puede llevar resplandor sin una segunda capa
 * duplicada, y el desplazamiento cromático del filo —que es lo que lo hace
 * parecer un escáner y no una persiana— pide pintar el mismo trazo tres veces
 * desplazado. En lienzo sale de un tirón y a coste fijo.
 */

import { leer, conAlfa } from './tinta.js';
import { barrer } from './ritmo.js';

/* El filo se dibuja tres veces, un canal por trazo y desplazadas un píxel y
   medio. Es la aberración cromática de una lente, y es lo que separa esto de
   una persiana bajando: sin ella el barrido se lee como un borde duro. */
const CANAL = ['rgba(255,90,90,', 'rgba(90,255,160,', 'rgba(90,170,255,'];

/* La retícula del panel, en proporción. `[x, y, ancho, alto]` en 0..1 sobre la
   caja útil. No es decorativa: es el reparto real de Resumen. */
const BLOQUES_ANCHO = [
  [0, 0.00, 1, 0.30],   // Resumen
  [0, 0.33, 1, 0.26],   // Precio de PLS
  [0, 0.62, 1, 0.38],   // lista
];
const BLOQUES_ESCRITORIO = [
  [0.00, 0.00, 0.48, 0.42], [0.52, 0.00, 0.48, 0.42],
  [0.00, 0.46, 0.48, 0.30], [0.52, 0.46, 0.48, 0.54],
  [0.00, 0.80, 0.48, 0.20],
];

/** Las rayas de dentro de una tarjeta: título, cifra grande, líneas de dato. */
function renglones(x, y, w, h) {
  const r = [];
  const m = Math.min(18, w * 0.06);
  r.push({ x: x + m, y: y + m, w: Math.min(w * 0.42, 120), h: 7, peso: 0.55 });
  /* La cifra grande va en trozos con hueco y no como una pastilla entera: una
     barra maciza de 210px de ancho se lee como un boton, y lo que hay ahi en el
     panel es un numero. Seis bloques con 5px de aire ya lo dicen. */
  const anchoCifra = Math.min(w * 0.66, 210);
  const trozo = (anchoCifra - 6 * 4) / 7;
  for (let k = 0; k < 7; k++) {
    // El cuarto lleva menos ancho: es el punto de los miles. Sin el, siete
    // bloques iguales se leen como una fila de botones y no como una cifra.
    const esPunto = k === 3;
    r.push({ x: x + m + k * (trozo + 4), y: y + m + 20 + (esPunto ? 15 : 0),
             w: esPunto ? trozo * 0.30 : trozo, h: esPunto ? 6 : 21,
             peso: 1, radio: 3 });
  }
  let yy = y + m + 58;
  while (yy < y + h - m - 8) {
    r.push({ x: x + m, y: yy, w: (w - m * 2) * (0.45 + ((yy * 7919) % 100) / 200), h: 6, peso: 0.32 });
    yy += 17;
  }
  return r;
}

export function montar(caja, { reducido = false, manual = false } = {}) {
  const capa = document.createElement('div');
  capa.className = 'cg cg-escaner';
  capa.innerHTML = '<p class="cg-marca">PLSDASH</p><p class="cg-pie">Revelando el panel</p>';
  const lienzo = document.createElement('canvas');
  lienzo.className = 'cg-lienzo';
  capa.insertBefore(lienzo, capa.firstChild);
  caja.appendChild(capa);

  const ctx = lienzo.getContext('2d');
  let w = 0, h = 0, dpr = 1, piezas = [], raf = 0;
  const marca = capa.querySelector('.cg-marca');
  const pie = capa.querySelector('.cg-pie');

  function medir() {
    const r = capa.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    lienzo.width = Math.round(w * dpr); lienzo.height = Math.round(h * dpr);
    lienzo.style.width = w + 'px'; lienzo.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // La caja útil: los mismos márgenes que `.marco`, y sitio arriba para la
    // marca y abajo para el pie, que si no el barrido les pasa por encima.
    const mx = Math.max(12, Math.min(40, w * 0.05));
    const arriba = 96, abajo = 78;
    const cx = mx, cy = arriba, cw = w - mx * 2, ch = Math.max(120, h - arriba - abajo);
    const reparto = w >= 820 ? BLOQUES_ESCRITORIO : BLOQUES_ANCHO;
    piezas = reparto.map(([px, py, pw, ph]) => {
      const x = cx + px * cw, y = cy + py * ch, bw = pw * cw, bh = ph * ch;
      return { x, y, w: bw, h: bh, rayas: renglones(x, y, bw, bh) };
    });
  }

  /**
   * Dibuja el estado a un avance dado.
   * `frente` es la y del barrido en píxeles; todo lo que esté por encima está
   * revelado y lo de abajo es radiografía.
   */
  function pintar(frente, brilloFrente) {
    const dato = leer('--dato', '#22d3ee');
    const acento = leer('--acento', '#ff8a3d');
    ctx.clearRect(0, 0, w, h);

    for (const p of piezas) {
      // El marco de la tarjeta.
      const revelado = frente >= p.y + p.h ? 1
        : frente <= p.y ? 0
        : (frente - p.y) / p.h;
      ctx.save();
      ctx.beginPath();
      const r = 16;
      ctx.roundRect(p.x, p.y, p.w, p.h, r);
      ctx.strokeStyle = dato;
      ctx.globalAlpha = 0.10 + 0.30 * revelado;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 0.02 + 0.05 * revelado;
      ctx.fillStyle = dato;
      ctx.fill();
      ctx.restore();

      for (const l of p.rayas) {
        const vis = frente >= l.y + l.h ? 1 : frente <= l.y ? 0 : (frente - l.y) / l.h;
        if (vis <= 0) continue;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(l.x, l.y, l.w * (0.35 + 0.65 * vis), l.h, l.radio ?? l.h / 2);
        // Todas del color del dato, pero la cifra grande al triple de fuerza.
        // Es lo que hace que el esqueleto se lea como un panel y no como un
        // formulario: la jerarquía, no el color.
        ctx.fillStyle = dato;
        ctx.globalAlpha = (l.peso >= 1 ? 0.55 : 0.20) * vis;
        ctx.fill();
        ctx.restore();
      }
    }

    if (brilloFrente > 0 && frente > 0 && frente < h) {
      // El filo: tres trazos desplazados un píxel, uno por canal. Es lo que
      // separa un escáner de una persiana bajando.
      for (const [canal, dy] of [[CANAL[0], -1.5], [CANAL[1], 0], [CANAL[2], 1.5]]) {
        ctx.beginPath();
        ctx.moveTo(0, frente + dy); ctx.lineTo(w, frente + dy);
        ctx.strokeStyle = canal + (0.30 * brilloFrente) + ')';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      // El núcleo del filo y su halo.
      const halo = ctx.createLinearGradient(0, frente - 46, 0, frente + 10);
      halo.addColorStop(0, conAlfa(acento, 0));
      halo.addColorStop(1, acento);
      ctx.globalAlpha = 0.16 * brilloFrente;
      ctx.fillStyle = halo;
      ctx.fillRect(0, frente - 46, w, 56);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, frente); ctx.lineTo(w, frente);
      ctx.strokeStyle = acento;
      ctx.globalAlpha = 0.85 * brilloFrente;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  medir();
  const obs = new ResizeObserver(medir); obs.observe(capa);

  /* Con movimiento reducido: el esqueleto entero revelado y quieto. Ni barrido
     ni filo. Se ve lo mismo, sin que nada se mueva. */
  if (reducido) {
    capa.dataset.quieto = '1';
    pintar(1e6, 0);
    return {
      entrada: () => Promise.resolve(),
      salida: () => { capa.dataset.fin = '1'; return new Promise(r => setTimeout(r, 240)); },
      destruir() { obs.disconnect(); capa.remove(); },
      _pintar: pintar,
    };
  }

  let t0 = 0, fase = 'entrada', resolverEntrada = null;
  const laEntrada = new Promise(r => { resolverEntrada = r; });
  let laSalida = null;

  function bucle(ahora) {
    if (!t0) t0 = ahora;
    const t = ahora - t0;
    if (fase === 'entrada') {
      // El barrido: 980 ms de arriba abajo con desaceleración.
      const p = Math.min(1, t / 1080);
      marca.style.opacity = String(Math.min(1, t / 420));
      if (t > 260) pie.dataset.ver = '1';
      pintar(barrer(p) * (h + 40), p < 1 ? 1 : 0);
      if (p >= 1) { fase = 'espera'; t0 = ahora; resolverEntrada?.(); }
    } else if (fase === 'espera') {
      /* Sostenido: un segundo barrido tenue, lentísimo y en bucle. Se puede
         quedar aquí diez segundos sin que se note que está esperando. */
      const p = ((t / 2600) % 1);
      pintar(1e6, 0);
      const y = p * (h + 60) - 30;
      const g = ctx.createLinearGradient(0, y - 60, 0, y + 60);
      const dato = leer('--dato', '#22d3ee');
      g.addColorStop(0, conAlfa(dato, 0)); g.addColorStop(0.5, dato); g.addColorStop(1, conAlfa(dato, 0));
      ctx.globalAlpha = 0.10; ctx.fillStyle = g; ctx.fillRect(0, y - 60, w, 120);
      ctx.globalAlpha = 1;
    }
    raf = requestAnimationFrame(bucle);
  }
  /* Ver la nota de `manual` en naciendo.js: las capturas no van por reloj. */
  if (!manual) raf = requestAnimationFrame(bucle);

  /* ⚠ `entrada()` y `salida()` devuelven SIEMPRE la misma promesa.
     No es una optimización: con `entrada: () => new Promise(r => resolver = r)`
     la segunda llamada pisaba `resolver` y la promesa de la PRIMERA no se
     resolvía nunca — el controlador se quedaba esperando para siempre y la
     pantalla no se iba. Lo cazó la prueba al mirar la entrada por su cuenta. */
  return {
    entrada: () => laEntrada,
    _instante(ms) {
      marca.style.opacity = String(Math.min(1, ms / 420));
      if (ms > 260) pie.dataset.ver = '1';
      const p2 = Math.min(1, ms / 1080);
      pintar(barrer(p2) * (h + 40), p2 < 1 ? 1 : 0);
    },
    salida() {
      if (laSalida) return laSalida;
      capa.dataset.fin = '1';
      capa.dataset.entregando = '1';
      laSalida = new Promise(r => setTimeout(r, 360));
      return laSalida;
    },
    destruir() { cancelAnimationFrame(raf); obs.disconnect(); capa.remove(); },
  };
}
