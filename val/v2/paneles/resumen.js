/**
 * Pestaña 1 — Resumen: el patrimonio del nodo.
 *
 * ## Qué cambió el 25-sep-2026, y por qué
 *
 * La cifra protagonista era «Total generado», unos 45 $, y los ~4.300 $ del
 * stake no aparecían en ningún sitio. Estaba al revés. Ahora manda el
 * PATRIMONIO, al estilo de una app de banco:
 *
 *   · arriba, una franja fina de salud —cuántos validan, si está sincronizado y
 *     el pulso del dato—. Va ENCIMA de la cifra a propósito: si cae un
 *     validador, el ojo tiene que ir ahí antes que al dinero. Tranquila cuando
 *     va bien, naranja cuando no;
 *   · la cifra grande, en dólares con los PLS debajo, y tocándola se cambia;
 *   · tres filas que SUMAN la cifra de arriba —en staking, en la wallet, sin
 *     barrer— y que son un selector: tocar una la pone arriba;
 *   · lo generado desde el principio, APARTE y también seleccionable. No suma:
 *     buena parte ya está dentro de un validador. Si fuera una cuarta fila, las
 *     filas dejarían de cuadrar con la cifra, y eso no puede pasar nunca.
 *
 * ## Una sola cifra protagonista
 *
 * Todo lo demás de la pestaña —el ritmo, el precio— va debajo, en tarjetas de
 * siempre y con cifras pequeñas.
 *
 * ## Los dólares siguen al precio
 *
 * El patrimonio en dólares se mueve un 10 % en un día normal y no es el nodo.
 * Por eso las dos etiquetas de debajo separan las dos cosas: lo que ha hecho el
 * nodo hoy, en verde, y lo que se ha movido el precio, en ámbar.
 */

import {
  gananciaAcumulada, aprValidadorHora, generadoHoy, proximoBarrido, ritmoDiario,
} from '/val/compartido/ganancias.js';
import { activacionTs, saludGlobal } from '../datos.js';
import { fmt, fmtPrecio, fmtCompacto, escapar } from './formato.js';
import { tablaRitmo } from './ritmo.js';
import { desglosarSaldo } from './aportaciones.js';
import { estadoPulso, MARCA } from './pulso.js';

export const TITULO = 'Resumen';

/**
 * La palabra de estado, reconciliada con el pulso.
 *
 * `saludGlobal()` da por desfasado el dato a los 15 minutos; el pulso lo da por
 * tarde a los 4. Entre esas dos cifras hay una franja en la que el pulso decía
 * «SIN SEÑAL DESDE HACE 10:00» en naranja y, dos centímetros a la derecha, la
 * cabecera seguía diciendo «OPERATIVO» en verde. Los dos eran ciertos —el nodo
 * estaba bien la última vez que se supo de él— y juntos parecían un fallo del
 * panel.
 *
 * Aquí manda el pulso, porque es la pregunta que se hace de verdad: «¿esto que
 * estoy mirando es de ahora?». Los estados peores —sin sesión, sin datos,
 * desfasado, crítico— siguen ganándole: son más graves, no menos.
 *
 * ⚠ No se toca `saludGlobal()`: la usa también el panel «Estado global» de la
 *   pestaña Nodo, donde la pregunta es otra —cómo está la máquina— y los 15
 *   minutos son el umbral correcto.
 */
function palabraDeEstado(salud, pulsoTarde) {
  if (salud.tono !== 'ok' || !pulsoTarde) return salud;
  return { ...salud, palabra: 'SIN SEÑAL', tono: 'aviso',
           nota: 'El NUC no ha empujado dato nuevo en plazo. Lo de abajo es lo último que llegó.' };
}

/* La unidad de la cifra grande. Clave NUEVA y no la de antes: aquella era la
   del «total generado» y se guardaba en PLS; esta arranca en dólares, que es
   como se lee un patrimonio. */
const CLAVE = 'plsdash.v2.unidad-patrimonio';

/**
 * Unidad y selección viven en el módulo y no en el DOM: el panel se repinta
 * entero cada 18 s y guardarlas en una clase se perdería en el primer refresco.
 * La selección no se recuerda al recargar: se vuelve siempre al total.
 */
