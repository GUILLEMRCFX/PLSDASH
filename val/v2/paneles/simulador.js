/**
 * La proyección al siguiente validador, y el deslizador que la mueve.
 *
 * ⚠ ESTO NO ES UN PANEL, y dejó de serlo el 26-ago-2026. Era «Simulador», una
 *   tarjeta propia justo debajo de «Trayectoria» — y las dos decían LO MISMO.
 *   Lo demostró su propia prueba de coherencia: con el deslizador a cero, las
 *   dos daban el mismo objetivo, el mismo plazo y la misma fecha. Dos tarjetas
 *   seguidas repitiendo una cifra.
 *
 *   Ahora aquí viven la CUENTA y el MANDO, y quien los pinta es
 *   `trayectoria.js`, en una sola tarjeta: la barra de lo reunido arriba y el
 *   deslizador debajo. El plazo se calcula UNA vez, en `proyectar()`, así que
 *   ya no pueden divergir ni por redondeo.
 *
 * ## La cuenta, entera
 *
 *     días = (depósito − reunido) / (pls_día + (aporte_mes / precio) / 30,44)
 *
 * `pls_día` es el ritmo MEDIDO —lo que de verdad se ha ganado—, y el segundo
 * sumando son los PLS que compra la aportación repartidos por día. 30,44 es la
 * media de días del mes (365,25 / 12), no 30: con 30 el año sale cinco días
 * corto y a nueve meses vista eso ya se nota.
 *
 * ## ⚠ NADA DE ESTO ESTÁ ESCRITO A FUEGO
 *
 * El depósito sale de `stake_total / total` y el objetivo de `total + 1`, igual
 * que en la trayectoria. El v1 tiene `const V11 = 32_000_000` escrito en el
 * código: el día que el depósito cambie o que entre otro validador, ese número
 * miente y nadie se entera. Aquí no hay ninguno.
 *
 * ## ⚠ EL DESLIZADOR VA EN DÓLARES, Y ES UNA DECISIÓN
 *
 * Se pidió en euros, y el v1 dice «+50 € al mes». Pero el v1 calcula así:
 *
 *     const plsMes = price > 0 ? eur / price : 0;   // price está en DÓLARES
 *
 * o sea que divide euros entre un precio en dólares: da por hecho que 1 € = 1 $.
 * El error es exactamente el tipo de cambio menos uno — con el euro por encima
 * del dólar, el v1 cree que compras menos PLS de los que compras y alarga el
 * plazo.
 *
 * Para hacerlo en euros DE VERDAD hace falta un tipo de cambio real, o sea otra
 * fuente externa que se cae, se cachea y hay que vigilar. Todo el panel habla
 * ya en dólares porque el precio de PLS viene en dólares. Así que el deslizador
 * va en dólares y no hay conversión que pueda estar mal: cero dependencias y
 * cero error. Si algún día se quiere en euros, se trae el cambio de verdad —
 * pero no se escribe un número y se le llama euros.
 *
 * ## Qué NO hace
 *
 * No compone. Los PLS aportados no generan a su vez, porque para generar hay
 * que llegar a un depósito ENTERO: hasta que no se cierran los 32M no hay
 * validador nuevo y el ritmo no cambia. Componer aquí adelantaría la fecha con
 * un rendimiento que todavía no existe.
 */

import { ritmoDiario } from '/val/compartido/ganancias.js';
import { fmt, fmtCompacto, escapar } from './formato.js';

/** Días por mes, de media. 365,25/12 y no 30. */
const DIAS_MES = 30.44;

/** El tope del deslizador, en dólares al mes. */
export const TOPE = 500;

/* ─────────────────────────────────────── la escala del deslizador

   NO es lineal, y el motivo está medido. Con el rango 0–500 repartido a partes
   iguales, al precio de ahora esto pasaba:

       20 % del dedo → 100 $ → 2,4 meses
       80 % restante → de 2,4 a 0,6 meses

   O sea que cuatro quintos del recorrido vivían en una zona donde ya compras
   más de un depósito al mes y el plazo apenas se mueve. Un deslizador cuyo
   tramo útil son los primeros dos centímetros es un deslizador mal calibrado.

   Con la curva, el plazo baja de forma casi pareja a lo largo del recorrido:

       0 %  →   0 $ → 9,1 meses      60 % →  60 $ → 3,5 meses
      20 %  →   5 $ → 8,0            70 % → 100 $ → 2,4
      40 %  →  18 $ → 6,1            80 % → 170 $ → 1,6
      50 %  →  35 $ → 4,7           100 % → 500 $ → 0,6

   `CURVA` es cuánto se comba: 1 sería lineal y cuanto más alto, más resolución
   abajo. 200 sale de probar 50, 100, 200 y 400 y quedarse con el que deja los
   0–100 $ ocupando el 71 % del recorrido — con 400 el tramo alto pega saltos de
   100 $ entre posiciones contiguas.

   ⚠ El deslizador NO lleva los dólares como valor: lleva la POSICIÓN, de 0 a
     `PASOS`. Los dólares se calculan. Ponerle los dólares como valor obligaría
     a un `step` variable, que no existe. */
