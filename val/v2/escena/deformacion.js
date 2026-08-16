/**
 * La deformación de la superficie, en un solo sitio.
 *
 * La cáscara, las aristas y los nodos son materiales distintos. Si cada uno
 * deformase por su cuenta se despegarían y se vería el borde flotando sobre la
 * celda. Este trozo de GLSL se inyecta en todos, así que por construcción no
 * pueden discrepar.
 *
 * La regla que lo hace funcionar: `deformar()` es una función pura de la
 * posición en reposo. Dos aristas que comparten un vértice reciben la misma
 * entrada y devuelven la misma salida, así que siguen unidas sin que haya que
 * guardar ninguna adyacencia ni recalcular nada por fotograma. Todo ocurre en
 * el vertex shader: cero trabajo de CPU.
 *
 * ## Ya no hay bulto bajo el puntero
 *
 * Hubo una deformación que seguía al ratón. Se retiró entera, y con ella el
 * raycast contra la esfera y los uniforms que la alimentaban. Lo único que
 * queda es la respiración: una onda lentísima que recorre la superficie y que
 * es lo que separa la esfera de un objeto muerto cuando nadie la toca.
 */

export const UNIFORMS_DEFORMACION = /* glsl */`
  uniform float uTiempo;
  uniform float uRespiracion;  // 0 con movimiento reducido
`;

export const FUNCION_DEFORMACION = /* glsl */`
  vec3 deformar(vec3 p) {
    vec3 dir = normalize(p);
    float r = 1.0 + sin(uTiempo * 0.55 + dir.y * 2.6) * 0.007 * uRespiracion
                  + sin(uTiempo * 0.31 - dir.x * 3.1) * 0.005 * uRespiracion;
    return dir * r;
  }
`;

/** Los uniforms que comparten todos los materiales. Se crean una sola vez. */
export function crearUniformsDeformacion() {
  return {
    uTiempo:      { value: 0 },
    uRespiracion: { value: 1 },
  };
}

/**
 * Inyecta el bloque en un shader ya escrito. `anclaje` es el trozo que se usa
 * como punto de inserción — en los shaders de Three siempre hay un
 * `#include <common>` cerca del principio.
 */
export function inyectar(codigo, anclaje = '#include <common>') {
  return codigo.replace(
    anclaje,
    `${anclaje}\n${UNIFORMS_DEFORMACION}\n${FUNCION_DEFORMACION}`
  );
}
