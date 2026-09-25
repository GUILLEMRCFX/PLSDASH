/**
 * De los datos del panel al estado de la escena.
 *
 * La esfera no sabe qué es un validador, ni un barrido, ni un bloque: recibe
 * números ya normalizados entre 0 y 1. Esta es la pieza que traduce, y vive
 * fuera de `escena/esfera.js` a propósito, para que la esfera se siga pudiendo
 * probar con cualquier cosa sin arrastrar la lógica de negocio.
 *
 * ⚠ Sustituye a `datos-falsos.js`, que tenía DIEZ entradas escritas a mano:
 *
 *       const BLOQUES_REALES = [1, 2, 5, 2, 3, 2, 3, 2, 3, 1];
 *
 *   De ahí salían los 10 nodos cuando ya había 11 validadores. No era un fallo
 *   de conteo: la esfera nunca había leído un dato de verdad. El recuento sale
 *   ahora de `estado.validadores.detalle`, así que el día que entre el #12
 *   aparece solo — `esfera.actualizar()` reconstruye la malla de nodos en
 *   cuanto cambia la longitud de la lista.
 *
 * ## Qué codifica cada cosa, y por qué esa y no otra
 *
 * Nada se mueve aquí sin un dato detrás. Los tres canales que la esfera expone
 * ya tenían un significado en el shader, y se les ha atado el dato que encaja
 * con lo que hacen:
 *
 *   · `intensidad` por nodo → BLOQUES PROPUESTOS por ese validador. Es la única
 *     señal que de verdad distingue a unos de otros: hoy van de 1 a 7. (Que la
 *     diferencia sea suerte y no rendimiento está medido y anotado en el panel
 *     de Validadores; aquí solo se pinta el hecho.)
 *
 *   · `energia` → AVANCE DEL CICLO DE BARRIDO. En el shader multiplica el
 *     brillo de las seis capas, así que la esfera se va cargando durante las
 *     ~8,1 h que tarda en acumularse el excedente y baja de golpe cuando el
 *     protocolo lo retira. La escena respira al ritmo del ciclo real.
 *
 *   · `pendiente` por nodo → EN COLA DE ACTIVACIÓN. No es un canal continuo
 *     como los otros tres: es un hecho, y por eso late en vez de graduarse. Un
 *     validador esperando turno no ha ganado nada y no tiene bloques, así que
 *     sin esto se dibujaría exactamente igual que uno muerto.
 *
 *   · `frescura` → EDAD DEL DATO. En el shader desatura hasta gris. Si el NUC
 *     deja de reportar, la esfera pierde el color: el mismo hecho que cuenta el
 *     pulso, dicho en el fondo de la pantalla y sin texto.
 */

import { proximoBarrido } from '/val/compartido/ganancias.js';
import { PERIODO_S, GRACIA_S } from '../paneles/pulso.js';

/**
 * A partir de aquí el dato se considera muerto y la esfera queda en gris. Es el
 * mismo umbral con el que `saludGlobal()` dice DESFASADO: dos sitios distintos
 * no pueden discrepar sobre cuándo dejar de fiarse del dato.
 */
export const MUERTO_S = 15 * 60;

/**
 * Cuánto se aparta de la referencia un nodo para llegar al extremo.
 *
 * `1` = el doble de la mediana llega al tamaño máximo, y cero bloques al
 * mínimo. Es una ventana RELATIVA, y ahí está toda la gracia: si dentro de
 * tres meses el grupo va de 5 a 30 bloques en vez de 0 a 13, la mediana sube
 * con él y el dibujo es el mismo. No hay que recalibrar nada.
 */
const VENTANA = 1;

/** La mediana, que es la referencia del grupo. */
function mediana(v) {
  if (!v.length) return 0;
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * Bloques propuestos → intensidad de 0 a 1, comparando con el GRUPO.
 *
 * ## Por qué no se divide por el máximo
 *
 * Hasta el 12-sep-2026 esto era `SUELO + bloques / max * (1 - SUELO)`, con el
 * suelo a 0,28. Dos problemas, y el segundo es el grave:
 *
 *   1. El suelo se comía el 28 % de la escala ANTES de empezar. Estaba ahí
 *      para que un validador con cero bloques no desapareciera, que es una
 *      condición correcta — pero puesta en el sitio equivocado. Ahora el
 *      mínimo visible lo garantiza la GEOMETRÍA (`TAM_MIN`, `NUCLEO`), que es
 *      donde se decide qué se ve, y el dato puede usar la escala entera.
 *
 *   2. ⚠ DIVIDIR POR EL MÁXIMO HACE QUE LA ESCALA ENCOJA SOLA. Cuando se
 *      calibró, el rango era de 1 a 7 bloques y un bloque de diferencia movía
 *      1/7 de la escala. Hoy va de 0 a 13 y el mismo bloque mueve 1/13: la
 *      mitad. Dentro de tres meses irá de 5 a 30 y moverá 1/30. Cuanto más
 *      tiempo lleva el nodo funcionando, menos se distingue nada — que es
 *      exactamente al revés de lo que hace falta.
 *
 * Comparar con la MEDIANA del grupo no tiene ese problema: es una medida
 * relativa. Si todos doblan sus bloques, el dibujo no cambia. Si uno se queda
 * a cero mientras los demás van por seis, se ve, hoy y dentro de un año.
 *
 * Y dice la verdad en el caso aburrido: doce validadores casi iguales salen
 * casi iguales, porque lo son. Con el máximo como referencia, el que llevara
 * un bloque más que el resto salía al tope de la escala como si fuera otra
 * cosa.
 *
 * @param {number[]} bloques  bloques propuestos, en el orden de los nodos.
 * @returns {number[]} intensidades de 0 a 1.
 */
export function intensidadesDesde(bloques = []) {
  const v = bloques.map(n => {
    const x = Number(n);
    return Number.isFinite(x) && x > 0 ? x : 0;
  });
  if (!v.length) return [];

  let ref = mediana(v);
  // Más de la mitad del grupo a cero: la mediana no sirve de referencia y se
  // cae a la media, que solo vale cero si NADIE ha propuesto nada.
  if (!(ref > 0)) ref = v.reduce((a, b) => a + b, 0) / v.length;
  // Y si tampoco hay media, no hay nada que comparar: todos al medio. Repartir
  // tamaños ahí sería dibujar una diferencia que no existe.
  if (!(ref > 0)) return v.map(() => 0.5);

  return v.map(n => acotar(0.5 + (n - ref) / (2 * VENTANA * ref)));
}

/** Banda de brillo del ciclo. Ver la nota de `energia`. */
const ENERGIA_MIN = 0.35;
const ENERGIA_MAX = 0.85;

const acotar = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));

