/**
 * Las curvas de tiempo, en un solo sitio.
 *
 * Las cuatro candidatas empezaron cada una con su `1 - (1-t)³`, y la tira de
 * contacto lo delató: con esa curva, a un tercio del recorrido ya vas por el
 * 70-80 % del movimiento. O sea que la parte que cuenta algo —el enjambre
 * cerrándose, las palas girando— pasa en los primeros 300 ms y el resto es una
 * imagen quieta con el reloj corriendo. Medido en las cuatro a la vez.
 *
 * Con `suave` el movimiento arranca despacio, se emplea en el medio y frena al
 * llegar. Es la curva de algo que tiene masa, y es la que corresponde a un
 * mecanismo. Compartirla entre las cuatro no es ahorro de líneas: es que se
 * comparen por la idea y no porque una vaya con otro ritmo.
 */

/** Arranca y frena. Para todo lo que se ensambla, gira o se abre. */
export const suave = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Frena al final. Para lo que ya venía lanzado: un fogonazo, un aro que se abre. */
export const frenar = t => 1 - Math.pow(1 - t, 3);

/**
 * Casi recta, con los extremos redondeados. Para el barrido del escáner: una
 * línea que barre a velocidad constante se lee como un escáner; si acelera y
 * frena, se lee como una persiana.
 */
export const barrer = t => t * t * (3 - 2 * t) * 0.25 + t * 0.75;

/** 0..1 recortado. */
export const cero1 = t => Math.max(0, Math.min(1, t));
