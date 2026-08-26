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

/**
 * El panel es SOLO su cabecera: el rótulo «Tema» y, a la derecha, el nombre del
 * que está puesto, que despliega los cinco. Antes era una fila de botones con
 * tres cuadraditos de color cada uno, y ocupaba una tarjeta entera para algo que
 * se toca una vez al mes.
 *
 * Cada nombre va escrito en el color de SU tema, que es lo que sustituye a las
 * muestras: el nombre es la muestra. Por qué no es un `<select>`, en el CSS.
 */
export function panelTema() {
  const actual = temaGuardado();
  const puesto = TEMAS.find(t => t.id === actual) || TEMAS[0];

  const opciones = TEMAS.map(t => `
    <button type="button" class="tm-op" role="menuitemradio"
            data-tema="${t.id}" aria-checked="${t.id === actual}"
            title="${t.nombre} · ${t.pista}">${t.nombre}</button>`).join('');

  return `
    <section class="panel tema" aria-labelledby="ptm-t">
      <header class="p-cab">
        <h2 id="ptm-t">${TITULO}</h2>
        <div class="tm">
          <button type="button" class="tm-abrir" id="tmAbrir"
                  aria-expanded="false" aria-haspopup="true"
                  aria-label="Tema de color: ${puesto.nombre}. Cambiar">${puesto.nombre}</button>
          <div class="tm-lista" id="tmLista" role="menu" aria-labelledby="tmAbrir" hidden>
            ${opciones}
          </div>
        </div>
      </header>
    </section>`;
}

export function engancharTema(raiz, repintar) {
  const abrir = raiz.querySelector('#tmAbrir');
  const lista = raiz.querySelector('#tmLista');
  if (!abrir || !lista) return;

  const cerrar = () => {
    lista.hidden = true;
    abrir.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', alTocarFuera, true);
    document.removeEventListener('keydown', alTeclear, true);
  };
  /* ⚠ En captura y en el listener de fuera: el HTML del panel se REGENERA entero
     cada 18 segundos, así que este nodo puede haber dejado de estar en el
     documento cuando el evento llega. Sin comprobarlo, el desplegable de un
     repintado anterior seguía capturando los clics del nuevo. */
  function alTocarFuera(ev) {
    if (!abrir.isConnected) return cerrar();
    if (!lista.contains(ev.target) && ev.target !== abrir) cerrar();
  }
  function alTeclear(ev) {
    if (ev.key === 'Escape') { cerrar(); abrir.focus(); }
  }

  abrir.addEventListener('click', () => {
    if (!lista.hidden) return cerrar();

    lista.hidden = false;
    abrir.setAttribute('aria-expanded', 'true');

    /* ⚠ Y AHORA, HACIA DÓNDE. El panel del tema es el último de su columna, así
       que en un móvil está al final del recorrido: desplegando siempre hacia
       abajo, los últimos nombres caen fuera de la ventana. Medido a 390×844,
       «Papel» quedaba justo pegado al borde y con menos alto se salía.
       Se mide DESPUÉS de mostrarla —oculta no tiene altura— y se voltea solo si
       de verdad no cabe: hacia arriba por sistema sería peor en escritorio. */
    lista.classList.remove('arriba');
    const caja = lista.getBoundingClientRect();
    const debajo = window.innerHeight - abrir.getBoundingClientRect().bottom;
    if (caja.height + 16 > debajo) lista.classList.add('arriba');

    document.addEventListener('pointerdown', alTocarFuera, true);
    document.addEventListener('keydown', alTeclear, true);
    lista.querySelector('.tm-op[aria-checked="true"]')?.focus();
  });

  lista.querySelectorAll('.tm-op').forEach(b => {
    b.addEventListener('click', () => {
      aplicarTema(b.dataset.tema);
      cerrar();
      // Repintar para que el nombre del disparador y la marca se pongan al día.
      // El color en sí ya ha cambiado: lo hace el CSS con el atributo del <html>.
      repintar();
    });
  });
}