let unidad = leerUnidad();
let sel = 'total';

function leerUnidad() {
  try { return localStorage.getItem(CLAVE) === 'pls' ? 'pls' : 'usd'; }
  catch { return 'usd'; }
}

function guardarUnidad(u) {
  try { localStorage.setItem(CLAVE, u); } catch { /* da igual */ }
}

/**
 * Las piezas del patrimonio, sin DOM, para poder probar que SUMAN.
 *
 *   en staking  = `stake_total`: el depósito de los que la cadena confirma. Un
 *                 validador esperando a entrar NO cuenta: no se sabe si está
 *                 depositado, y sumarlo sería inventarse 32M.
 *   en la wallet = el saldo leído de la cadena por `/api/val/ganancia`.
 *   sin barrer  = `ganado_total`: lo que los validadores llevan encima del
 *                 depósito y se barre a la wallet cada ~8 h.
 *
 * Staking y sin barrer juntos son `balance_total`: el saldo de los validadores.
 *
 * ⚠ SI FALTA UNA PIEZA, el total es la suma de las que hay y se dice cuál
 *   falta. Nunca se rellena con un cero ni con el último valor conocido: la
 *   regla es que las filas sumen SIEMPRE la cifra de arriba, y una fila con
 *   «–» que contara como algo la rompería.
 */
export function patrimonioDesde(datos) {
  const v = datos?.estado?.validadores || {};
  const num = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  const staking = num(v.stake_total);
  const wallet = num(datos?.ganancia?.saldo_wallet);
  const sinBarrer = num(v.ganado_total);
  const piezas = { staking, wallet, sinBarrer };
  const faltan = Object.keys(piezas).filter(k => piezas[k] == null);
  const total = faltan.length === 3 ? null
    : Object.values(piezas).reduce((a, x) => a + (x ?? 0), 0);
  const p = datos?.precio;
  const precio = p && p.disponible !== false && Number(p.precio) > 0 ? Number(p.precio) : null;
  return { staking, wallet, sinBarrer, total, faltan, completo: faltan.length === 0, precio };
}

const NOMBRE = { staking: 'el staking', wallet: 'la wallet', sinBarrer: 'lo sin barrer' };

