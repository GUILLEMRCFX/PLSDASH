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
 * Suelo de la intensidad de un nodo.
 *
 * El que menos bloques lleva no puede quedar en cero: seguiría siendo un
 * validador tuyo, activo y ganando, y apagarlo del todo diría lo contrario.
 * El rango útil es lo que queda por encima.
 */
const SUELO = 0.28;

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
  const lista = [...detalle].sort((a, b) => Number(a.indice) - Number(b.indice));
  const bloques = lista.map(d => Number(porValidador[d.indice]) || 0);
  const max = Math.max(0, ...bloques);

  return lista.map((d, i) => ({
    indice: Number(d.indice),
    bloques: bloques[i],
    // Sin datos de bloques —el explorador no responde— todos valen lo mismo.
    // Inventar un reparto sería pintar una diferencia que no se sabe si existe.
    intensidad: max > 0 ? SUELO + (bloques[i] / max) * (1 - SUELO) : 0.5,
    activo: d.slashed !== true && d.estado === 'active_ongoing',
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
