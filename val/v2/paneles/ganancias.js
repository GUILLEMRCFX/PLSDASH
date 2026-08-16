/**
 * Panel 2 — Ganancias.
 *
 * Total generado (PLS y dólares), lo de hoy, lo de la última hora cerrada y la
 * media por día.
 *
 * ⚠ La fuente NO es el balance de los validadores. `snapshots.ganado` es solo
 *   el excedente sin barrer y cada ~8,1 h el protocolo lo retira dejándolo a
 *   cero: leer de ahí daría una cifra que baja sola cada ocho horas. La
 *   ganancia real son los barridos acumulados (tabla `barridos`, reconciliada
 *   contra la cadena por /api/val/ganancia) más lo que aún no se ha barrido.
 *
 * Toda esa lógica vive en /val/compartido/ganancias.js, compartida con /val/.
 * Ahí está también el porqué de no usar `snapshots.pls_hora` ni
 * `daily.ganado_dia`, que son dos trampas que parecen el dato bueno.
 */

import {
  gananciaAcumulada, ritmoDiario, ultimaHora, generadoHoy,
} from '/val/compartido/ganancias.js';
import { ACTIVACION_TS } from '../datos.js';
import { fmt, fmtEdad, escapar } from './formato.js';

export const TITULO = 'Ganancias';

/** Una cifra en PLS con su etiqueta. */
const cifraPLS = (pls, etiqueta, sub = '') => `
  <div class="cifra">
    <span class="c-num">${pls == null ? '–' : fmt(pls)}<span class="u">PLS</span></span>
    <span class="c-eti">${escapar(etiqueta)}</span>
    ${sub ? `<span class="c-sub">${escapar(sub)}</span>` : ''}
  </div>`;

export function panelGanancias(datos) {
  const { estado, serie, snapshots24h, ganancia, precio } = datos;

  if (!estado && !serie.length) {
    return `
      <section class="panel" data-alerta aria-labelledby="pgan-t">
        <header class="p-cab"><h2 id="pgan-t">${TITULO}</h2></header>
        <p class="p-aviso">Sin serie de snapshots: no se puede calcular la ganancia.</p>
      </section>`;
  }

  const acum = gananciaAcumulada({ estado, ganancia, serie, activacionTs: ACTIVACION_TS });
  const ritmo = ritmoDiario({
    serie, snapshots24h, plsDiaKV: estado?.validadores?.pls_dia, fmt,
  });
  const hora = ultimaHora(serie);
  const hoy = generadoHoy(serie);

  // El precio: fresco convierte, obsoleto convierte pero lo dice, y sin precio
  // no se convierte. Nunca un cero de relleno ni una cifra inventada.
  const hayPrecio = precio && precio.disponible !== false && precio.precio > 0;
  const precioViejo = hayPrecio && precio.obsoleto;

  let dolares = '';
  if (acum && hayPrecio) {
    const usd = acum.total * precio.precio;
    dolares = precioViejo
      ? `<span class="c-sub alerta">≈ ${fmt(usd, 2)} $ · precio ${fmtEdad(precio.edad_s)}, no está fresco</span>`
      : `<span class="c-sub">≈ ${fmt(usd, 2)} $</span>`;
  } else if (acum) {
    dolares = '<span class="c-sub alerta">Sin precio de PLS: no se convierte a dólares.</span>';
  }

  // De dónde sale el total. Sin esto, una cifra que incluye barridos es
  // indistinguible de una que no, y ese error ya fue invisible una vez.
  const procedencia = acum
    ? `${fmt(acum.barrido)} retirados en ${fmt(acum.barridos)} barrido${acum.barridos === 1 ? '' : 's'}`
      + ` · ${fmt(acum.excedente)} sin barrer`
      + (acum.fuente === 'snapshots' && !acum.completo ? ' · suelo: falta lo anterior al registro' : '')
    : null;

  return `
    <section class="panel" aria-labelledby="pgan-t">
      <header class="p-cab">
        <h2 id="pgan-t">${TITULO}</h2>
        ${precioViejo ? '<span class="p-marca alerta">Precio no fresco</span>' : ''}
      </header>

      <div class="cifra">
        <span class="c-num">${acum ? fmt(acum.total) : '–'}<span class="u">PLS</span></span>
        <span class="c-eti">Total generado</span>
        ${dolares}
      </div>

      <div class="rejilla">
        ${cifraPLS(hoy ? hoy.ganado_dia : null, 'Hoy · UTC')}
        ${cifraPLS(hora ? hora.pls : null, 'Última hora')}
        ${cifraPLS(ritmo?.pls_dia, 'Media por día', ritmo?.provisional ? `${ritmo.base} · provisional` : ritmo?.base)}
      </div>

      ${procedencia ? `<p class="c-sub">${escapar(procedencia)}</p>` : ''}
    </section>`;
}
