/**
 * Datos inventados para ver la esfera sin backend.
 *
 * Las proporciones no son al azar: reproducen el reparto real de bloques
 * propuestos que hay hoy en D1 (uno lleva 5, dos llevan 1, el resto entre 2 y
 * 3). Así lo que se ve en pantalla es el contraste que de verdad va a haber,
 * y no uno inventado que quede más lucido de lo que será.
 *
 * Este fichero se borra entero cuando entren los datos reales. La esfera no lo
 * importa: lo recibe quien la monta.
 */

const BLOQUES_REALES = [1, 2, 5, 2, 3, 2, 3, 2, 3, 1];

export function validadoresFalsos(n = BLOQUES_REALES.length) {
  const bloques = Array.from({ length: n }, (_, i) => BLOQUES_REALES[i % BLOQUES_REALES.length]);
  const max = Math.max(...bloques);
  return bloques.map((b, i) => ({
    id: 109549 + i,
    bloques: b,
    activo: true,
    // Normalizar aquí es justo el trabajo que hará la capa de datos: la esfera
    // solo recibe el 0..1 y no sabe qué es un bloque.
    intensidad: 0.28 + (b / max) * 0.72,
  }));
}

export function estadoFalso(n) {
  return {
    nodos: validadoresFalsos(n),
    energia: 0.62,
    frescura: 1,
  };
}
