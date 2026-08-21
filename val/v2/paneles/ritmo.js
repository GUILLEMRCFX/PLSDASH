/**
 * Ritmo de ganancias — por hora, día, semana, mes y año, en PLS y en dólares.
 *
 * ## Dónde vive, y por qué ya no es un panel
 *
 * Fue un panel propio mientras el tablero era una sola pantalla de ocho
 * paneles. Con las cuatro pestañas, el ritmo es lo primero que hay que
 * responder —«¿cuánto llevo y a qué velocidad?»— así que se ha mudado DENTRO
 * del panel de Resumen, que es el que se mira veinte veces al día.
 *
 * Lo que queda aquí es la tabla: el cálculo, la conversión a dólares y la nota
 * de procedencia. Este módulo no dibuja panel porque el ritmo enseñado dos
 * veces —una en Resumen y otra en un panel propio— serían los mismos cinco
 * números con dos rótulos distintos, que es exactamente lo que se evitó cuando
 * «Media por día» salió del panel de Ganancias.
 *
 * ⚠ Por esa misma razón, «Media por día» NO vuelve al panel de Ganancias: era
 *   este mismo `ritmoDiario()` y su sitio es la fila «Día» de esta tabla.
 *
 * ## El cálculo
 *
 * Sencillo a propósito: el ritmo diario medido, multiplicado por cada periodo,
 * y convertido a dólares con el precio actual. Mes y año usan 30,44 y 365,25
 * días —la media real— y no 30 y 365, que arrastrarían un 1,4% de error anual
 * gratis.
 *
 * No se distingue lo medido de lo extrapolado: es una proyección entera y así
 * se dice, en una nota discreta. Bailará, sobre todo por el precio, y quien
 * mira esto ya lo sabe: no hace falta un aviso grande.
 */

import { ritmoDiario } from '/val/compartido/ganancias.js';
import { fmt, fmtEdad, escapar } from './formato.js';

// Días por periodo. La media real, no números redondos.
export const PERIODOS = [
  ['Hora',   1 / 24],
  ['Día',    1],
  ['Semana', 7],
  ['Mes',    30.44],
  ['Año',    365.25],
];

/**
 * Los dólares con dos decimales salvo que sean céntimos: a 0,00001 $ el PLS,
 * la hora da menos de un céntimo y «0,00 $» no dice nada.
 */
const fmtUsd = usd => (usd < 0.01 ? '&lt;0,01 $' : `${fmt(usd, 2)} $`);

/**
 * La tabla del ritmo, para incrustar donde haga falta.
 *
 * La nota lleva SIEMPRE la procedencia del ritmo —«media de 7 días», «medido en
 * 3 h»—, porque de eso depende cuánto vale la proyección: siete días cerrados y
 * tres horas que pueden haber pillado una propuesta de bloque no merecen la
 * misma confianza, y la cifra sale idéntica en los dos casos.
 *
 * @returns {object|null} { html, nota } — o null si aún no hay ritmo medible,
 *   para que quien la pida decida qué decir en su sitio.
 */
export function tablaRitmo(datos) {
  const { estado, serie, snapshots24h, precio } = datos;

  const ritmo = ritmoDiario({
    serie, snapshots24h, plsDiaKV: estado?.validadores?.pls_dia, fmt,
  });
  if (!ritmo || !(ritmo.pls_dia > 0)) return null;

  const hayPrecio = precio && precio.disponible !== false && precio.precio > 0;
  const precioViejo = hayPrecio && precio.obsoleto;

  const filas = PERIODOS.map(([nombre, dias]) => {
    const pls = ritmo.pls_dia * dias;
    return `
      <div class="rfila">
        <span class="r-per">${escapar(nombre)}</span>
        <span class="r-pls">${fmt(pls)}<span class="u">PLS</span></span>
        ${hayPrecio ? `<span class="r-usd">${fmtUsd(pls * precio.precio)}</span>` : ''}
      </div>`;
  }).join('');

  return {
    html: `<div class="rlista${hayPrecio ? '' : ' sin-usd'}">${filas}</div>`,
    // Corta a propósito: en «Resumen» esta línea tiene que caber en una sola a
    // 390px, y cada línea de más empuja el panel fuera de la primera pantalla.
    nota: `${
      hayPrecio
        ? `Proyección · ${ritmo.base} · precio ${
            precioViejo ? fmtEdad(precio.edad_s) : 'actual'}.`
        : `Proyección · ${ritmo.base}. Sin precio de PLS: no se convierte a dólares.`
    }${ritmo.provisional ? ' El ritmo aún es provisional.' : ''}`,
  };
}
