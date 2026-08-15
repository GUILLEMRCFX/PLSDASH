/**
 * Escalones de calidad.
 *
 * Una distinción que importa: hay ajustes **de construcción** (cuántas celdas,
 * cuánto se subdivide el icosaedro) y ajustes **en caliente** (resolución de
 * render, bloom). El escalón inicial se elige una vez, al arrancar, y fija los
 * de construcción. La vigilancia posterior solo puede tocar los de caliente.
 *
 * Es a propósito: rehacer la geometría a mitad de sesión daría un tirón
 * visible y cambiaría el dibujo de las celdas delante del usuario. Bajar la
 * resolución o apagar el bloom no se nota como un salto.
 *
 * Y solo se baja, nunca se sube. Un vigilante que corrige en los dos sentidos
 * oscila: apaga el bloom, sube a 60fps, lo reenciende, vuelve a caer.
 */

/**
 * `intensidad` y `atmosfera` compensan la falta de bloom. Sin ellas el escalón
 * sin postprocesado no parece la versión ligera, parece la versión rota.
 *
 * `celdasFinas` es la retícula secundaria: un segundo Voronoi mucho más denso
 * que se dibuja tenue por debajo. Los tres niveles de línea —fina, principal y
 * la cadena naranja— son la mitad del efecto; con todas al mismo grosor y
 * brillo la esfera se lee plana.
 */
export const ESCALONES = {
  alto:  { celdas: 620, celdasFinas: 1700, puntosInterior: 1500, dprMax: 2,
           bloom: true,  grosor: 1.35, grosorFino: 0.7, ganFina: 0.30,
           halo: 1.00, intensidad: 1.25, atmosfera: 0.10, punto: 1.00 },
  medio: { celdas: 430, celdasFinas: 1100, puntosInterior: 950, dprMax: 2,
           bloom: false, grosor: 1.60, grosorFino: 0.8, ganFina: 0.32,
           halo: 1.30, intensidad: 1.55, atmosfera: 0.18, punto: 1.15 },
  bajo:  { celdas: 300, celdasFinas: 700,  puntosInterior: 550, dprMax: 1.5,
           bloom: false, grosor: 1.90, grosorFino: 0.9, ganFina: 0.34,
           halo: 1.50, intensidad: 1.70, atmosfera: 0.22, punto: 1.30 },
};

/**
 * Sin bloom, el resplandor lo tiene que poner la propia arista. Por eso los
 * escalones bajos llevan la línea más gruesa y el halo más ancho: es lo que
 * evita que móvil parezca la versión rota en vez de la versión ligera.
 */
export function elegirEscalon() {
  if (typeof navigator === 'undefined') return 'medio';

  const dpr = window.devicePixelRatio || 1;
  const ancho = Math.min(window.innerWidth, window.innerHeight);
  const nucleos = navigator.hardwareConcurrency || 4;
  // `deviceMemory` no existe en Safari; su ausencia no se interpreta como poca.
  const memoria = navigator.deviceMemory || 8;

  if (ancho < 480 || memoria <= 4 || nucleos <= 4) {
    // Pantalla de móvil y densidad alta es la combinación más cara que hay:
    // el área a rellenar crece con el cuadrado del dpr.
    return (dpr >= 3 && nucleos <= 4) ? 'bajo' : 'medio';
  }
  if (ancho < 900) return 'medio';
  return 'alto';
}

/**
 * Mide el tiempo de fotograma y degrada si no llega. Ignora los primeros
 * fotogramas: compilar shaders y subir geometría hace que los primeros
 * siempre sean lentos, y actuar sobre eso degradaría a todo el mundo.
 */
export class Vigilante {
  constructor(alDegradar, { objetivoMs = 20, muestras = 45, calentamiento = 30 } = {}) {
    this.alDegradar = alDegradar;
    this.objetivoMs = objetivoMs;
    this.muestras = muestras;
    this.calentamiento = calentamiento;
    this.vistos = 0;
    this.acumulado = 0;
    this.contados = 0;
    this.agotado = false;
  }

  fotograma(ms) {
    if (this.agotado) return;
    if (++this.vistos <= this.calentamiento) return;

    this.acumulado += ms;
    if (++this.contados < this.muestras) return;

    const medio = this.acumulado / this.contados;
    this.acumulado = 0;
    this.contados = 0;

    if (medio > this.objetivoMs) {
      const seguir = this.alDegradar(medio);
      if (!seguir) this.agotado = true;   // ya no queda nada que bajar
    }
  }
}
