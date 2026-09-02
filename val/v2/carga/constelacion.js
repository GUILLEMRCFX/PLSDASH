/**
 * La constelación.
 *
 * Once nodos se confirman uno a uno y se van uniendo. Diez son los validadores
 * que hay; el once es el que falta —el del depósito— y por eso entra el último,
 * en naranja y sin cerrar del todo su enlace. La pantalla de carga cuenta, sin
 * una sola cifra, exactamente lo mismo que el panel que viene detrás.
 *
 * ## El reparto de los puntos
 *
 * No es un círculo. Un círculo de once puntos equiespaciados se lee como un
 * reloj y las cuerdas que lo cruzan hacen un patrón de moiré. Se usa una espiral
 * de Fermat —el ángulo áureo, el mismo que reparte las pipas de un girasol—:
 * ningún par de puntos queda alineado con el centro y las distancias entre
 * vecinos son casi iguales, que es justo lo que hace que la red se lea como red.
 *
 * ## Los enlaces
 *
 * Cada nodo, al confirmarse, tira una línea a los DOS más cercanos que ya estén
 * confirmados. Así la figura crece por contigüidad —como se propaga algo por una
 * red— en vez de aparecer entera de golpe. El orden de confirmación no es el de
 * la espiral sino el de cercanía al centro, para que crezca de dentro afuera.
 */

import { leer, conAlfa } from './tinta.js';
import { frenar, suave } from './ritmo.js';

const N = 11;
const AUREO = Math.PI * (3 - Math.sqrt(5));   // 2,39996… rad

/** Cuándo entra cada nodo, en ms desde el arranque. */
const PRIMER_NODO = 120;
const PASO_NODO = 62;
const T_ENTRADA = PRIMER_NODO + N * PASO_NODO + 320;   // 934 ms

function repartir(w, h) {
  const cx = w / 2, cy = h / 2;
  /* 0,40 y no 0,32: a 390 el racimo se quedaba en 125px de radio y flotaba
     perdido en una pantalla de 844 de alto. Se acota contra el alto útil para
     que en escritorio no se desparrame. */
  const radio = Math.min(w * 0.40, h * 0.30, 260);
  const puntos = [];
  for (let i = 0; i < N; i++) {
    // Fermat: r ∝ √i, θ = i · ángulo áureo. El 0,5 desplaza el primero fuera
    // del centro exacto, que si no queda un punto solo en medio.
    const r = radio * Math.sqrt((i + 0.5) / N);
    const a = i * AUREO;
    puntos.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, i,
                  falta: i === N - 1, d: r });
  }
  // De dentro afuera: la red crece desde el núcleo.
  puntos.sort((p, q) => p.d - q.d);
  // El que falta siempre el último, sea cual sea su radio.
  const falta = puntos.findIndex(p => p.falta);
  puntos.push(puntos.splice(falta, 1)[0]);
  puntos.forEach((p, k) => { p.orden = k; });

  /* Centrar de verdad. La espiral de Fermat con once puntos NO queda centrada
     en el origen —su centro de masas se va hacia donde caen los últimos—, y en
     la tira de contacto el racimo salía arriba y a la izquierda con un palmo de
     negro debajo. Se recoloca por la caja que ocupa, no por la fórmula. */
  const xs = puntos.map(p => p.x), ys = puntos.map(p => p.y);
  const dx = cx - (Math.min(...xs) + Math.max(...xs)) / 2;
  const dy = cy - (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const p of puntos) { p.x += dx; p.y += dy; }

  // Los enlaces: cada uno a los dos ya confirmados más cercanos.
  const enlaces = [];
  for (let k = 1; k < puntos.length; k++) {
    const p = puntos[k];
    const previos = puntos.slice(0, k)
      .map(q => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { q } of previos) enlaces.push({ a: q, b: p, desde: k });
  }
  return { puntos, enlaces };
}

