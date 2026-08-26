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

/* ─────────────────────────────────────────────── el selector

   Vive en la BARRA DE PESTAÑAS, a la derecha de «Esfera», y no dentro de una
   pestaña: el tema se cambia desde cualquier sitio. Antes era un panel al final
   de Nodo, o sea que para cambiar de tema había que ir primero a Nodo.

   ⚠ SE MONTA UNA SOLA VEZ, y no es una optimización: los paneles regeneran su
     HTML entero cada 18 segundos, y el engranaje vive fuera de ese ciclo a
     propósito. Colgándolo del repintado, el desplegable se cerraría solo cada
     18 segundos en mitad de elegir. Por eso al elegir un tema NO se repinta: se
     actualizan en su sitio el rótulo del disparador y las marcas.

   Cada nombre va escrito en el color de SU tema: el nombre es la muestra. Por
   qué no es un «select» nativo, en el CSS. */

const ENGRANAJE = [
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"',
  '     stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">',
  '  <circle cx="12" cy="12" r="3.1"/>',
  '  <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34',
  '           1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34',
  '           l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2',
  '           0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83',
  '           l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0',
  '           15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9',
  '           a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"/>',
  '</svg>',
].join('\n');

const rotulo = t => `Tema de color: ${t.nombre}. Cambiar`;

/**
 * Pinta el engranaje y su desplegable dentro de `caja` y lo deja funcionando.
 * Se llama UNA VEZ en el arranque. Devuelve false si no hay dónde montarlo.
 */
export function montarTema(caja) {
  if (!caja) return false;
  const actual = temaGuardado();
  const puesto = TEMAS.find(t => t.id === actual) || TEMAS[0];

  const opciones = TEMAS.map(t => `
      <button type="button" class="tm-op" role="menuitemradio"
              data-tema="${t.id}" aria-checked="${t.id === actual}"
              title="${t.nombre} · ${t.pista}">${t.nombre}</button>`).join('');

  caja.innerHTML = `
    <button type="button" class="tm-abrir" id="tmAbrir"
            aria-expanded="false" aria-haspopup="true"
            aria-label="${rotulo(puesto)}">${ENGRANAJE}</button>
    <div class="tm-lista" id="tmLista" role="menu" aria-labelledby="tmAbrir" hidden>
      ${opciones}
    </div>`;

  const abrir = caja.querySelector('#tmAbrir');
  const lista = caja.querySelector('#tmLista');

  const cerrar = () => {
    lista.hidden = true;
    abrir.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', alTocarFuera, true);
    document.removeEventListener('keydown', alTeclear, true);
  };
  function alTocarFuera(ev) {
    if (!lista.contains(ev.target) && !abrir.contains(ev.target)) cerrar();
  }
  function alTeclear(ev) {
    if (ev.key === 'Escape') { cerrar(); abrir.focus(); }
  }

  abrir.addEventListener('click', () => {
    if (!lista.hidden) return cerrar();

    lista.hidden = false;
    abrir.setAttribute('aria-expanded', 'true');

    /* ⚠ HACIA DÓNDE. Colgando de la barra siempre hay sitio debajo, así que hoy
       no voltea nunca — pero la medida se queda. Cuando esto colgaba del último
       panel de Nodo, a 390×844 el último nombre caía fuera de la ventana, y
       basta con que alguien vuelva a mover el disparador para que reaparezca.
       Se mide DESPUÉS de mostrarla: oculta no tiene altura. */
    lista.classList.remove('arriba');
    const alto = lista.getBoundingClientRect().height;
    const debajo = window.innerHeight - abrir.getBoundingClientRect().bottom;
    if (alto + 16 > debajo) lista.classList.add('arriba');

    document.addEventListener('pointerdown', alTocarFuera, true);
    document.addEventListener('keydown', alTeclear, true);
    lista.querySelector('.tm-op[aria-checked="true"]')?.focus();
  });

  lista.querySelectorAll('.tm-op').forEach(b => {
    b.addEventListener('click', () => {
      const id = aplicarTema(b.dataset.tema);
      // Al sitio, sin regenerar nada: ver el aviso de arriba.
      const t = TEMAS.find(x => x.id === id) || TEMAS[0];
      abrir.setAttribute('aria-label', rotulo(t));
      lista.querySelectorAll('.tm-op').forEach(o =>
        o.setAttribute('aria-checked', String(o.dataset.tema === id)));
      cerrar();
      abrir.focus();
    });
  });

  return true;
}
