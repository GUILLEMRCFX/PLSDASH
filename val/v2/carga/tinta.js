/**
 * Leer los colores del tema desde un lienzo.
 *
 * Las candidatas pintan en `<canvas>`, donde no hay variables CSS: hay que
 * resolverlas a mano. Y hay que resolverlas BIEN, porque los tokens del tema no
 * están todos en el mismo formato —`--fondo` del tema Núcleo es `#000`, de tres
 * cifras— y concatenar un `'80'` al final de un hexadecimal de tres da un color
 * que el lienzo descarta en silencio: no falla, no pinta.
 */

const cache = new Map();

/** El valor de una variable del tema, tal cual está escrito. */
export function leer(nombre, deReserva = '#22d3ee') {
  const clave = nombre + '|' + (document.documentElement.dataset.tema || '');
  if (cache.has(clave)) return cache.get(clave);
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || deReserva;
  cache.set(clave, v);
  return v;
}

/** Al cambiar de tema se tira la caché: los colores son otros. */
window.addEventListener('plsdash:tema', () => cache.clear());

/** `#rgb` o `#rrggbb` → `[r, g, b]`. Cualquier otra cosa devuelve `null`. */
export function canales(hex) {
  const s = String(hex).trim();
  if (s[0] !== '#') return null;
  if (s.length === 4) return [1, 2, 3].map(i => parseInt(s[i] + s[i], 16));
  if (s.length === 7) return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  return null;
}

/** El mismo color con la opacidad que se pida, siempre en `rgba()`. */
export function conAlfa(color, a) {
  const c = canales(color);
  if (!c) return color;
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** Atajo: la variable del tema, directamente con alfa. */
export const tinta = (nombre, a = 1, deReserva) => conAlfa(leer(nombre, deReserva), a);
