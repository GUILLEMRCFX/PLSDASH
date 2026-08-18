/**
 * Panel — Trayectoria al siguiente validador.
 *
 * Cuánto falta para reunir otro depósito completo, al ritmo actual.
 *
 * ⚠ El número del objetivo NO se escribe. Sale de `validadores.total + 1`, que
 *   es el recuento real del estado. Estuvo fijo en «#11» hasta que el #11
 *   entró de verdad y el panel se quedó apuntando a un objetivo ya cumplido:
 *   un panel que celebra una meta pasada es peor que no tenerlo. Ahora avanza
 *   solo, y el mismo día que entre el #12 pasará a apuntar al #13.
 *
 *   Se usa `total` y no `activos` a propósito: un validador propio que esté
 *   temporalmente inactivo sigue siendo tuyo y su depósito ya está puesto, así
 *   que no hay que volver a reunirlo.
 *
 * ## Qué cuenta como «reunido»
 *
 * El saldo real de la wallet (`ganancia.saldo_wallet`), que es el dinero que
 * de verdad ha llegado, leído de la cadena. No lo generado: entre generar y
 * tener hay barridos pendientes y cualquier movimiento que se haya hecho, y
 * para «¿me llega para otro validador?» lo que cuenta es lo que hay.
 *
 * Si el explorador no responde, se cae a la ganancia acumulada y se dice, en
 * vez de enseñar un progreso que no se sabe de dónde sale.
 *
 * El depósito no se escribe a fuego: sale de `stake_total / total`, así que si
 * cambia el tamaño del depósito esto sigue valiendo.
 *
 * No hay escenarios de aportación mensual: solo el ritmo actual.
 */

import { gananciaAcumulada, ritmoDiario } from '/val/compartido/ganancias.js';
import { ACTIVACION_TS } from '../datos.js';
import { fmt, fmtCompacto, escapar } from './formato.js';

/**
 * El objetivo es el siguiente al que ya se tiene. Si no hay recuento todavía,
 * se dice «siguiente validador» en vez de inventarse un número.
 */
export function tituloObjetivo(estado) {
  const total = Number(estado?.validadores?.total);
  return Number.isFinite(total) && total > 0
    ? `Validador #${total + 1}`
    : 'Siguiente validador';
}

/** Días → «11 meses», «1,4 años», «23 días». */
function fmtPlazo(dias) {
  if (!Number.isFinite(dias) || dias <= 0) return null;
  if (dias < 60) return `${fmt(dias, 0)} días`;
  if (dias < 730) return `${fmt(dias / 30.44, 0)} meses`;
  return `${fmt(dias / 365.25, 1)} años`;
}

export function panelTrayectoria(datos) {
  const { estado, serie, snapshots24h, ganancia, precio, ahoraS } = datos;
  const v = estado?.validadores || {};

  const titulo = tituloObjetivo(estado);
  const deposito = Number(v.total) > 0 ? Number(v.stake_total) / Number(v.total) : null;
  const acum = gananciaAcumulada({ estado, ganancia, serie, activacionTs: ACTIVACION_TS });

  // Preferencia: el saldo de la wallet. Si no hay, lo generado, y se avisa.
  const deWallet = ganancia && ganancia.saldo_wallet != null;
  const reunido = deWallet ? Number(ganancia.saldo_wallet) : (acum ? acum.total : null);

  if (!deposito || reunido == null) {
    return `
      <section class="panel" aria-labelledby="pt-t">
        <header class="p-cab"><h2 id="pt-t">${escapar(titulo)}</h2></header>
        <p class="vacio">Faltan datos para calcular la trayectoria.</p>
      </section>`;
  }

  const falta = Math.max(0, deposito - reunido);
  const pct = Math.max(0, Math.min(100, (reunido / deposito) * 100));

  const ritmo = ritmoDiario({
    serie, snapshots24h, plsDiaKV: v.pls_dia, fmt,
  });
  const dias = ritmo?.pls_dia > 0 ? falta / ritmo.pls_dia : null;
  const plazo = fmtPlazo(dias);
  const fecha = dias != null
    ? new Date((ahoraS + dias * 86400) * 1000)
        .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
    : null;

  const hayPrecio = precio && precio.disponible !== false && precio.precio > 0;

  return `
    <section class="panel" aria-labelledby="pt-t">
      <header class="p-cab">
        <h2 id="pt-t">${escapar(titulo)}</h2>
        <span class="p-marca">${fmt(pct, 1)} %</span>
      </header>

      <div class="cifra">
        <span class="c-num">${fmt(falta)}<span class="u">PLS</span></span>
        <span class="c-eti">Faltan para el depósito</span>
        ${hayPrecio
          ? `<span class="c-sub">≈ ${fmt(falta * precio.precio, 2)} $</span>`
          : '<span class="c-sub alerta">Sin precio de PLS: no se convierte a dólares.</span>'}
      </div>

      <div class="avance" role="presentation">
        <div class="a-barra"><i style="width:${pct.toFixed(2)}%"></i></div>
        <div class="a-pie">
          <span class="mono">${fmtCompacto(reunido)} de ${fmtCompacto(deposito)} PLS</span>
          <span>${deWallet ? 'saldo de la wallet' : 'lo generado'}</span>
        </div>
      </div>

      ${plazo ? `
      <div class="rejilla">
        <div class="cifra">
          <span class="c-num">${escapar(plazo)}</span>
          <span class="c-eti">Al ritmo actual</span>
          <span class="c-sub">hacia ${escapar(fecha)} · proyección, no promesa</span>
        </div>
      </div>` : '<p class="c-sub">Sin ritmo medible para estimar el plazo.</p>'}

      ${deWallet ? '' : '<p class="c-sub alerta">Sin lectura de la wallet: se usa lo generado, que puede no estar disponible.</p>'}
    </section>`;
}
