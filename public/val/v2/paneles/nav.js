/**
 * La barra de navegación que se contrae al desplazar.
 *
 * Solo en móvil, donde la barra es una píldora flotante abajo. En escritorio se
 * queda arriba y quieta: una píldora flotante inferior en una pantalla ancha no
 * se alcanza mejor con nada y estorba al contenido.
 *
 * ## Por qué no se ata al dedo
 *
 * En iOS el dedo se levanta y el desplazamiento SIGUE por inercia, a veces un
 * segundo largo. Si la barra se expandiera en `touchend`, se expandiría con la
 * página todavía en marcha — que es justo el momento en el que estorba y lo
 * contrario de lo que se busca. Lo que hay que detectar es que el
 * DESPLAZAMIENTO ha parado, no que el dedo se ha ido.
 *
 * ## `scrollend` y por qué NO se confía solo en él
 *
 * `scrollend` es exactamente el evento que hace falta: se dispara cuando el
 * desplazamiento termina de verdad, inercia incluida. Está en Chrome y en
 * Firefox desde hace tiempo; en Safari llegó tarde y no se ha podido comprobar
 * desde aquí en qué versión exacta —esta máquina no tiene salida a la red para
 * mirarlo—. Da igual: se detecta en tiempo de ejecución.
 *
 * Pero la detección no basta por sí sola. `scrollend` puede no llegar nunca en
 * casos raros —un desplazamiento interrumpido por una navegación, un contenedor
 * que se desmonta— y entonces la barra se quedaría encogida para siempre. Así
 * que el temporizador de reposo va SIEMPRE, y `scrollend` solo sirve para
 * expandir antes cuando está. Uno da precisión y el otro garantiza que se
 * recupera; ninguno de los dos solo hace las dos cosas.
 */

/** Silencio que se considera «ha parado». */
const REPOSO_MS = 140;

/**
 * 140 y no 60 ni 400. Por debajo de ~100 ms la barra se expande en los huecos
 * que deja la inercia entre fotograma y fotograma y da un parpadeo; por encima
 * de ~250 se nota que llega tarde y parece que la página se ha quedado pensando.
 */

const ANCHO_MOVIL = '(max-width: 819px)';

export function engancharNav() {
  const raiz = document.documentElement;
  const movil = window.matchMedia(ANCHO_MOVIL);
  const menos = window.matchMedia('(prefers-reduced-motion: reduce)');
  let temporizador = 0;

  const expandir = () => {
    clearTimeout(temporizador);
    delete raiz.dataset.nav;
  };

  const contraer = () => {
    // Con poco movimiento no se contrae nada: la barra se queda como está y no
    // hay ni encogimiento ni muelle. Y en escritorio tampoco, que allí no es una
    // píldora flotante.
    if (menos.matches || !movil.matches) return expandir();
    raiz.dataset.nav = 'contraida';
  };

  const alDesplazar = () => {
    contraer();
    clearTimeout(temporizador);
    temporizador = setTimeout(expandir, REPOSO_MS);
  };

  window.addEventListener('scroll', alDesplazar, { passive: true });
  // Si existe, adelanta la expansión al instante exacto en que para la inercia.
  if ('onscrollend' in window) {
    window.addEventListener('scrollend', expandir, { passive: true });
  }
  // Al cambiar de tamaño o de preferencia, volver a un estado coherente.
  movil.addEventListener?.('change', expandir);
  menos.addEventListener?.('change', expandir);

  return { expandir, contraer, hayScrollend: 'onscrollend' in window, REPOSO_MS };
}