/**
 * Los nodos, uno por validador.
 *
 * ⚠ ORDENADOS POR ÍNDICE, siempre. Las posiciones sobre la esfera se reparten
 *   por el orden del array (Fibonacci), así que si el orden cambiara entre dos
 *   refrescos los nodos saltarían de sitio sin que hubiera pasado nada. El
 *   endpoint no promete ningún orden.
 */
export function nodosDesde(detalle = [], porValidador = {}) {
  /* ⚠ EL QUE ESPERA NO TIENE ÍNDICE —la cadena aún no se lo ha dado— y
     `Number(null)` es 0, no NaN: sin este orden explícito el nodo nuevo se
     colaría en la PRIMERA posición de la esfera y empujaría a los once de
     sitio. Va al final, que además es donde tiene sentido: es el último que
     ha llegado. */
  const orden = d => {
    const i = Number(d?.indice);
    return Number.isFinite(i) && d?.indice != null ? i : Number.POSITIVE_INFINITY;
  };
  const lista = [...detalle].sort((a, b) => orden(a) - orden(b));
  const bloques = lista.map(d => Number(porValidador[d.indice]) || 0);
  // Sin datos de bloques —el explorador no responde— todos valen lo mismo.
  // Inventar un reparto sería pintar una diferencia que no se sabe si existe.
  const hayBloques = bloques.some(n => n > 0);
  const intensidades = hayBloques ? intensidadesDesde(bloques) : bloques.map(() => 0.5);

  return lista.map((d, i) => ({
    indice: d.indice == null ? null : Number(d.indice),
    // La pubkey corta es lo único con lo que se le puede llamar mientras no
    // tenga número. El rótulo de la esfera la usa en su lugar.
    pubkeyCorta: d.pubkey_corta || null,
    esperando: d.esperando === true || d.estado === 'esperando',
    bloques: bloques[i],
    intensidad: intensidades[i],
    activo: d.slashed !== true && d.estado === 'active_ongoing',
    /* ⚠ PENDIENTE ES UN TERCER ESTADO, no «no activo».
       Un validador recien depositado tiene CERO bloques y no esta
       `active_ongoing`, asi que con dos estados salia con la intensidad del
       suelo y el halo apagado: idéntico a uno muerto. Y es lo contrario — está
       a punto de empezar. La esfera lo late; ver `esfera.js`. */
    pendiente: d.pendiente === true || String(d.estado || '').startsWith('pending')
      || d.estado === 'esperando',
    // Para el rótulo al señalarlo: desde cuándo espera, si se sabe.
    estado: d.estado || null,
    enColaDesdeTs: Number(d.en_cola_desde_ts) || null,
  }));
}

/**
 * Frescura del dato, de 1 (recién llegado) a 0 (muerto).
 *
 * Se mantiene en 1 durante todo el plazo en que el dato es normal —los 3 min
 * del cron más el margen de gracia del pulso— y de ahí baja en rampa hasta el
 * umbral de desfasado. Así la esfera no parpadea en cada ciclo: solo se apaga
 * cuando de verdad hay algo que decir.
 */
export function frescuraDesde(generadoTs, ahoraS) {
  const ts = Number(generadoTs);
  if (!Number.isFinite(ts) || ts <= 0) return 0;

  const edad = ahoraS - ts;
  const enPlazo = PERIODO_S + GRACIA_S;
  if (edad <= enPlazo) return 1;
  if (edad >= MUERTO_S) return 0;
  return 1 - (edad - enPlazo) / (MUERTO_S - enPlazo);
}

/**
 * El estado completo de la escena.
 *
 * @param {object} datos   lo que devuelve `cargarTodo()`.
 * @returns {{nodos:Array, energia:number, frescura:number}}
 */
export function escenaDesde(datos, ahoraS = Math.floor(Date.now() / 1000)) {
  const detalle = datos?.estado?.validadores?.detalle || [];
  const nodos = nodosDesde(detalle, datos?.ganancia?.por_validador || {});

  // Sin ciclos medidos no se finge un avance: se deja el brillo en el centro de
  // la banda y la esfera se queda quieta, que es lo honesto cuando no se sabe
  // en qué punto del ciclo estamos.
  const prox = proximoBarrido(datos?.ganancia?.ciclos || [], ahoraS);
  const energia = prox
    ? ENERGIA_MIN + acotar(prox.avance) * (ENERGIA_MAX - ENERGIA_MIN)
    : (ENERGIA_MIN + ENERGIA_MAX) / 2;

  return {
    nodos,
    energia,
    frescura: frescuraDesde(datos?.estado?.generado_ts, ahoraS),
  };
}
