/**
 * La compuerta.
 *
 * Un iris mecánico abriéndose. Es el mismo gesto que la cripta de la portada
 * —algo cerrado que se abre porque tienes derecho a entrar— y por eso encaja
 * aquí: el panel es privado, y esta es la única de las cuatro que lo dice.
 *
 * ## Cómo se construye un iris que parezca un iris
 *
 * Nueve palas, y nueve por algo: con un número par las palas quedan enfrentadas
 * de dos en dos y la abertura sale como un polígono regular con lados
 * paralelos, que se lee como una tuerca. Con número impar ningún lado tiene
 * enfrente otro paralelo — es lo que hacen los objetivos de verdad y es la
 * mitad del efecto.
 *
 * Cada pala es un CÍRCULO de radio `rb` con el centro a distancia `dc` del eje.
 * La abertura que dejan entre todas tiene radio `dc − rb`: con `dc` pequeño el
 * número es negativo y la compuerta está cerrada; al crecer `dc`, se abre. El
 * borde festoneado que queda es exactamente el de un diafragma real, y sale
 * gratis de la geometría en vez de dibujarlo a mano.
 *
 * Se pintan en orden y opacas, así que cada una tapa a la anterior: eso es lo
 * que hace visible el solape de las palas, que es de donde viene la lectura
 * mecánica. Sin el solape son nueve arcos flotando.
 *
 * Y el grupo entero gira mientras abre. Un diafragma que abre sin girar parece
 * un obturador de persiana; el giro es lo que dice «esto tiene un anillo».
 */

import { leer, conAlfa } from './tinta.js';
import { suave, frenar } from './ritmo.js';

const PALAS = 9;
const R = 86;              // radio del alojamiento, en unidades del viewBox
const RB = 74;             // radio de cada pala
const DC_CERRADO = 26;     // abertura = 26 − 74 < 0 → cerrada del todo
const DC_ABIERTO = 128;    // abertura = 54
const GIRO = 26;           // grados que gira el anillo al abrir

const T_ABRIR = 1050;
const T_POSAR = 180;

let n = 0;                 // para que dos instancias no compartan ids

