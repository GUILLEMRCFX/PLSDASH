/**
 * La deformación de la superficie, en un solo sitio.
 *
 * La cáscara, las aristas y los nodos son tres materiales distintos. Si cada
 * uno deformase por su cuenta se despegarían y se vería el borde flotando
 * sobre la celda. Este trozo de GLSL se inyecta en los tres, así que por
 * construcción no pueden discrepar.
 *
 * La regla que lo hace funcionar: `deformar()` es una función pura de la
 * posición en reposo. Dos aristas que comparten un vértice reciben la misma
 * entrada y devuelven la misma salida, así que siguen unidas sin que haya que
 * guardar ninguna adyacencia ni recalcular nada por fotograma. Todo ocurre en
 * el vertex shader: cero trabajo de CPU.
 */

export const UNIFORMS_DEFORMACION = /* glsl */`
  uniform vec3  uPuntero;      // dirección del puntero sobre la esfera
  uniform float uFuerza;       // 0 = en reposo, 1 = dedo encima
  uniform float uTiempo;
  uniform float uRespiracion;  // 0 con movimiento reducido
`;

export const FUNCION_DEFORMACION = /* glsl */`
  vec3 deformar(vec3 p) {
    vec3 dir = normalize(p);

    // Respiración: una onda lentísima que recorre la esfera. Es lo que la
    // separa de un objeto muerto cuando nadie la toca.
    float r = 1.0 + sin(uTiempo * 0.55 + dir.y * 2.6) * 0.007 * uRespiracion
                  + sin(uTiempo * 0.31 - dir.x * 3.1) * 0.005 * uRespiracion;

    // Bulto bajo el puntero. La amplitud es deliberadamente más corta que en
    // un campo de puntos: una malla de celdas acusa el estirón y a partir de
    // cierto punto se ve desgarrada en vez de viva.
    float d = dot(dir, uPuntero);
    float caida = smoothstep(0.72, 1.0, d);
    r += caida * caida * 0.085 * uFuerza;

    // Anillo de compresión alrededor del bulto: sin él la superficie parece
    // hinchada, con él parece que algo empuja desde dentro.
    float anillo = smoothstep(0.55, 0.78, d) * (1.0 - smoothstep(0.78, 0.92, d));
    r -= anillo * 0.022 * uFuerza;

    return dir * r;
  }
`;

/** Los uniforms que comparten los tres materiales. Se crean una sola vez. */
export function crearUniformsDeformacion(THREE) {
  return {
    uPuntero:     { value: new THREE.Vector3(0, 0, 1) },
    uFuerza:      { value: 0 },
    uTiempo:      { value: 0 },
    uRespiracion: { value: 1 },
  };
}

/**
 * Inyecta el bloque en un shader ya escrito. `anclaje` es el trozo que se
 * usa como punto de inserción — en los shaders de Three siempre hay un
 * `#include <common>` cerca del principio.
 */
export function inyectar(codigo, anclaje = '#include <common>') {
  return codigo.replace(
    anclaje,
    `${anclaje}\n${UNIFORMS_DEFORMACION}\n${FUNCION_DEFORMACION}`
  );
}
