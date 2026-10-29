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
 * Los escalones cambian el coste, no el aspecto.
 *
 * ## 29-oct-2026: vuelve el resplandor, y vuelve para todos
 *
 * Hubo una época con dos familias —una con bloom y otra compensando su
 * ausencia— y eso abría una brecha entre escritorio y móvil por construcción.
 * Se quitó el postprocesado entero. Vuelve ahora, a petición del propietario
 * tras ver el taller de prototipos, pero con la regla que faltaba entonces:
 * LOS TRES ESCALONES LO LLEVAN. Lo que cambia entre ellos es a qué resolución
 * se calcula (`bloom.escala`), no si está. El vigilante solo lo apaga como
 * último recurso, cuando ya no queda resolución que bajar.
 *
 * ## 300 celdas para todos
 *
 * Antes eran 620 / 430 / 300. Con resplandor, 620 celdas de líneas finas se
 * funden en una bruma blanca, tapan el núcleo y dejan a los validadores —que
 * son el dato— perdidos en una maraña. 300 era ya el escalón bajo: el tamaño
 * existía y funcionaba, solo se usa para todos. La malla fina y el campo
 * interior bajan en proporción.
 *
 * `grosor`, `halo` y `punto` sí suben en los escalones pequeños, pero no por
 * técnica: en 390px la esfera ocupa muchos menos píxeles y una línea que en
 * escritorio se lee bien allí sería un pelo. Es corrección de tamaño.
 */
export const ESCALONES = {
  alto:  { celdas: 300, celdasFinas: 900, puntosInterior: 650, dprMax: 2,
           grosor: 1.30, grosorFino: 0.62, ganFina: 0.09,
           halo: 1.00, intensidad: 2.10, atmosfera: 0.14, punto: 1.00,
           pulsos: 70, nucleoDetalle: 16,
           bloom: { fuerza: 0.45, radio: 0.45, umbral: 1.2, escala: 1 } },
  medio: { celdas: 300, celdasFinas: 800, puntosInterior: 600, dprMax: 2,
           grosor: 1.45, grosorFino: 0.70, ganFina: 0.10,
           halo: 1.30, intensidad: 2.20, atmosfera: 0.16, punto: 1.15,
           pulsos: 55, nucleoDetalle: 12,
           bloom: { fuerza: 0.45, radio: 0.45, umbral: 1.2, escala: 0.75 } },
  bajo:  { celdas: 300, celdasFinas: 700, puntosInterior: 450, dprMax: 1.5,
           grosor: 1.60, grosorFino: 0.80, ganFina: 0.11,
           halo: 1.50, intensidad: 2.30, atmosfera: 0.18, punto: 1.30,
           pulsos: 40, nucleoDetalle: 8,
           bloom: { fuerza: 0.45, radio: 0.45, umbral: 1.2, escala: 0.5 } },
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
