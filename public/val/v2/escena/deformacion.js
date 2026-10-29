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
 *
 * ## La onda al tocar (29-oct-2026) NO es el bulto que se quitó
 *
 * El bulto seguía al puntero mientras se movía: estaba siempre puesto y
 * deformaba la esfera allí donde estuviera el ratón. La onda es otra cosa: sale
 * UNA vez del punto tocado, recorre la superficie en algo más de un segundo y
 * se apaga. Sin toque no existe, y no persigue a nadie. Va aquí, y no en cada
 * material, por la misma regla de siempre: si cada capa ondulara por su cuenta
 * las aristas se despegarían de las celdas al paso de la onda.
 *
 * `uOndaP` son las direcciones tocadas y `uOndaT` el instante de cada toque,
 * en el RELOJ REAL (`uReloj`), no en `uTiempo`. `uTiempo` acumula `dt` acotado
 * y en una máquina lenta va más despacio que el reloj: la onda duraría el doble
 * en el móvil malo. Es el mismo fallo que ya tuvo el destello.
 */

import { Vector3 } from '../vendor/three.module.js';

export const UNIFORMS_DEFORMACION = /* glsl */`
  uniform float uTiempo;
  uniform float uRespiracion;  // 0 con movimiento reducido
  uniform float uNacer;        // 1 en reposo; <1 solo mientras se ensambla
  uniform float uReloj;        // segundos de reloj real, para la onda
  uniform vec3  uOndaP[4];     // direcciones tocadas
  uniform float uOndaT[4];     // instante de cada toque, en uReloj; -100 = libre
`;

export const FUNCION_DEFORMACION = /* glsl */`
  /* Un numero estable en 0..1 por direccion. Estable es la palabra: dos aristas
     que comparten vertice tienen que sacar el MISMO, o se despegan. */
  float ruidoDir(vec3 p) {
    vec3 q = fract(p * 0.3183099 + vec3(0.11, 0.27, 0.53));
    q *= 17.0;
    return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
  }

  /* Cuanto le toca de onda a una direccion: 0 lejos del frente, 1 en el frente
     de una onda recien nacida. La usan deformar() y el brillo de las lineas. */
  float ondaToque(vec3 dir) {
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      float edad = uReloj - uOndaT[i];
      if (edad < 0.0 || edad > 2.6) continue;
      float ang = acos(clamp(dot(dir, uOndaP[i]), -1.0, 1.0));
      float frente = edad * 1.55;
      s += exp(-pow((ang - frente) * 5.0, 2.0)) * exp(-edad * 1.35);
    }
    return s;
  }

  vec3 deformar(vec3 p) {
    vec3 dir = normalize(p);
    float r = 1.0 + sin(uTiempo * 0.55 + dir.y * 2.6) * 0.007 * uRespiracion
                  + sin(uTiempo * 0.31 - dir.x * 3.1) * 0.005 * uRespiracion
                  + ondaToque(dir) * 0.045;

    /* EL NACIMIENTO: LA IGNICION. Fuera de la pantalla de carga uNacer vale 1
       y esto es un salto que no se toma: la esfera de siempre, sin un ciclo
       de mas.

       Tres tramos, cada vertice con su propio retardo:
         0,00-0,12  todo esta en el centro: un punto, que es el nucleo.
         0,12-0,36  estalla hacia fuera y se pasa un poco de la superficie.
         0,32-0,92  cae sobre ella, girando un poco, cada uno a su ritmo.
       Las lineas no se ven en el primer tramo (ver materialLinea en
       esfera.js): apelotonadas en un punto, cada una es un cuadrado.
       Sustituye al enjambre que se condensaba (hasta el 29-oct-2026), y vive
       aqui por lo mismo que vivia el: deformar() la comparten la cascara, las
       aristas y los nodos, asi que no pueden ensamblarse por separado.

       (Sin tildes ni comillas invertidas: esto es GLSL dentro de una plantilla
        de JS, y una comilla invertida aqui la cierra.) */
    if (uNacer < 0.999) {
      float h  = ruidoDir(dir * 7.13);
      float h2 = ruidoDir(dir * 3.71 + 11.0);
      float e  = clamp(uNacer, 0.0, 1.0);
      float t1 = clamp((e - 0.12) / 0.24, 0.0, 1.0);
      float sale = 1.0 - pow(1.0 - t1, 3.0);
      float t2 = clamp((e - 0.32 - h * 0.22) / 0.38, 0.0, 1.0);
      float cae = t2 * t2 * (3.0 - 2.0 * t2);
      /* 1,12 + 0,25 y no mas: con 1,25 + 0,45 la red se salia de la pantalla
         a 390 y el tramo del medio era una maraña de rayas. Mirado en tira. */
      float rad = mix(0.02, 1.12 + 0.25 * h2, sale);
      rad = mix(rad, 1.0, cae);
      float giro = (1.0 - cae) * (h2 - 0.5) * 0.9;
      float c = cos(giro), s = sin(giro);
      vec3 d2 = vec3(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);
      return normalize(mix(d2, dir, cae)) * r * rad;
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
    uReloj:       { value: 0 },
    uOndaP:       { value: [0, 1, 2, 3].map(() => new Vector3(0, 1, 0)) },
    uOndaT:       { value: [-100, -100, -100, -100] },
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
