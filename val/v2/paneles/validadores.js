/**
 * Panel 4 — Los validadores.
 *
 * Este es el panel que se mira cuando algo falla, así que todo está ordenado
 * alrededor de una sola pregunta: **¿cuál de ellos está raro?**
 *
 * ## Por qué una fila con barra de fondo y no una tabla
 *
 * Lo pedido son cinco datos por validador —índice, balance, ganado, estado y
 * bloques—. Cinco columnas de texto no caben en 390px sin encoger la letra por
 * debajo de lo legible, y en la columna de 320px del escritorio tampoco.
 *
 * La salida no es partir la tabla ni hacerla desplazable, sino quitarle una
 * columna al texto: **el `ganado` se codifica dos veces**, como número y como
 * longitud de una barra que es el fondo de la propia fila. La barra no ocupa
 * ancho —vive detrás del texto— y es lo que permite detectar al raro sin leer
 * ni un número: N barras casi iguales y una corta se ve de un vistazo.
 *
 * Esa es también la razón de que la misma forma sirva en móvil y en
 * escritorio, y de que no haya dos disposiciones que mantener.
 *
 * ## Lo que NO hay
 *
 * No hay atestaciones ni efectividad individual: el recolector no las expone y
 * no se inventan. Lo que se compara es el `ganado` de cada uno contra la
 * referencia del grupo, que es rendimiento relativo dentro del propio grupo.
 */

import { referenciaGrupo } from '/val/compartido/ganancias.js';
import { fmt, fmtCompacto, escapar } from './formato.js';

export const TITULO = 'Validadores';

const EXPLORADOR = 'https://www.g4mm4.io/validator/';

/**
 * Por debajo de esta fracción de la referencia del grupo, el validador se
 * marca. Las recompensas por atestación son casi idénticas entre validadores
 * del mismo grupo, así que quedarse un 15% por detrás no es ruido: es haberse
 * perdido atestaciones. La referencia ya excluye al más alto, de modo que el
 * que acaba de proponer bloque no arrastra a los demás al naranja.
 */
const UMBRAL_REZAGADO = 0.85;

/**
 * Un validador activado DESPUÉS del último barrido no ha tenido el ciclo
 * entero para acumular, así que llega con menos que los demás sin que le pase
 * nada. Compararlo contra el grupo lo marcaría como rezagado siendo mentira.
 *
 * Se corrige solo en cuanto pasa un barrido completo (~8,1 h), pero mientras
 * tanto el panel diría que algo va mal justo el día que acabas de ampliar —
 * que es cuando más se mira. Así que se le saca de la comparación y se le
 * rotula por lo que es.
 *
 * Sin `activacion_ts` —recolector viejo— nadie es reciente y todo queda como
 * antes: se degrada, no se rompe.
 */
/**
 * En cola de activación: depositado y esperando turno, 12-18 h.
 *
 * No es «no activo». Se mira `pendiente` —que publica el recolector— y, como
 * respaldo, el propio estado de la beacon API, para que un recolector viejo no
 * deje esto sin funcionar.
 */
function esPendiente(d) {
  return d?.pendiente === true || String(d?.estado || '').startsWith('pending')
    || esEsperando(d);
}

/**
 * Esperando a que la cadena lo conozca.
 *
 * Es un paso ANTES que la cola: hay un keystore en el disco del NUC y la
 * beacon API no devuelve nada para esa pubkey. El recolector lo publica igual
 * en vez de descartarlo, que es lo que hacía hasta el 10-sep-2026.
 *
 * ⚠ No tiene índice. La cadena da el número al adoptar el depósito, así que
 *   todo lo que aquí identifique un validador tiene que aguantar un `null`.
 */
function esEsperando(d) {
  return d?.esperando === true || d?.estado === 'esperando';
}

/**
 * Con qué se identifica una fila.
 *
 * El índice, mientras lo haya; y si no, la pubkey. Con `indice` a `null` como
 * clave de un `Set`, dos que esperasen a la vez serían el mismo elemento y uno
 * de los dos heredaría el estado del otro.
 */
const clave = d => (d?.indice == null ? `pk:${d?.pubkey || d?.pubkey_corta || '?'}` : d.indice);