/** «2 h 10 min», «35 min». */
function duracion(s) {
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** «−3,2 %» / «+1,0 %». El signo menos tipográfico, no un guion. */
function porcentaje(x) {
  const t = fmt(Math.abs(x), 1);
  return x < 0 ? `−${t} %` : `+${t} %`;
}

/* ── la franja de salud ──────────────────────────────────────────────────
   Reutiliza las piezas del pulso —`#pulso`, `.p-eti`, `.resto`, `.pl-lleno`—
   para que `latir()` la siga moviendo cada segundo sin repintar nada. */
function franja(datos, salud, pulso) {
  const v = datos?.estado?.validadores || {};
  const n = datos?.estado?.nodo || {};
  const tono = salud.tono === 'ok' ? 'ok' : salud.tono === 'critico' ? 'critico' : 'aviso';
  const claves = Number(v.claves) || Number(v.total) || 0;
  const esperando = Number(v.esperando) || 0;
  const enCola = Number(v.pendientes) || 0;

  const linea = tono === 'ok'
    ? `<b>${fmt(v.activos)} de ${fmt(claves)} validando</b>${
        enCola ? ` · ${fmt(enCola)} en cola` : ''}${
        esperando ? ` · ${fmt(esperando)} esperando a entrar` : ''}${
        n.sincronizado ? ' · sincronizado' : ''}`
    : `<b>${escapar(salud.palabra)}</b>${salud.nota ? ` · ${escapar(salud.nota)}` : ''}`;

  const ts = Number(datos?.estado?.generado_ts) || 0;
  return `
    <div class="franja ${tono}">
      <div class="pulso${pulso.tarde ? ' tarde' : ''}" id="pulso" data-ts="${ts}" data-corto="1"
           role="status" aria-live="polite" aria-label="${escapar(pulso.aria)}">
        <div class="pl-cab">
          <i class="luz" aria-hidden="true"></i>
          <span class="f-salud">${linea}</span>
          <span class="f-dato"><span class="p-eti">${escapar(pulso.corto)}</span> <b class="resto">${escapar(pulso.resto)}</b></span>
        </div>
        <div class="pl-linea" aria-hidden="true">
          <span class="pl-lleno" style="width:${(pulso.avance * 100).toFixed(1)}%"></span>
          <i class="pl-marca" style="left:${(MARCA * 100).toFixed(1)}%"></i>
        </div>
      </div>
    </div>`;
}

const ICONOS = {
  staking: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M16 12.5h2"/><path d="M3.5 9.5h17"/></svg>',
  sinBarrer: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 4h10M7 20h10M8 4c0 4 8 4 8 8s-8 4-8 8M16 4c0 4-8 4-8 8"/></svg>',
};

export function panelResumen(datos) {
  const { estado, serie, ganancia } = datos;

  // El pulso se evalúa con el reloj de verdad, no con `datos.ahoraS`: ese es
  // el instante en que se pidieron los datos y aquí lo que importa es cuánto
  // hace de eso ahora mismo.
  const ahora = Math.floor(Date.now() / 1000);
  const pulso = estadoPulso(estado?.generado_ts, ahora);
  const salud = palabraDeEstado(saludGlobal(datos), pulso.tarde);
  const v = estado?.validadores || {};

  const pat = patrimonioDesde(datos);
  const precio = pat.precio;
  const cambio = Number(datos?.precio?.cambio24);
  const hayCambio = precio != null && Number.isFinite(cambio);

  const acum = gananciaAcumulada({ estado, ganancia, serie, activacionTs: activacionTs(estado) });
  const hoy = generadoHoy(serie);
  const hoyPls = hoy && Number.isFinite(Number(hoy.ganado_dia)) ? Number(hoy.ganado_dia) : null;
  const inicio = activacionTs(estado);
  const desde = inicio
    ? new Date(inicio * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : null;

  const ritmo = ritmoDiario({ serie, snapshots24h: datos.snapshots24h, plsDiaKV: v.pls_dia, fmt });
  const tasa = ritmo?.pls_dia > 0 ? ritmo.pls_dia / 86400 : 0;

  const deposito = Number(v.total) > 0 ? Number(v.stake_total) / Number(v.total) : null;
  const barrido = proximoBarrido(ganancia?.ciclos || [], ahora);
  const txtBarrido = !barrido ? 'sin ritmo de barrido todavía'
    : barrido.falta > 0 ? `próximo barrido en ${duracion(barrido.falta)}`
    : 'el barrido está al caer';

  const d = desglosarSaldo(datos);
  const cuadra = d && d.hayRegistro && !d.restoVisible;
  const aportadoAhora = cuadra ? Math.min(Number(d.aportado) || 0, d.saldo) : 0;

  // ── Las etiquetas ──
  const G = t => ({ t, c: 'g' });   // lo que hace el nodo
  const A = t => ({ t, c: 'a' });   // lo que hace el precio
  const N = t => ({ t, c: 'n' });   // contexto
  const chipPrecio = hayCambio ? A(`PLS ${porcentaje(cambio)} en 24 h`) : null;
  const chipHoy = hoyPls != null ? G(`tu nodo hoy +${fmt(hoyPls)} PLS`) : null;

  const val = ganancia?.valorado;
  const cobrado = val && val.con_precio > 0
    ? N(`valía ${fmt(val.usd, 2)} $ al cobrarlo${val.con_precio < val.barridos
        ? ` · ${fmt(val.con_precio)}/${fmt(val.barridos)} barridos` : ''}`)
    : null;

  const vistas = {
    total: {
      eti: 'Patrimonio del nodo', clase: 'total', pls: pat.total, crece: true,
      chips: [chipHoy, chipPrecio],
      pie: pat.completo
        ? 'Los dólares siguen al precio. Lo que genera tu nodo va en verde.'
        : `Sin contar ${pat.faltan.map(f => NOMBRE[f]).join(' ni ')}: no se ha podido leer.`,
    },
    staking: {
      eti: 'En staking', clase: 'staking', pls: pat.staking,
      chips: [deposito ? N(`${fmtCompacto(deposito)} por validador`) : null, chipPrecio],
      pie: 'Es el capital puesto. Solo cambia con el precio o al añadir un validador.',
    },
    wallet: {
      eti: 'En la wallet', clase: 'wallet', pls: pat.wallet,
      chips: [d && d.hayRegistro
        ? (cuadra
          ? N(`${fmtCompacto(d.saldo - aportadoAhora)} generado · ${fmtCompacto(aportadoAhora)} aportado`)
          : N(`${fmtCompacto(d.aportado)} aportados en total`))
        : N('todo generado · sin aportaciones apuntadas')],
      pie: 'Lo que va juntando para el siguiente validador.',
    },
    sinBarrer: {
      eti: 'Sin barrer', clase: 'sinBarrer', pls: pat.sinBarrer, crece: true,
      chips: [N(txtBarrido)],
      pie: 'Vuelve a cero en cada barrido. Es lo normal.',
    },
    generado: {
      eti: desde ? `Generado desde el ${desde}` : 'Generado', clase: 'generado',
      pls: acum ? acum.total : null, crece: true,
      chips: [hoyPls != null ? G(`+${fmt(hoyPls)} PLS hoy`) : null, cobrado],
      pie: 'No suma al patrimonio: es lo que ha producido el nodo desde el principio.',
    },
  };
  if (!vistas[sel]) sel = 'total';
  const cur = vistas[sel];

  // ── La cifra grande ──
  const enUsd = unidad === 'usd' && precio != null;
  const conmutable = cur.pls != null && precio != null;
  const cifra = cur.pls == null ? '–'
    : enUsd ? fmt(cur.pls * precio, 2) : fmt(cur.pls);
  const sub = cur.pls == null ? 'No se ha podido leer.'
    : precio == null ? 'Sin precio de PLS: no se pasa a dólares.'
    : enUsd ? `${fmt(cur.pls)} PLS · al precio de ahora`
    : `≈ ${fmt(cur.pls * precio, 2)} $ al precio de ahora`;
  /* El contador corre en lo que crece con el nodo —el total, lo sin barrer y
     lo generado— y se queda quieto en lo que no: el stake y la wallet solo
     cambian cuando pasa algo. Ver `tictac()`. */
  const datosTic = cur.pls == null ? '' :
    ` data-base="${cur.pls}" data-tasa="${cur.crece ? tasa : 0}" data-desde="${Date.now()}"`
    + (enUsd ? ` data-precio="${precio}"` : '');

  const chips = cur.chips.filter(Boolean)
    .map(c => `<span class="r-chip ${c.c}">${escapar(c.t)}</span>`).join('');

  const heroe = `
    <div class="r-heroe ${cur.clase}">
      <div class="r-eti">
        <span class="h-eti">${escapar(cur.eti)}</span>
        ${sel !== 'total' ? '<button type="button" class="r-volver" data-sel="total">← Patrimonio</button>' : ''}
      </div>
      ${conmutable
        ? `<button type="button" class="p-num r-num" data-unidad="${unidad}"${datosTic}
             aria-label="${escapar(cur.eti)}: ${enUsd ? `${cifra} dólares` : `${cifra} PLS`}. Pulsa para cambiar de unidad."><span class="p-cifra">${cifra}</span><span class="u">${enUsd ? '$' : 'PLS'}</span></button>`
        : `<span class="p-num r-num"${datosTic}><span class="p-cifra">${cifra}</span><span class="u">${cur.pls == null ? '' : 'PLS'}</span></span>`}
      <p class="r-sub">${escapar(sub)}</p>
      ${chips ? `<div class="r-chips">${chips}</div>` : ''}
      <p class="r-pie">${escapar(cur.pie)}</p>
    </div>`;

  // ── Las tres filas, que suman la cifra de arriba ──
  const fila = (k, nombre, detalle) => {
    const pls = pat[k];
    return `
      <button type="button" class="r-fila ${k}${sel === k ? ' sel' : ''}" data-sel="${k}"
              aria-pressed="${sel === k}">
        <span class="r-ico" aria-hidden="true">${ICONOS[k]}</span>
        <span class="r-nom"><b>${nombre}</b><span>${escapar(detalle)}</span></span>
        <span class="r-val">${pls == null ? '<b>–</b><span>no se ha podido leer</span>'
          : precio != null ? `<b>${fmt(pls * precio, 2)} $</b><span>${fmt(pls)} PLS</span>`
          : `<b>${fmt(pls)}</b><span>PLS</span>`}</span>
      </button>`;
  };
  const filas = `
    <div class="r-filas" role="group" aria-label="De qué está hecho el patrimonio">
      ${fila('staking', 'En staking', `${fmt(v.total)} validadores${deposito ? ` · ${fmtCompacto(deposito)} cada uno` : ''}`)}
      ${fila('wallet', 'En la wallet', d && d.hayRegistro ? 'generado y aportado' : 'lo generado')}
      ${fila('sinBarrer', 'Sin barrer', txtBarrido)}
    </div>`;

  // ── Lo generado, aparte ──
  const generado = `
    <button type="button" class="r-generado${sel === 'generado' ? ' sel' : ''}" data-sel="generado"
            aria-pressed="${sel === 'generado'}">
      <span class="r-nom"><b>${escapar(vistas.generado.eti)}</b><span>aparte · no suma al patrimonio</span></span>
      <span class="r-val"><b>${acum ? fmt(acum.total) : '–'}</b>${
        hoyPls != null ? `<span class="bien">+${fmt(hoyPls)} hoy</span>` : '<span>PLS</span>'}</span>
    </button>`;

  /* ── «Tienes para un validador entero» ──────────────────────────────────
     Se queda MIENTRAS el saldo dé para ello: no es un aviso que aparece y se
     va, es «puedes depositar ya», y eso es cierto hasta que depositas. */
  const cuantos = deposito > 0 && pat.wallet != null ? Math.floor(pat.wallet / deposito) : 0;
  const listo = cuantos < 1 ? '' : `
      <p class="listo" role="status">
        <span class="listo-t">${cuantos === 1
          ? 'Tienes para un validador entero'
          : `Tienes para ${fmt(cuantos)} validadores enteros`}</span>
        <span class="listo-s">${fmt(pat.wallet)} PLS en la wallet · el depósito son ${
          fmtCompacto(deposito)} PLS · la guía está en Ampliar</span>
      </p>`;

  return `
    <section class="r-patrimonio" aria-labelledby="prs-t">
      <h2 id="prs-t" class="oculto">${TITULO}</h2>
      ${franja(datos, salud, pulso)}
      ${heroe}
      ${filas}
      ${generado}
      ${listo}
    </section>`;
}

/**
 * El ritmo, debajo y en pequeño: la tabla por periodos, el rendimiento y el
 * precio. Era el cuerpo del Resumen; con el patrimonio arriba pasa a
 * secundario.
 */
export function panelRitmo(datos) {
  const { estado, serie, ganancia, precio } = datos;
  const v = estado?.validadores || {};
  const hayPrecio = precio && precio.disponible !== false && precio.precio > 0;
  const acum = gananciaAcumulada({ estado, ganancia, serie, activacionTs: activacionTs(estado) });
  const deposito = Number(v.total) > 0 ? Number(v.stake_total) / Number(v.total) : null;
  /* ⚠ EL QUE ESPERA A ENTRAR EN LA CADENA SE SACA DEL APR: no aporta ni una
     hora-validador y dispararía «del resto no se conoce la activación». */
  const enCadena = (v.detalle || []).filter(d => !(d.esperando === true || d.estado === 'esperando'));
  const apr = acum ? aprValidadorHora({
    total: acum.total, detalle: enCadena, deposito, ahoraS: datos.ahoraS,
  }) : null;
  const ritmo = tablaRitmo(datos);
  const faltanActivaciones = apr && !apr.deTodos;

  return `
    <section class="panel" aria-labelledby="prit-t">
      <header class="p-cab"><h2 id="prit-t">Ritmo</h2></header>
      ${ritmo ? ritmo.html : '<p class="vacio">Sin ritmo medible todavía.</p>'}
      <dl class="p-fondo">
        <div><dt>Rendimiento</dt>${apr
          ? `<dd class="bien">${fmt(apr.pct, 2)}<span class="u pct">%</span></dd>` : '<dd>–</dd>'}</div>
        <div><dt>Precio</dt><dd>${hayPrecio ? `${fmtPrecio(precio.precio)} $` : '–'}</dd></div>
      </dl>
      <p class="c-sub">${
        ritmo ? escapar(ritmo.nota) : 'Aún no hay tramo medido suficiente para proyectar.'
      }${faltanActivaciones
        ? ` El rendimiento sale de ${fmt(apr.conActivacion)} de ${fmt(enCadena.length)} validadores:`
          + ' del resto no se conoce la hora de activación.'
        : ''}</p>
    </section>`;
}

/**
 * Engancha la cifra, las filas y la vuelta al total. Hay que volver a llamarla
 * en cada repintado: el HTML se regenera entero.
 *
 * @param {Function} repintar  Se redibuja con los datos que ya hay en memoria:
 *   tocar un botón no vuelve a pedir nada a la red.
 */
export function engancharResumen(raiz, repintar) {
  raiz.querySelector('.r-num[data-unidad]')?.addEventListener('click', () => {
    unidad = unidad === 'pls' ? 'usd' : 'pls';
    guardarUnidad(unidad);
    repintar();
  });
  // Tocar la fila que ya está puesta vuelve al total: es lo que se espera de
  // un selector que no tiene botón de «ninguno».
  raiz.querySelectorAll('.r-patrimonio [data-sel]').forEach(b => {
    b.addEventListener('click', () => {
      sel = b.dataset.sel === sel ? 'total' : b.dataset.sel;
      repintar();
    });
  });
}

/** Solo para las pruebas: vuelve al total y a dólares. */
export function _reiniciar() { sel = 'total'; unidad = 'usd'; }

/**
 * El contador corre entre refrescos.
 *
 * ## Por qué esto no es adorno
 *
 * La cifra real solo cambia cuando el NUC empuja, cada 3 minutos. Entre medias
 * quedaba clavada, y una cifra clavada en un panel de algo que gana PLS cada
 * segundo dice algo falso: que no está pasando nada.
 *
 * Lo que se dibuja aquí es la MISMA proyección que ya está escrita dos líneas
 * más abajo, en la fila «Hora» de la tabla de ritmo: el ritmo diario medido
 * sobre los últimos días cerrados, repartido por segundo. La velocidad a la que
 * corren los dígitos ES ese dato. Si el ritmo baja, el contador corre más
 * despacio.
 *
 * ⚠ LO QUE ESTO NO ES: una lectura en vivo de la cadena. Es una interpolación
 *   entre dos lecturas reales, y por eso **se vuelve a anclar en cada refresco**
 *   —`data-base` se reescribe con el total de verdad—. Si la proyección se
 *   hubiera adelantado, la cifra retrocede al llegar el dato bueno. Se prefiere
 *   ese salto ocasional a fingir precisión: el pulso, justo encima, dice
 *   siempre de cuándo es la última lectura de verdad.
 *
 * ⚠ Sin ritmo medido, `tasa` vale 0 y el contador NO se mueve. No se inventa
 *   una velocidad por defecto.
 */
export function tictac(raiz = document) {
  const el = raiz.querySelector('.p-num[data-base]');
  if (!el) return;
  const cifra = el.querySelector('.p-cifra');
  if (!cifra) return;

  const base = Number(el.dataset.base);
  const tasa = Number(el.dataset.tasa);
  const desde = Number(el.dataset.desde);
  if (!Number.isFinite(base) || !(tasa > 0) || !Number.isFinite(desde)) return;

  const pls = base + tasa * ((Date.now() - desde) / 1000);
  const precio = Number(el.dataset.precio);
  const txt = Number.isFinite(precio) && precio > 0
    ? fmt(pls * precio, 2)
    : fmt(pls);
  if (cifra.textContent !== txt) cifra.textContent = txt;
}
