/**
 * El tema del panel.
 *
 * Un tema es un juego de cinco colores declarado en `estilo.css` como un bloque
 * `:root[data-tema="…"]`. Aquí solo se decide CUÁL está puesto y se recuerda.
 * Ninguna regla de estilo vive en este fichero: si un día hay un sexto tema, se
 * añade allí y aquí solo su nombre.
 *
 * ## Cómo se guarda
 *
 * En `localStorage`, igual que la unidad del titular y que las wallets de la
 * portada. Es una preferencia de este dispositivo y no tiene por qué viajar: el
 * panel lo abre una persona en dos o tres aparatos, y que el móvil pueda ir en
 * «Papel» —que es el que se lee al sol— mientras el escritorio va en «Núcleo»
 * es una ventaja, no un fallo de sincronización.
 *
 * ## El tema se aplica ANTES de pintar nada
 *
 * `aplicarGuardado()` se llama en la cabecera del documento, no al montar los
 * paneles. Si esperara al primer pintado, el panel arrancaría en cian y saltaría
 * al tema elegido a los pocos cientos de milisegundos — un parpadeo de color en
 * cada carga.
 */

const CLAVE = 'plsdash:tema';

/**
 * Los cinco. El orden es el del selector, y va de más frío a más cálido para
 * que la fila de muestras se lea como una escala y no como un montón.
 */
export const TEMAS = [
  { id: 'nucleo', nombre: 'Núcleo', pista: 'cian y naranja' },
  { id: 'menta',  nombre: 'Menta',  pista: 'frío y bajo en saturación' },
  { id: 'pulso',  nombre: 'Pulso',  pista: 'el rosa de la portada' },
  { id: 'ambar',  nombre: 'Ámbar',  pista: 'cálido' },
  { id: 'papel',  nombre: 'Papel',  pista: 'casi sin color' },
];

const ID_VALIDOS = new Set(TEMAS.map(t => t.id));
export const POR_OMISION = 'nucleo';

/** El tema guardado, o el de omisión si no hay o no vale. */
export function temaGuardado() {
  try {
    const v = localStorage.getItem(CLAVE);
    return ID_VALIDOS.has(v) ? v : POR_OMISION;
  } catch {
    // Modo privado o almacenamiento bloqueado: se va al de omisión y ya está.
    return POR_OMISION;
  }
}

/** Pone el tema y lo recuerda. */
export function aplicarTema(id) {
  const t = ID_VALIDOS.has(id) ? id : POR_OMISION;
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem(CLAVE, t); } catch { /* no poder recordarlo no impide usarlo */ }
  // La esfera no lee CSS: hay que decírselo. Ver `escena/esfera.js`.
  window.dispatchEvent(new CustomEvent('plsdash:tema', { detail: { tema: t } }));
  return t;
}

/** Aplica el guardado sin escribir nada. Se llama en el arranque. */
export function aplicarGuardado() {
  document.documentElement.dataset.tema = temaGuardado();
}

/* ─────────────────────────────────────────────── el selector */

export const TITULO = 'Tema';

export function panelTema() {
  const actual = temaGuardado();
  const muestras = TEMAS.map(t => `
    <button type="button" class="tm-op${t.id === actual ? ' puesto' : ''}"
            data-tema="${t.id}" aria-pressed="${t.id === actual}"
            title="${t.nombre} · ${t.pista}">
      <!-- La muestra enseña los TRES colores que de verdad cambian de sitio a
           sitio: el dato, el acento y el «va bien». Un solo cuadrado de color
           no dice cómo va a quedar el panel. -->
      <span class="tm-muestra" data-de="${t.id}" aria-hidden="true">
        <i class="tm-c1"></i><i class="tm-c2"></i><i class="tm-c3"></i>
      </span>
      <span class="tm-nombre">${t.nombre}</span>
    </button>`).join('');

  return `
    <section class="panel" aria-labelledby="ptm-t">
      <header class="p-cab"><h2 id="ptm-t">${TITULO}</h2></header>
      <div class="tm-fila" role="group" aria-label="Tema de color del panel">
        ${muestras}
      </div>
      <p class="c-sub">Se guarda en este dispositivo. Los cinco pasan el contraste
        mínimo de texto pequeño; la comprobación los mide de una pasada.</p>
    </section>`;
}

export function engancharTema(raiz, repintar) {
  raiz.querySelectorAll('.tm-op').forEach(b => {
    b.addEventListener('click', () => {
      aplicarTema(b.dataset.tema);
      // Repintar para que las marcas de «puesto» se pongan al día. El color
      // en sí ya ha cambiado: lo hace el CSS con el atributo del `<html>`.
      repintar();
    });
  });
}