const CURVA = 200;
export const PASOS = 1000;

/**
 * Redondea a una cifra que se pueda leer: de uno en uno abajo, de 25 en 25
 * arriba. Sin esto el deslizador enseña «34 $», «37 $», «41 $» — precisión
 * falsa sobre una proyección, y encima imposible de volver a encontrar.
 */
function redondear(v) {
  if (v < 20) return Math.round(v);
  if (v < 50) return Math.round(v / 5) * 5;
  if (v < 200) return Math.round(v / 10) * 10;
  return Math.round(v / 25) * 25;
}

/** Posición del deslizador (0..PASOS) → dólares al mes. */
export function valorDesde(pos) {
  const t = Math.max(0, Math.min(1, Number(pos) / PASOS));
  return redondear(TOPE * (Math.pow(CURVA, t) - 1) / (CURVA - 1));
}

/** Dólares al mes → posición del deslizador. La inversa de `valorDesde`. */
export function posicionDe(valor) {
  const v = Math.max(0, Math.min(TOPE, Number(valor) || 0));
  const t = Math.log((v / TOPE) * (CURVA - 1) + 1) / Math.log(CURVA);
  return Math.round(t * PASOS);
}

const CLAVE = 'plsdash:aporte-sim';

/** Lo último que se dejó puesto en este dispositivo. */
export function aporteGuardado() {
  try {
    const v = Number(localStorage.getItem(CLAVE));
    return Number.isFinite(v) && v >= 0 && v <= TOPE ? Math.round(v) : 0;
  } catch {
    return 0;
  }
}

/**
 * La proyección, sola y sin DOM para poder probarla con números a mano.
 *
 * @returns {object|null} null cuando falta algo con lo que no se puede
 *   proyectar nada — y entonces el panel lo dice, en vez de enseñar un cero.
 */
export function proyectar({ falta, plsDia, precio, aporteMes }) {
  if (!Number.isFinite(falta) || falta < 0) return null;
  const base = Number.isFinite(plsDia) && plsDia > 0 ? plsDia : 0;

  // Sin precio no se sabe cuántos PLS compra un dólar: se proyecta solo con el
  // ritmo y el panel avisa. Fingir un precio sería inventarse el resultado.
  const hayPrecio = Number.isFinite(precio) && precio > 0;
  const plsMes = hayPrecio ? (Number(aporteMes) || 0) / precio : 0;
  const extraDia = plsMes / DIAS_MES;

  const ritmo = base + extraDia;
  const diasBase = base > 0 ? falta / base : null;
  const dias = ritmo > 0 ? falta / ritmo : null;

  return {
    plsMes, extraDia, ritmo, dias, diasBase,
    // Cuánto adelanta la aportación respecto a no poner nada. Es LA cifra:
    // «tardas 9 meses» no dice nada sin el «en vez de 14».
    adelanta: dias != null && diasBase != null ? diasBase - dias : null,
    hayPrecio,
    // Ya está: sin aportar nada tampoco hace falta simular.
    yaEsta: falta === 0,
  };
}

/** Días → «11 meses», «1,4 años», «23 días». */
export function fmtPlazo(dias) {
  if (!Number.isFinite(dias) || dias <= 0) return null;
  if (dias < 60) return `${fmt(dias, 0)} días`;
  if (dias < 730) return `${fmt(dias / 30.44, 0)} meses`;
  return `${fmt(dias / 365.25, 1)} años`;
}

/**
 * El deslizador y su rótulo. Lo pinta `trayectoria.js` dentro de su tarjeta.
 *
 * Va DESPUÉS de la barra de lo reunido y antes del plazo, que es el orden en
 * que se lee: cuánto llevas, qué pondrías, cuánto tardarías.
 */
export function mandoSimulador(aporte) {
  const pos = posicionDe(aporte);
  return `
    <div class="sim-mando">
      <label class="sim-eti" for="simAporte">Si aporto cada mes</label>
      <output class="sim-valor" id="simSalida" for="simAporte">${
        aporte > 0 ? `${fmt(aporte)} $` : 'nada'}</output>
      <!-- ⚠ La variable --t la fija JS y también aquí, para el primer pintado.
           WebKit no tiene ::-moz-range-progress, así que el tramo ya recorrido
           se pinta con un degradado y hay que decirle dónde cortar. Sin el
           valor inicial el carril arranca vacío aunque el mando no esté a cero,
           que es lo que pasa al recargar con algo guardado.

           Y SIN COMILLAS INVERSAS: esto vive dentro de una plantilla, así que
           una comilla inversa en un comentario la cierra. Ya ha pasado cinco
           veces en este proyecto. -->
      <input type="range" class="sim-rango" id="simAporte"
             style="--t:${(pos / PASOS * 100).toFixed(1)}%"
             min="0" max="${PASOS}" step="1" value="${pos}"
             aria-label="Aportación mensual en dólares"
             aria-valuetext="${aporte > 0 ? `${fmt(aporte)} dólares al mes` : 'sin aportar nada'}">
      <div class="sim-topes" aria-hidden="true"><span>0</span><span>${TOPE} $</span></div>
    </div>`;
}