export function montar(caja, { reducido = false, manual = false } = {}) {
  const id = 'cgIris' + (++n);
  const capa = document.createElement('div');
  capa.className = 'cg cg-compuerta';

  const palas = Array.from({ length: PALAS }, (_, i) =>
    `<circle class="cg-ir-pala" data-i="${i}" r="${RB}" cx="0" cy="0"/>`).join('');

  // El anillo del alojamiento: 36 marcas, una cada 10°, con las de cada 90°
  // más largas. Es la escala de un objetivo.
  const marcas = Array.from({ length: 36 }, (_, i) => {
    const a = (i * 10 - 90) * Math.PI / 180;
    const larga = i % 9 === 0;
    const r1 = R + 7, r2 = R + (larga ? 16 : 11);
    return `<line x1="${(Math.cos(a) * r1).toFixed(2)}" y1="${(Math.sin(a) * r1).toFixed(2)}"`
         + ` x2="${(Math.cos(a) * r2).toFixed(2)}" y2="${(Math.sin(a) * r2).toFixed(2)}"`
         + ` class="cg-ir-marca${larga ? ' larga' : ''}"/>`;
  }).join('');

  capa.innerHTML = [
    '<svg class="cg-ir" viewBox="-120 -120 240 240" aria-hidden="true">',
    '<defs>',
    `<clipPath id="${id}rec"><circle r="${R}"/></clipPath>`,
    `<radialGradient id="${id}nuc">`,
    '<stop class="cg-ir-n0" offset="0"/><stop class="cg-ir-n1" offset="0.55"/>',
    '<stop class="cg-ir-n2" offset="1"/>',
    '</radialGradient>',
    '</defs>',
    `<circle class="cg-ir-nucleo" r="${R}" fill="url(#${id}nuc)"/>`,
    `<g class="cg-ir-anillo" clip-path="url(#${id}rec)">${palas}</g>`,
    `<circle class="cg-ir-borde" r="${R}"/>`,
    `<g class="cg-ir-escala">${marcas}</g>`,
    '</svg>',
    '<p class="cg-marca">PLSDASH</p><p class="cg-pie">Abriendo el panel</p>',
  ].join('');
  caja.appendChild(capa);

  const anillo = capa.querySelector('.cg-ir-anillo');
  const circulos = [...capa.querySelectorAll('.cg-ir-pala')];
  const nucleo = capa.querySelector('.cg-ir-nucleo');
  const marca = capa.querySelector('.cg-marca');
  const pie = capa.querySelector('.cg-pie');

  /** `p` de 0 (cerrada) a 1 (abierta). */
  function colocar(p) {
    const dc = DC_CERRADO + (DC_ABIERTO - DC_CERRADO) * p;
    circulos.forEach((c, i) => {
      const a = (i * 360 / PALAS) * Math.PI / 180;
      c.setAttribute('cx', (Math.cos(a) * dc).toFixed(2));
      c.setAttribute('cy', (Math.sin(a) * dc).toFixed(2));
    });
    anillo.setAttribute('transform', `rotate(${(GIRO * (1 - p)).toFixed(2)})`);
    // El núcleo solo se ve por el hueco, así que su brillo va con la abertura.
    nucleo.style.opacity = String(0.15 + 0.85 * p);
  }

  // Los colores del tema, resueltos una vez y puestos como atributos: el SVG
  // vive en el mismo documento, pero los `stop` de un gradiente no heredan
  // `currentColor` en todos los motores.
  const dato = leer('--dato', '#22d3ee');
  capa.querySelector('.cg-ir-n0').setAttribute('stop-color', conAlfa(dato, 0.55));
  capa.querySelector('.cg-ir-n1').setAttribute('stop-color', conAlfa(dato, 0.16));
  capa.querySelector('.cg-ir-n2').setAttribute('stop-color', conAlfa(dato, 0));

  if (reducido) {
    capa.dataset.quieto = '1';
    colocar(1);
    return {
      entrada: () => Promise.resolve(),
      salida: () => { capa.dataset.fin = '1'; return new Promise(r => setTimeout(r, 240)); },
      destruir() { capa.remove(); },
    };
  }

  colocar(0);
  let raf = 0, t0 = 0, resolverEntrada = null, esperando = false;
  const laEntrada = new Promise(r => { resolverEntrada = r; });
  let laSalida = null;

  function bucle(ahora) {
    if (!t0) t0 = ahora;
    const t = ahora - t0;
    marca.style.opacity = String(Math.min(1, Math.max(0, (t - 200) / 480)));
    if (t > 380) pie.dataset.ver = '1';

    if (!esperando) {
      colocar(suave(Math.min(1, t / T_ABRIR)));
      if (t >= T_ABRIR + T_POSAR) { esperando = true; t0 = ahora; resolverEntrada?.(); }
    } else {
      /* Sostenido: la compuerta respira un pelo, medio grado arriba y abajo.
         Arranca justo en 1, así que no hay salto entre abrir y esperar. */
      const s = Math.sin((t / 1500) * Math.PI * 2);
      colocar(1 - 0.018 * (1 - Math.cos((t / 1500) * Math.PI * 2)) / 2);
      nucleo.style.opacity = String(0.92 + 0.08 * s);
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
      marca.style.opacity = String(Math.min(1, Math.max(0, (ms - 200) / 480)));
      if (ms > 380) pie.dataset.ver = '1';
      colocar(suave(Math.min(1, ms / T_ABRIR)));
    },
    salida() {
      if (laSalida) return laSalida;
      // Se abre del todo y se va: las palas salen del alojamiento y el panel
      // queda donde estaba el núcleo.
      capa.dataset.fin = '1';
      capa.dataset.entregando = '1';
      const t1 = performance.now();
      laSalida = new Promise(r => {
        const abrir = ahora => {
          const p = Math.min(1, (ahora - t1) / 420);
          colocar(1 + 0.75 * frenar(p));
          if (p < 1) requestAnimationFrame(abrir); else r();
        };
        requestAnimationFrame(abrir);
      });
      return laSalida;
    },
    destruir() { cancelAnimationFrame(raf); capa.remove(); },
  };
}
