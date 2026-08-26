/**
 * Panel — Trayectoria al siguiente validador.
 *
 * Cuánto falta para reunir otro depósito completo, al ritmo actual.
 *
 * ⚠ NINGÚN número de este panel está escrito. El objetivo sale de
 *   `validadores.total + 1`, el porcentaje de `reunido / depósito` y el
 *   depósito de `stake_total / total`.
 *
 *   El objetivo estuvo fijo una vez, y el día que ese validador entró de
 *   verdad el panel se quedó apuntando a una meta ya cumplida — que es peor
 *   que no tener panel. Ahora avanza solo: en cuanto el recuento sube, el
 *   objetivo sube con él, sin que nadie toque nada.
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
 * ## ⚠ AQUÍ VIVE TAMBIÉN EL SIMULADOR, desde el 26-ago-2026
 *
 * Eran dos tarjetas seguidas —«Trayectoria» y «Simulador»— y decían LO MISMO.
 * Lo demostró la prueba de coherencia del propio simulador: con el deslizador a
 * cero daban el mismo objetivo, el mismo plazo y la misma fecha. Repetir una
 * cifra en dos tarjetas contiguas no es redundancia útil, es ruido.
 *
 * Ahora es una sola: la barra de lo reunido, el deslizador debajo y el plazo
 * que sale de los dos. El plazo se calcula UNA vez, en `proyectar()`, así que
 * ya no pueden divergir ni por redondeo — que era el riesgo de tenerlo escrito
 * dos veces.
 */

import { gananciaAcumulada, ritmoDiario } from '/val/compartido/ganancias.js';
import { ACTIVACION_TS } from '../datos.js';
import { desglosarSaldo } from './aportaciones.js';
import { aporteGuardado, proyectar, mandoSimulador, textoDetalle, fmtPlazo } from './simulador.js';
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

export function panelTrayectoria(datos, aporte = aporteGuardado()) {
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
  const hayPrecio = precio && precio.disponible !== false && precio.precio > 0;

  /* ⚠ UNA sola cuenta para el plazo, la del simulador. Antes esto dividía
     `falta / ritmo.pls_dia` por su cuenta y el simulador hacía lo mismo en su
     tarjeta: dos caminos para el mismo número, que es como dos paneles
     contiguos acaban discrepando por un redondeo. */
  const r = proyectar({
    falta, plsDia: ritmo?.pls_dia,
    precio: hayPrecio ? Number(precio.precio) : null,
    aporteMes: aporte,
  });
  const dias = r?.dias ?? null;
  const plazo = fmtPlazo(dias);
  const fecha = dias != null
    ? new Date((ahoraS + dias * 86400) * 1000)
        .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
    : null;

  /* ── La barra, partida en dos: lo ganado y lo aportado ──────────────────
     ⚠ NO se descuenta lo aportado del progreso, y esa fue una decisión, no un
       descuido. Para depositar hacen falta 32M PLS EN LA WALLET, vengan de
       donde vengan: restar lo aportado diría que estás más lejos de lo que
       estás, que es la mentira contraria pero mentira igual.

       Lo que sí engañaba era no poder ver cuánto del avance has comprado y
       cuánto has ganado. Así que se separa: el tramo cian es lo generado
       validando, el naranja lo que has puesto tú.

     El PLAZO sigue saliendo de lo que falta al ritmo medido, que es correcto:
     si aportas, faltará menos y el plazo se acortará — pero por haber puesto
     dinero, no por ganar más rápido, y ahora la barra lo enseña. */
  /* ⚠ Y solo se parte cuando la cuenta CUADRA. Si ha salido PLS de la wallet
     —`restoVisible`— no hay forma de saber si lo que salió era ganado o
     aportado: cualquier reparto sería una convención inventada con pinta de
     dato. En ese caso la barra se deja entera y el pie dice el total aportado
     sin fingir que se sabe cuánto de ello sigue ahí. */
  const desglose = deWallet ? desglosarSaldo(datos) : null;
  const cuadra = desglose && desglose.hayRegistro && !desglose.restoVisible;
  const aportado = cuadra ? Math.min(Number(desglose.aportado) || 0, reunido) : 0;
  const pctAportado = Math.max(0, Math.min(100, (aportado / deposito) * 100));
  const pctGanado = Math.max(0, pct - pctAportado);

  const barra = aportado > 0
    ? `<i class="a-ganado" style="width:${pctGanado.toFixed(2)}%"></i>`
      + `<i class="a-aportado" style="width:${pctAportado.toFixed(2)}%"></i>`
    : `<i class="a-ganado" style="width:${pct.toFixed(2)}%"></i>`;

  const pieBarra = aportado > 0
    ? `${fmtCompacto(reunido - aportado)} generados · ${fmtCompacto(aportado)} aportados`
    : desglose && desglose.hayRegistro
      ? `saldo de la wallet · ${fmtCompacto(desglose.aportado)} aportados en total`
      : (deWallet ? 'saldo de la wallet' : 'lo generado');

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
        <div class="a-barra">${barra}</div>
        <div class="a-pie">
          <span class="mono">${fmtCompacto(reunido)} de ${fmtCompacto(deposito)} PLS</span>
          <span>${escapar(pieBarra)}</span>
        </div>
      </div>

      <!-- El deslizador entre la barra y el plazo: cuánto llevas, qué pondrías,
           cuánto tardarías. Ese es el orden en que se lee. -->
      ${mandoSimulador(aporte)}

      ${plazo ? `
      <div class="cifra" id="simPlazo">
        <span class="c-num">${escapar(plazo)}</span>
        <span class="c-eti">${aporte > 0 ? 'Aportando eso' : 'Al ritmo actual'}</span>
        <span class="c-sub">hacia ${escapar(fecha)} · proyección, no promesa</span>
      </div>

      <div class="rejilla sim-detalle" id="simDetalle">
        ${textoDetalle(r, ritmo, aporte)}
      </div>

      <p class="c-sub">
        Sobre lo que falta al ritmo medido —${escapar(ritmo?.base || 'sin base')}—
        más lo que compra la aportación al precio de ahora.
        ${r.hayPrecio ? '' : '<span class="alerta">Sin precio de PLS: la aportación no se puede convertir y solo cuenta el ritmo.</span>'}
      </p>
      ` : '<p class="c-sub">Sin ritmo medible para estimar el plazo.</p>'}

      ${deWallet ? '' : '<p class="c-sub alerta">Sin lectura de la wallet: se usa lo generado, que puede no estar disponible.</p>'}
    </section>`;
}