export function textoDetalle(r, ritmo, aporte) {
  const partes = [];

  if (aporte > 0 && r.hayPrecio) {
    partes.push(`
      <div class="cifra">
        <span class="c-num">${fmtCompacto(r.plsMes)}<span class="u">PLS</span></span>
        <span class="c-eti">Es lo que compra al mes</span>
        <span class="c-sub">al precio de ahora</span>
      </div>`);
  }

  // Lo que de verdad importa: cuánto adelanta respecto a no poner nada.
  if (aporte > 0 && r.adelanta != null && r.adelanta >= 1) {
    partes.push(`
      <div class="cifra">
        <span class="c-num sim-gana">${escapar(fmtPlazo(r.adelanta) || '—')}</span>
        <span class="c-eti">Antes que sin aportar</span>
        <span class="c-sub">frente a ${escapar(fmtPlazo(r.diasBase) || '—')} al ritmo solo</span>
      </div>`);
  }

  if (!partes.length) {
    partes.push(`
      <div class="cifra">
        <span class="c-num">${fmt((ritmo?.pls_dia) || 0)}<span class="u">PLS</span></span>
        <span class="c-eti">Al día, medido</span>
        <span class="c-sub">${escapar(ritmo?.base || '')}</span>
      </div>`);
  }
  return partes.join('');
}

/**
 * El deslizador.
 *
 * ⚠ Recalcula EN EL SITIO y no llama a `repintar()`. El panel se regenera entero
 *   cada 18 segundos, y un repintado en mitad de un arrastre devuelve el mando a
 *   donde estaba el HTML: el dedo en un sitio y el control en otro. Aquí solo se
 *   reescriben la cifra del plazo y el detalle, que es lo que cambia.
 *
 * ⚠ Y el valor se guarda, porque el repintado de los 18 segundos SÍ va a
 *   regenerar este panel: sin guardarlo, el deslizador volvería solo a cero cada
 *   18 segundos. Se guarda donde el tema, por el mismo motivo: es una
 *   preferencia de este aparato.
 */
export function engancharSimulador(raiz, datos) {
  const mando = raiz.querySelector('#simAporte');
  if (!mando) return;
  const salida = raiz.querySelector('#simSalida');
  const plazo = raiz.querySelector('#simPlazo');
  const detalle = raiz.querySelector('#simDetalle');

  const { estado, serie, snapshots24h, ganancia, precio, ahoraS } = datos;
  const v = estado?.validadores || {};
  const deposito = Number(v.total) > 0 ? Number(v.stake_total) / Number(v.total) : null;
  const reunido = ganancia?.saldo_wallet != null ? Number(ganancia.saldo_wallet) : null;
  if (!deposito || reunido == null) return;

  const falta = Math.max(0, deposito - reunido);
  const ritmo = ritmoDiario({ serie, snapshots24h, plsDiaKV: v.pls_dia, fmt });
  const p = Number(precio?.precio);
  const hayPrecio = precio && precio.disponible !== false && p > 0;

  const pintar = () => {
    const aporte = valorDesde(mando.value);
    const r = proyectar({ falta, plsDia: ritmo?.pls_dia, precio: hayPrecio ? p : null, aporteMes: aporte });
    if (!r || r.dias == null) return;

    salida.textContent = aporte > 0 ? `${fmt(aporte)} $` : 'nada';
    mando.style.setProperty('--t', `${(Number(mando.value) / PASOS * 100).toFixed(1)}%`);
    mando.setAttribute('aria-valuetext',
      aporte > 0 ? `${fmt(aporte)} dólares al mes` : 'sin aportar nada');

    const f = new Date((ahoraS + r.dias * 86400) * 1000)
      .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    plazo.querySelector('.c-num').textContent = fmtPlazo(r.dias) || '—';
    plazo.querySelector('.c-eti').textContent = aporte > 0 ? 'Aportando eso' : 'Al ritmo actual';
    plazo.querySelector('.c-sub').textContent = `hacia ${f} · proyección, no promesa`;
    detalle.innerHTML = textoDetalle(r, ritmo, aporte);

    try { localStorage.setItem(CLAVE, String(aporte)); } catch { /* da igual */ }
  };

  mando.addEventListener('input', pintar);
}
