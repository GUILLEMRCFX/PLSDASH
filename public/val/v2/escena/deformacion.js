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
  uniform float uNacer;        // 1 en reposo; <1 solo mientras se ensambla
`;

export const FUNCION_DEFORMACION = /* glsl */`
  /* Un numero estable en 0..1 por direccion. Estable es la palabra: dos aristas
     que comparten vertice tienen que sacar el MISMO, o se despegan. */
  float ruidoDir(vec3 p) {
    vec3 q = fract(p * 0.3183099 + vec3(0.11, 0.27, 0.53));
    q *= 17.0;
    return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
  }

  vec3 deformar(vec3 p) {
    vec3 dir = normalize(p);
    float r = 1.0 + sin(uTiempo * 0.55 + dir.y * 2.6) * 0.007 * uRespiracion
                  + sin(uTiempo * 0.31 - dir.x * 3.1) * 0.005 * uRespiracion;

    /* El nacimiento. Fuera de la pantalla de carga uNacer vale 1 y esto es un
       salto que no se toma: la esfera de siempre, sin un ciclo de mas.

       Cada vertice viene de mas lejos y girado, con su propio retardo, asi que
       la malla se condensa como un enjambre y no como un globo hinchandose. Va
       aqui y no en la pantalla de carga porque deformar() la comparten todos
       los materiales: si el nacimiento viviera fuera, las aristas y las caras
       se ensamblarian por separado y se verian despegadas.

       (Sin tildes ni comillas invertidas: esto es GLSL dentro de una plantilla
        de JS, y una comilla invertida aqui la cierra.) */
    if (uNacer < 0.999) {
      float h  = ruidoDir(dir * 7.13);
      float h2 = ruidoDir(dir * 3.71 + 11.0);
      float e  = 1.0 - pow(1.0 - clamp(uNacer, 0.0, 1.0), 3.0);
      float retardo = h * 0.42;
      float ti = clamp((e - retardo) / max(0.0001, 1.0 - retardo), 0.0, 1.0);
      float giro = (1.0 - ti) * (h2 - 0.5) * 2.2;
      float c = cos(giro), s = sin(giro);
      vec3 d2 = vec3(dir.x * c - dir.z * s, dir.y + (h - 0.5) * (1.0 - ti) * 0.7,
                     dir.x * s + dir.z * c);
      /* 0,55 y no 1,7. Con 1,7 los vertices salian a 2,7 radios y a uNacer=0 la
         pantalla entera era una maraña blanca: no se leia un enjambre, se leia
         una interferencia. A 1,55 radios la nube cabe en cuadro y se ve que es
         una esfera deshecha. Mirado en tira de contacto a 390. */
      return normalize(mix(d2, dir, ti)) * r * mix(1.0 + 0.55 * h2, 1.0, ti);
    }
    return dir * r;
  }
`;

/** Los uniforms que comparten todos los materiales. Se crean una sola vez. */
export function crearUniformsDeformacion() {
  return {
    uTiempo:      { value: 0 },
    uRespiracion: { value: 1 },
    /* 1 = esfera hecha. Solo la pantalla de carga lo baja, y solo una vez. */
    uNacer:       { value: 1 },
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
