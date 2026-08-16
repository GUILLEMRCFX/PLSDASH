/**
 * Formateo compartido por los paneles. En es-ES: punto de millares y coma
 * decimal, que es como se leen los números aquí.
 */

/**
 * `useGrouping: 'always'` a propósito. La regla tipográfica española no pone
 * punto de millar en los números de cuatro cifras, y `toLocaleString` la
 * respeta: 7585 sale sin punto. Pero estas cifras se leen en fila —77.932,
 * 7585, 85.265— y ahí la que no lleva punto parece rota o de otra magnitud.
 * En una columna de datos manda la comparación, no la regla.
 */
export const fmt = (n, d = 0) =>
  Number(n ?? 0).toLocaleString('es-ES', {
    minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always',
  });

/** Millones y miles abreviados. Para cifras grandes que no necesitan precisión. */
export const fmtCompacto = n => {
  n = Number(n ?? 0);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + 'K';
  return fmt(n);
};

/**
 * Precio de PLS. Cotiza sobre 0,00003 $, así que con decimales normales serían
 * todo ceros: se usa el subíndice que cuenta cuántos hay, como en los
 * agregadores. Misma función que el panel de /val/.
 */
export const fmtPrecio = precio => {
  if (!(precio > 0)) return '–';
  const exp = Math.floor(Math.log10(precio));
  if (exp >= -4) return precio.toFixed(6).replace('.', ',');
  const ceros = -exp - 1;
  const digitos = Math.round(precio * Math.pow(10, ceros + 4));
  return `0,0${'₀₁₂₃₄₅₆₇₈₉'[ceros]}${digitos}`;
};

/** Duración en horas → «19 h» o «7,9 días». */
export const fmtHoras = h => {
  h = Number(h) || 0;
  return h < 48 ? `${fmt(h, 1)} h` : `${fmt(h / 24, 1)} días`;
};

/** Antigüedad en segundos → «hace 12 min». */
export const fmtEdad = s => {
  s = Math.max(0, Number(s) || 0);
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
};

export const escapar = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
