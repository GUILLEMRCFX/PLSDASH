/**
 * Panel — Ritmo de ganancias.
 *
 * Cuánto se genera por hora, día, semana, mes y año, en PLS y en dólares.
 *
 * ## Dónde va, y por qué
 *
 * Va como panel PROPIO y el PRIMERO de la columna izquierda: en escritorio es
 * la esquina superior izquierda, y en móvil el primer panel bajo la esfera. Es
 * el dato que más se consulta, así que ocupa el sitio que primero mira el ojo.
 *
 * No va dentro de «Ganancias» porque responden preguntas distintas: aquel
 * enseña lo que YA se ha ganado —total, hoy, última hora—, hechos medidos.
 * Este enseña un RITMO proyectado, que es otra clase de número y no debe
 * mezclarse con los primeros: si van juntos, en un par de meses nadie
 * recuerda cuáles se midieron y cuáles se extrapolaron.
 *
 * ⚠ Por esa misma razón, «Media por día» sale del panel de Ganancias y vive
 *   aquí como la fila «Día». Era exactamente este número —`ritmoDiario()`— y
 *   tenerlo en los dos sitios lo enseñaría dos veces con dos rótulos
 *   distintos. Si prefieres recuperarlo allí, es una línea.
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
 * mira este panel ya lo sabe: no hace falta un aviso grande.
 */

import { ritmoDiario } from '/val/compartido/ganancias.js';
import { fmt, fmtEdad, escapar } from './formato.js';

export const TITULO = 'Ritmo de ganancias';

// Días por periodo. La media real, no números redondos.
const PERIODOS = [
  ['Hora',   1 / 24],
  ['Día',    1],
  ['Semana', 7],
  ['Mes',    30.44],
  ['Año',    365.25],
];

export function panelRitmo(datos) {
  const { estado, serie, snapshots24h, precio } = datos;

  const ritmo = ritmoDiario({
    serie, snapshots24h, plsDiaKV: estado?.validadores?.pls_dia, fmt,
  });

  if (!ritmo || !(ritmo.pls_dia > 0)) {
    return `
      <section class="panel" aria-labelledby="pr-t">
        <header class="p-cab"><h2 id="pr-t">${TITULO}</h2></header>
        <p class="vacio">Sin ritmo medible todavía.</p>
      </section>`;
  }

  const hayPrecio = precio && precio.disponible !== false && precio.precio > 0;
  const precioViejo = hayPrecio && precio.obsoleto;

  const filas = PERIODOS.map(([nombre, dias]) => {
    const pls = ritmo.pls_dia * dias;
    // Los dólares con dos decimales salvo que sean céntimos: a 0,00001 $ el
    // PLS, la hora da menos de un céntimo y «0,00 $» no dice nada.
    const usd = hayPrecio ? pls * precio.precio : null;
    const usdTxt = usd == null ? ''
      : usd < 0.01 ? '&lt;0,01 $'
      : `${fmt(usd, 2)} $`;
    return `
      <div class="rfila">
        <span class="r-per">${escapar(nombre)}</span>
        <span class="r-pls">${fmt(pls)}<span class="u">PLS</span></span>
        ${hayPrecio ? `<span class="r-usd">${usdTxt}</span>` : ''}
      </div>`;
  }).join('');

  return `
    <section class="panel" aria-labelledby="pr-t">
      <header class="p-cab">
        <h2 id="pr-t">${TITULO}</h2>
        <span class="p-marca${precioViejo ? ' alerta' : ''}">${
          precioViejo ? 'Precio no fresco' : escapar(ritmo.base)
        }</span>
      </header>

      <div class="rlista${hayPrecio ? '' : ' sin-usd'}">${filas}</div>

      <p class="c-sub">${
        hayPrecio
          ? `Proyección al ritmo y precio actuales${
              precioViejo ? ` · precio ${fmtEdad(precio.edad_s)}` : ''}.`
          : 'Proyección al ritmo actual. Sin precio de PLS: no se convierte a dólares.'
      }${ritmo.provisional ? ' El ritmo aún es provisional.' : ''}</p>
    </section>`;
}
