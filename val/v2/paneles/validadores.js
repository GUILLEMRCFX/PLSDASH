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
function esReciente(d, desdeTs) {
  const ts = Number(d.activacion_ts);
  return Number.isFinite(ts) && desdeTs != null && ts > desdeTs;
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

  const recientes = new Set(
    detalle.filter(d => esReciente(d, ultimoBarrido)).map(d => d.indice));

  // La referencia se calcula SIN los recién activados: si no, uno que lleva
  // dos horas arrastraría la media del grupo hacia abajo y taparía a un
  // rezagado de verdad.
  const valores = detalle
    .filter(d => !recientes.has(d.indice))
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

  const activos = detalle.filter(d => d.estado === 'active_ongoing').length;
  const totalBloques = Object.values(bloques).reduce((a, n) => a + Number(n || 0), 0);
  const rezagados = ref
    ? detalle.filter(d => !recientes.has(d.indice)
        && (Number(d.ganado) || 0) < ref * UMBRAL_REZAGADO).length
    : 0;
  const problemas = detalle.filter(d => d.slashed || d.estado !== 'active_ongoing').length + rezagados;

  const filas = [...detalle].sort((a, b) => a.indice - b.indice).map(d => {
    const ganado = Number(d.ganado) || 0;
    const balance = Number(d.balance);
    const nBloques = Number(bloques[d.indice] || 0);
    const reciente = recientes.has(d.indice);
    const rezagado = !reciente && ref != null && ganado < ref * UMBRAL_REZAGADO;
    // Por debajo del depósito significa penalización: el balance solo baja de
    // ahí si la cadena ha quitado. Es lo ÚNICO que hace informativa esta
    // columna — el resto del tiempo los diez marcan el mismo 32M, porque
    // balance = depósito + ganado y el ganado ya está a su izquierda.
    const penalizado = stakeUnitario != null && Number.isFinite(balance) && balance < stakeUnitario;
    const fueraDeJuego = d.slashed || d.estado !== 'active_ongoing';
    const mal = rezagado || fueraDeJuego || penalizado;

    // El motivo va en palabras, no solo en el color: quien no distinga el
    // naranja tiene que poder ver igualmente cuál está raro y por qué.
    const nota = d.slashed ? 'slashed'
      : d.estado !== 'active_ongoing' ? String(d.estado || 'inactivo')
      : penalizado ? 'por debajo del depósito'
      : rezagado ? 'rezagado'
      : reciente ? 'recién activado · aún sin ciclo completo'
      : '';

    return `
      <a class="vfila${mal ? ' mal' : ''}" href="${EXPLORADOR}${encodeURIComponent(d.indice)}"
         target="_blank" rel="noopener noreferrer"
         style="--barra:${((ganado / tope) * 100).toFixed(1)}%${
           ref != null ? `;--ref:${((ref / tope) * 100).toFixed(1)}%` : ''}"
         title="Validador ${escapar(d.indice)} · ${escapar(d.pubkey_corta || '')} — ver en g4mm4.io">
        <span class="v-id">${escapar(d.indice)}</span>
        <span class="v-marca">${nBloques ? `⬦${nBloques}` : ''}</span>
        <span class="v-gan">${fmt(ganado)}</span>
        <span class="v-bal${penalizado ? ' alerta' : ''}">${
          penalizado ? fmt(balance) : fmtCompacto(balance)}</span>
        ${nota ? `<span class="v-nota">${escapar(nota)}</span>` : ''}
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
        <div><dt>Bloques</dt><dd>${fmt(totalBloques)}</dd></div>
        <div><dt>Ganado ahora</dt><dd>${fmt(detalle.reduce((a, d) => a + (Number(d.ganado) || 0), 0))}</dd></div>
        <div><dt>Referencia</dt><dd>${ref == null ? '–' : fmt(ref)}</dd></div>
      </dl>
    </section>`;
}
