/**
 * Que el pellizco no amplíe la página. Solo en el panel.
 *
 * ## El problema
 *
 * El panel está maquetado para 390 px. Al ampliar con pellizco, el contenido se
 * sale por los dos lados: los importes quedan cortados a izquierda y derecha y
 * hay que arrastrar para leer un número. No es un zoom útil, es una manera de
 * romper la maqueta.
 *
 * ## Por qué el `<meta viewport>` no basta
 *
 * ⚠ **Safari en iOS IGNORA `user-scalable=no` y `maximum-scale` desde iOS 10**,
 *   a propósito, por accesibilidad. En la app instalada desde la pantalla de
 *   inicio SÍ los respeta. O sea que el meta solo cubre la mitad de los casos,
 *   y justo la mitad que no da problemas.
 *
 * Por eso hacen falta tres capas, cada una tapando lo que la anterior no llega:
 *
 *   1. `touch-action: pan-x pan-y` en la raíz — la vía estándar. Deja
 *      desplazar y prohíbe el pellizco y el doble toque para los gestos que
 *      empiezan ahí. Está en `index.html`, no aquí.
 *   2. `gesturestart` / `gesturechange` / `gestureend` — eventos **no estándar
 *      de WebKit**, o sea exactamente el motor al que apuntamos. Ésta es la
 *      capa que de verdad bloquea el pellizco en Safari como navegador.
 *   3. `maximum-scale=1, user-scalable=no` en el meta — sale gratis y es lo
 *      que cubre la app instalada. También en `index.html`.
 *
 * ## Por qué la esfera no se rompe
 *
 * ⚠ **La esfera usa Pointer Events**, no `gesture*` ni `touch*`: su pellizco
 *   vive en `pointerdown`/`pointermove`, midiendo la distancia entre dos
 *   punteros (ver `escena/esfera.js`, `pellizcoPrevio`). Cancelar los eventos
 *   `gesture*` no toca los Pointer Events en absoluto.
 *
 *   Y `#escena` ya lleva `touch-action: none`, que es MÁS restrictivo que el
 *   `pan-x pan-y` de la raíz. `touch-action` solo estrecha hacia abajo en el
 *   árbol, nunca ensancha, así que el lienzo se queda exactamente como estaba.
 *
 * ## Lo que esto quita, y lo que deja
 *
 * Quita el pellizco de página, que es una ayuda de accesibilidad que Apple
 * protege a propósito. Queda la salida buena: **el zoom del sistema** —Ajustes
 * → Accesibilidad → Zoom, triple toque con tres dedos— es del sistema
 * operativo, no de la página, y sigue funcionando igual.
 */

/** Los eventos de pellizco de WebKit. No existen en los demás motores. */
const GESTOS = ['gesturestart', 'gesturechange', 'gestureend'];

/**
 * Cancela el zoom de página. Devuelve una función para deshacerlo.
 *
 * @param {EventTarget} raiz  normalmente `document`. Parametrizado para poder
 *   probarlo sobre un nodo suelto sin ensuciar el documento.
 */
export function bloquearZoomDePagina(raiz = document) {
  const cancelar = ev => ev.preventDefault();

  for (const tipo of GESTOS) {
    // `passive: false` es obligatorio: sin él el navegador da por hecho que no
    // se va a cancelar nada y `preventDefault()` no hace absolutamente nada.
    raiz.addEventListener(tipo, cancelar, { passive: false });
  }

  /* El pellizco de un trackpad llega como `wheel` con `ctrlKey`. No es el caso
     que pediste —esto es del iPhone— pero es el mismo gesto y rompe lo mismo.

     No se hace excepción con el lienzo de la esfera a propósito: su propio
     manejador de `wheel` ya llama a `preventDefault()` y corre ANTES que éste
     —está en el elemento, no en el documento—, así que allí esto no llega a
     decidir nada. Una excepción escrita a mano sería una regla más que
     mantener a cambio de nada. */
  const rueda = ev => { if (ev.ctrlKey) ev.preventDefault(); };
  raiz.addEventListener('wheel', rueda, { passive: false });

  return () => {
    for (const tipo of GESTOS) raiz.removeEventListener(tipo, cancelar);
    raiz.removeEventListener('wheel', rueda);
  };
}