/**
 * Desde cuándo espera turno, si se puede saber.
 *
 * ⚠ La beacon API NO dice cuándo se depositó: `activation_epoch` es el futuro
 *   lejano mientras no hay turno asignado, y no hay ningún otro campo con la
 *   fecha. Del que aún no está en la cadena no dice absolutamente nada.
 *
 *   Así que quien lo sabe es `push.py`, que corre cada pocos minutos y recuerda
 *   entre ejecuciones cuándo vio esa PUBKEY por primera vez; lo publica en
 *   `en_cola_desde_ts`. Es un «al menos desde», no el instante del depósito, y
 *   se lee así. Como respaldo queda el registro de eventos —lo que se usaba
 *   antes—, que solo sirve una vez la cadena le ha dado número. Si no hay
 *   ninguna de las dos cosas, se dice el estado a secas y no se inventa hora.
 */
function esperando(d, eventos = [], ahoraS) {
  /* Primero, el campo: `push.py` lleva la cuenta POR PUBKEY, así que el reloj
     sobrevive al momento en que la cadena adopta el depósito y le da número.
     El registro solo sabe de índices y ahí el reloj se pondría a cero. */
  let ts = Number(d?.en_cola_desde_ts);
  if (!Number.isFinite(ts) || ts <= 0) {
    const ev = d?.indice == null ? null : eventos.find(e =>
      Number(e.validador) === Number(d.indice)
      && /cola de activaci/i.test(String(e.titulo || '')));
    ts = ev ? Number(ev.ts) : NaN;
  }
  if (!Number.isFinite(ts) || !Number.isFinite(ahoraS) || ts <= 0) return '';
  const h = (ahoraS - ts) / 3600;
  // Solo la duración. El verbo lo pone quien lo use: la nota del que está en
  // cola ya dice «en cola», y la del que espera a la cadena ya dice
  // «esperando» — repetirlo daba «esperando a entrar en la cadena · esperando
  // 3 h», que a 1440 además partía la línea dejando la «h» sola.
  if (h < 1) return 'menos de una hora';
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} días`;
}

function esReciente(d, desdeTs) {
  const ts = Number(d.activacion_ts);
  return Number.isFinite(ts) && desdeTs != null && ts > desdeTs;
}

/* Segundos por slot en PulseChain. Esto SÍ es una constante legítima: es un
   parámetro del protocolo, no un dato de nadie. */
const SEGUNDOS_POR_SLOT = 10;

/**
 * Cada cuánto toca proponer un bloque, en días.
 *
 * Es la cuota de la red: con `n` validadores de `red`, te toca esa fracción de
 * los slots del día. `null` si no se sabe cuántos hay en la red — y entonces no
 * se enseña, en vez de usar un respaldo escrito a fuego como hace el v1
 * (`RED_VALIDADORES_RESPALDO = 46905`), que el día que la red crezca convierte
 * el dato en una estimación silenciosamente vieja.
 */
export function diasPorBloque(propios, red) {
  const n = Number(propios), r = Number(red);
  if (!(n > 0) || !(r > 0)) return null;
  return 1 / ((n / r) * (86400 / SEGUNDOS_POR_SLOT));
}

/** «0,5 días», «3 días». Por debajo de un día se usa una cifra decimal. */
function fmtDias(d, fmt) {
  if (d == null) return null;
  if (d < 1 / 24) return `${fmt(d * 24 * 60, 0)} min`;
  if (d < 2) return `${fmt(d, 1)} días`;
  return `${fmt(d, 0)} días`;
}

export function panelValidadores(datos) {
  const detalle = datos.estado?.validadores?.detalle || [];
  const bloques = datos.ganancia?.por_validador || {};

  if (!detalle.length) {
    return `
      <section class="panel" aria-labelledby="pv-t">
        <header class="p-cab"><h2 id="pv-t">${TITULO}</h2></header>
        <p class="vacio">Sin detalle de validadores.</p>
      </section>`;
  }

  // Instante del último barrido: todo lo activado después no ha corrido el
  // ciclo entero. Sale de los ciclos ya reconciliados contra la cadena.
  const ciclos = datos.ganancia?.ciclos || [];
  const ultimoBarrido = ciclos.length ? Number(ciclos[ciclos.length - 1].ts) : null;

  /* ⚠ EL QUE ESPERA TURNO NO ENTRA EN NINGUNA COMPARACIÓN. Un validador en
     cola tiene cero ganado por definición —aún no ha validado ni un slot— así
     que dentro de la media arrastraría al grupo hacia abajo y dejaría a todos
     los demás pareciendo mejores de lo que son. Es el mismo problema que ya
     resolvía `esReciente` para el recién activado, un paso antes. */
  const enCola = new Set(detalle.filter(esPendiente).map(clave));

  const recientes = new Set(
    detalle.filter(d => !enCola.has(clave(d)) && esReciente(d, ultimoBarrido))
      .map(clave));

  // La referencia se calcula SIN los recién activados ni los que esperan: si
  // no, uno que lleva dos horas arrastraría la media del grupo hacia abajo y
  // taparía a un rezagado de verdad.
  const valores = detalle
    .filter(d => !recientes.has(clave(d)) && !enCola.has(clave(d)))
    .map(d => Number(d.ganado) || 0);
  const ref = referenciaGrupo(valores);

  // La escala de la barra llega un 15% por encima del mayor, no justo hasta
  // él. Sin ese aire la barra más larga toca el borde de la fila y la marca de
  // la referencia —que con los diez sanos cae sobre el 98%— se confunde con el
  // borde en vez de leerse como referencia. El origen sigue en cero: lo que se
  // añade es techo, no un corte por abajo, así que las longitudes siguen
  // siendo proporcionales al valor.
  const tope = Math.max(1, ...detalle.map(d => Number(d.ganado) || 0)) * 1.15;

  // El stake que le toca a cada uno. No se escribe 32M a fuego: sale del
  // estado real, y si algún día cambia el tamaño del depósito esto sigue
  // valiendo.
  const v = datos.estado?.validadores || {};
  const stakeUnitario = Number(v.total) > 0 ? Number(v.stake_total) / Number(v.total) : null;

  /* Cuándo toca el próximo bloque y qué parte de lo ganado sale de proponerlos.
     Los dos venían del v1 y no estaban en el v2. El peso importa porque es LA
     explicación de que el rendimiento baile: proponer un bloque es suerte, y
     las atestaciones son el suelo. */
  const red = Number(datos.estado?.red_validadores_activos) || null;
  const proximo = fmtDias(diasPorBloque(v.total, red), fmt);
  const plsBloques = Number(datos.ganancia?.pls_bloques) || 0;
  const totalGanado = Number(datos.ganancia?.total) || 0;
  const peso = plsBloques > 0 && Number.isFinite(Number(datos.ganancia?.peso_bloques))
    ? Number(datos.ganancia.peso_bloques) : null;

  const activos = detalle.filter(d => d.estado === 'active_ongoing').length;
  const totalBloques = Object.values(bloques).reduce((a, n) => a + Number(n || 0), 0);
  const rezagados = ref
    ? detalle.filter(d => !recientes.has(clave(d)) && !enCola.has(clave(d))
        && (Number(d.ganado) || 0) < ref * UMBRAL_REZAGADO).length
    : 0;
  // Un pendiente no es un problema: se cuenta aparte y se dice como lo que es.
  const problemas = detalle.filter(d =>
    d.slashed || (d.estado !== 'active_ongoing' && !esPendiente(d))).length + rezagados;

  const ahoraS = Number(datos?.ahoraS) || Math.floor(Date.now() / 1000);
  const espera = d => esperando(d, datos?.eventos || [], ahoraS);

  // El que aún no tiene número va al final: es el último que ha llegado, y
  // `a.indice - b.indice` con un `null` da NaN, que deja el orden a merced de
  // cómo estuviera el array.
  const orden = d => (d?.indice == null ? Number.POSITIVE_INFINITY : Number(d.indice));

  const filas = [...detalle].sort((a, b) => orden(a) - orden(b)).map(d => {
    const ganado = Number(d.ganado) || 0;
    const balance = Number(d.balance);
    const nBloques = Number(bloques[d.indice] || 0);
    const reciente = recientes.has(clave(d));
    const cola = enCola.has(clave(d));
    const fuera = esEsperando(d);
    const rezagado = !reciente && !cola && ref != null && ganado < ref * UMBRAL_REZAGADO;
    // Por debajo del depósito significa penalización: el balance solo baja de
    // ahí si la cadena ha quitado. Es lo ÚNICO que hace informativa esta
    // columna — el resto del tiempo los diez marcan el mismo 32M, porque
    // balance = depósito + ganado y el ganado ya está a su izquierda.
    const penalizado = !cola && stakeUnitario != null && Number.isFinite(balance) && balance < stakeUnitario;
    const fueraDeJuego = d.slashed || (d.estado !== 'active_ongoing' && !cola);
    const mal = rezagado || fueraDeJuego || penalizado;

    // El motivo va en palabras, no solo en el color: quien no distinga el
    // naranja tiene que poder ver igualmente cuál está raro y por qué.
    const desde = espera(d);
    const nota = d.slashed ? 'slashed'
      : fuera ? `esperando a entrar en la cadena${desde ? ` · ${desde}` : ''}`
      : cola ? `en cola de activación${desde ? ` · esperando ${desde}` : ''}`
      : d.estado !== 'active_ongoing' ? String(d.estado || 'inactivo')
      : penalizado ? 'por debajo del depósito'
      : rezagado ? 'rezagado'
      : reciente ? 'recién activado · aún sin ciclo completo'
      : '';

    /* ⚠ EL QUE ESPERA NO LLEVA ENLACE. El explorador indexa por índice y este
       no lo tiene: el enlace sería `…/validator/null` y llevaría a un 404. Se
       pinta como `div`, no como `a`, para que tampoco reciba el foco del
       teclado — un enlace enfocable que no va a ninguna parte es peor que la
       falta del enlace. */
    const cuerpo = `
        <span class="v-id${fuera ? ' mono' : ''}">${
          escapar(fuera ? (d.pubkey_corta || 'sin número') : d.indice)}</span>
        <span class="v-marca">${nBloques ? `⬦${nBloques}` : ''}</span>
        <!-- Ni ganado ni balance: no es que valgan cero, es que la cadena no
             sabe nada de él todavía. Un solo guion en la columna del balance
             lo dice; dos guiones sueltos, uno en cada columna, se leen como
             dos cifras rotas. -->
        <span class="v-gan">${fuera ? '' : fmt(ganado)}</span>
        <span class="v-bal${penalizado ? ' alerta' : ''}">${
          fuera ? '—' : penalizado ? fmt(balance) : fmtCompacto(balance)}</span>
        ${nota ? `<span class="v-nota${cola ? ' espera' : ''}">${escapar(nota)}</span>` : ''}`;

    const estilo = `style="--barra:${(fuera ? 0 : (ganado / tope) * 100).toFixed(1)}%${
      ref != null ? `;--ref:${((ref / tope) * 100).toFixed(1)}%` : ''}"`;

    if (fuera) {
      return `
      <div class="vfila espera" ${estilo}
         title="${escapar(d.pubkey_corta || '')} — hay clave en el NUC y la cadena todavía no la conoce">
        ${cuerpo}
      </div>`;
    }

    return `
      <a class="vfila${mal ? ' mal' : ''}" href="${EXPLORADOR}${encodeURIComponent(d.indice)}"
         target="_blank" rel="noopener noreferrer" ${estilo}
         title="Validador ${escapar(d.indice)} · ${escapar(d.pubkey_corta || '')} — ver en g4mm4.io">
        ${cuerpo}
      </a>`;
  }).join('');

  return `
    <section class="panel"${problemas ? ' data-alerta' : ''} aria-labelledby="pv-t">
      <header class="p-cab">
        <h2 id="pv-t">${TITULO}</h2>
        <span class="p-marca${problemas ? ' alerta' : ''}">${
          problemas ? `${fmt(problemas)} con aviso` : `${fmt(activos)} activos`
        }</span>
      </header>

      <div class="vlista">${filas}</div>

      <dl class="p-fondo">
        <div><dt>Bloques</dt><dd>${fmt(totalBloques)}${
          proximo ? ` · el próximo en ~${escapar(proximo)}` : ''}</dd></div>
        <div><dt>Ganado ahora</dt><dd>${fmt(detalle.reduce((a, d) => a + (Number(d.ganado) || 0), 0))}</dd></div>
        <div><dt>Referencia</dt><dd>${ref == null ? '–' : fmt(ref)}</dd></div>
      </dl>
      ${peso != null ? `
      <p class="c-sub">${fmt(peso, 1)} % de lo ganado viene de proponer bloques
        —${fmtCompacto(plsBloques)} de ${fmtCompacto(totalGanado)} PLS—. El resto
        son atestaciones, que es el rendimiento base y no depende de la suerte.
        ${red ? `Tus ${v.total} entre los ${fmt(red)} de la red.` : ''}</p>` : ''}
    </section>`;
}
