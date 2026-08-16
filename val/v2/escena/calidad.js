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
 * Los escalones ya NO cambian el aspecto, solo el coste.
 *
 * Antes había dos familias —una con bloom y otra compensando su ausencia— y
 * eso abría una brecha entre escritorio y móvil por construcción. Al quitar el
 * postprocesado (se ve mejor sin él: ver el comentario en esfera.js) todos
 * usan la misma técnica, y lo único que varía es cuánta geometría se dibuja y
 * a qué resolución.
 *
 * `grosor`, `halo` y `punto` sí siguen subiendo en los escalones pequeños,
 * pero no por el bloom: en una pantalla de 390px la esfera ocupa muchos menos
 * píxeles, y una línea de 1,3px que en escritorio se lee bien allí sería un
 * pelo. Es corrección de tamaño, no de técnica.
 */
export const ESCALONES = {
  alto:  { celdas: 620, celdasFinas: 1700, puntosInterior: 1500, dprMax: 2,
           bloom: false, grosor: 1.35, grosorFino: 0.7, ganFina: 0.30,
           halo: 1.00, intensidad: 1.50, atmosfera: 0.18, punto: 1.00 },
  medio: { celdas: 430, celdasFinas: 1100, puntosInterior: 950, dprMax: 2,
           bloom: false, grosor: 1.60, grosorFino: 0.8, ganFina: 0.32,
           halo: 1.30, intensidad: 1.60, atmosfera: 0.20, punto: 1.15 },
  bajo:  { celdas: 300, celdasFinas: 700,  puntosInterior: 550, dprMax: 1.5,
           bloom: false, grosor: 1.90, grosorFino: 0.9, ganFina: 0.34,
           halo: 1.50, intensidad: 1.70, atmosfera: 0.22, punto: 1.30 },
};

/**
 * Escalón inicial.
 *
 * Lo que cuesta aquí es rellenar píxeles, no calcular: la escena es geometría
 * pequeña con mucho solape aditivo. Por eso la decisión se toma sobre el
 * TAMAÑO y la DENSIDAD de la pantalla, no sobre el número de núcleos de CPU
 * —que es un indicador pésimo de la GPU y dejaba en `medio` a cualquier
 * escritorio de cuatro núcleos con tarjeta de sobra—.
 *
 * Si se acaba eligiendo demasiado alto, el vigilante lo corrige en marcha.
 */
export function elegirEscalon() {
  if (typeof window === 'undefined') return 'medio';

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const corto = Math.min(window.innerWidth, window.innerHeight);
  const largo = Math.max(window.innerWidth, window.innerHeight);
  // `deviceMemory` no existe en Safari; su ausencia no se interpreta como poca.
  const memoria = navigator.deviceMemory || 8;

  // Móvil. Se evita apoyarse en `deviceMemory`: Safari no lo implementa, así
  // que en un iPhone —el aparato para el que existe el escalón bajo— nunca
  // dispararía y `bajo` quedaría inalcanzable. Se decide por tamaño, que sí es
  // fiable, y lo demás lo corrige el vigilante midiendo fotogramas de verdad
  // en vez de adivinando el aparato.
  if (corto < 380) return 'bajo';
  if (corto < 480) return 'medio';
  if (corto < 700 || largo < 900) return 'medio';
  if (memoria <= 4) return 'medio';
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