export function montar(caja, { reducido = false, manual = false } = {}) {
  const capa = document.createElement('div');
  capa.className = 'cg cg-constelacion';
  capa.innerHTML = '<p class="cg-marca">PLSDASH</p><p class="cg-pie">Confirmando validadores</p>';
  const lienzo = document.createElement('canvas');
  lienzo.className = 'cg-lienzo';
  capa.insertBefore(lienzo, capa.firstChild);
  caja.appendChild(capa);

  const ctx = lienzo.getContext('2d');
  const marca = capa.querySelector('.cg-marca');
  const pie = capa.querySelector('.cg-pie');
  let w = 0, h = 0, red = null, raf = 0;

  function medir() {
    const r = capa.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    lienzo.width = Math.round(w * dpr); lienzo.height = Math.round(h * dpr);
    lienzo.style.width = w + 'px'; lienzo.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    red = repartir(w, h);
  }

  /**
   * `t` en ms desde el arranque de la entrada. `pulso` es el latido de la fase
   * de espera, en radianes, o `null` si aún no se está esperando.
   */
  function pintar(t, pulso = null) {
    const dato = leer('--dato', '#22d3ee');
    const acento = leer('--acento', '#ff8a3d');
    ctx.clearRect(0, 0, w, h);
    if (!red) return;

    const nacido = k => (t - (PRIMER_NODO + k * PASO_NODO)) / 380;   // 0..1+

    // Enlaces primero: por debajo de los nodos.
    for (const e of red.enlaces) {
      const v = Math.min(1, Math.max(0, nacido(e.desde)));
      if (v <= 0) continue;
      const p = suave(v);
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.a.x + (e.b.x - e.a.x) * p, e.a.y + (e.b.y - e.a.y) * p);
      // El enlace del que falta queda a medio brillo: no está confirmado.
      const base = e.b.falta ? 0.22 : 0.38;
      const late = pulso == null ? 0 : Math.sin(pulso + e.desde * 0.5) * 0.10;
      ctx.strokeStyle = conAlfa(e.b.falta ? acento : dato, Math.max(0, base + late) * p);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const n of red.puntos) {
      const v = nacido(n.orden);
      if (v <= 0) continue;
      const p = Math.min(1, suave(v));
      const color = n.falta ? acento : dato;

      // El fogonazo de confirmación: un aro que se abre y se apaga en 380 ms.
      if (v < 1) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 3 + 30 * frenar(v), 0, Math.PI * 2);
        ctx.strokeStyle = conAlfa(color, 0.5 * (1 - v));
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      const late = pulso == null ? 1 : 1 + Math.sin(pulso + n.orden * 0.7) * 0.12;
      // El halo.
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 16 * late);
      g.addColorStop(0, conAlfa(color, 0.42 * p));
      g.addColorStop(1, conAlfa(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(n.x, n.y, 16 * late, 0, Math.PI * 2); ctx.fill();
      // El núcleo. El que falta va hueco: se ve el sitio, no el nodo.
      ctx.beginPath();
      ctx.arc(n.x, n.y, 3.1 * p, 0, Math.PI * 2);
      if (n.falta) { ctx.strokeStyle = conAlfa(color, 0.9 * p); ctx.lineWidth = 1.4; ctx.stroke(); }
      else { ctx.fillStyle = conAlfa(color, 0.95 * p); ctx.fill(); }
    }
  }

  medir();
  const obs = new ResizeObserver(medir); obs.observe(capa);

  if (reducido) {
    capa.dataset.quieto = '1';
    pintar(1e5);
    return {
      entrada: () => Promise.resolve(),
      salida: () => { capa.dataset.fin = '1'; return new Promise(r => setTimeout(r, 240)); },
      destruir() { obs.disconnect(); capa.remove(); },
    };
  }

  let t0 = 0, resolverEntrada = null, esperando = false;
  const laEntrada = new Promise(r => { resolverEntrada = r; });
  let laSalida = null;
  function bucle(ahora) {
    if (!t0) t0 = ahora;
    const t = ahora - t0;
    marca.style.opacity = String(Math.min(1, t / 420));
    if (t > 240) pie.dataset.ver = '1';
    if (!esperando && t >= T_ENTRADA) { esperando = true; resolverEntrada?.(); }
    // En la espera la figura late despacio: sostenible sin fin y sin costura,
    // porque el latido arranca en el mismo valor con el que acabó la entrada.
    pintar(t, esperando ? (t - T_ENTRADA) / 620 : null);
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
      if (ms > 240) pie.dataset.ver = '1';
      pintar(ms, ms >= T_ENTRADA ? (ms - T_ENTRADA) / 620 : null);
    },
    salida() {
      if (laSalida) return laSalida;
      capa.dataset.fin = '1';
      laSalida = new Promise(r => setTimeout(r, 360));
      return laSalida;
    },
    destruir() { cancelAnimationFrame(raf); obs.disconnect(); capa.remove(); },
  };
}
