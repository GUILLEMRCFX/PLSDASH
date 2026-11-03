/**
 * PLSDASH — idiomas (3-nov-2026): español, inglés y francés.
 *
 * Un solo motor para la portada y el panel. Es un script CLÁSICO, sin
 * `export`, a propósito: la portada lo carga con un `<script src>` normal y el
 * panel lo importa por su efecto (`import '/i18n/idioma.js'`) a través de
 * `/val/v2/paneles/i18n.js`. Los dos ven el mismo `globalThis.plsI18n`.
 *
 * ## La clave es el texto en español
 *
 * `t('Sin barrer')` devuelve «Unswept» en inglés y «Sin barrer» en español. El
 * español es el idioma en el que se escribe el código y el de siempre, así que
 * una cadena que falte en un diccionario sale en español en vez de salir vacía
 * o como un identificador. Una prueba (`pruebas/idioma-test.mjs`) recorre el
 * código y exige que cada `t('…')` tenga su traducción en los dos idiomas.
 *
 * Las cifras se meten con marcas: `t('Faltan {n} días', { n: fmt(x) })`. El
 * valor ya va formateado: los números y las fechas NO cambian con el idioma
 * (decisión del propietario, 3-nov-2026).
 *
 * ## Qué idioma
 *
 * El elegido, guardado en `plsdash.idioma` —la misma clave para la portada y el
 * panel, que comparten dominio—. Si no se ha elegido nunca, español.
 */
(function () {
  'use strict';
  const IDIOMAS = ['es', 'en', 'fr'];
  const CLAVE = 'plsdash.idioma';
  const NOMBRES = { es: 'Español', en: 'English', fr: 'Français' };
  const dic = { en: Object.create(null), fr: Object.create(null) };
  const oyentes = new Set();

  /* Sin elección guardada, español: es el idioma de siempre de las dos webs.
     No se adivina por el navegador —decisión del 3-nov-2026—; quien quiera
     otro lo elige una vez y se recuerda. */
  function inicial() {
    if (!globalThis.document) return 'es';
    try {
      const g = localStorage.getItem(CLAVE);
      if (IDIOMAS.includes(g)) return g;
    } catch { /* sin almacenamiento: español */ }
    return 'es';
  }
  let actual = inicial();

  function sustituir(txt, vars) {
    if (!vars) return txt;
    return txt.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  /** El texto en el idioma actual. La clave es el texto en español. */
  function t(clave, vars) {
    const k = String(clave);
    const tr = actual === 'es' ? k : (dic[actual][k] ?? k);
    return sustituir(tr, vars);
  }

  /** Añade traducciones: `{ en: { 'Hola': 'Hello' }, fr: { … } }`. */
  function anadir(paquete) {
    for (const l of ['en', 'fr']) Object.assign(dic[l], paquete?.[l] || {});
  }

  function poner(idioma) {
    if (!IDIOMAS.includes(idioma) || idioma === actual) return;
    actual = idioma;
    try { localStorage.setItem(CLAVE, idioma); } catch { /* da igual */ }
    if (globalThis.document) {
      document.documentElement.lang = idioma;
      traducirDom(document);
    }
    oyentes.forEach(f => { try { f(idioma); } catch (e) { console.error(e); } });
  }

  /**
   * Lo que está escrito en el HTML y no lo repinta ningún código: se marca con
   * `data-i18n` (el texto) y `data-i18n-<atributo>` (aria-label, title,
   * placeholder…). El original en español se guarda la primera vez, así que
   * se puede ir y volver entre idiomas sin perderlo.
   */
  function traducirDom(raiz) {
    if (!raiz || !raiz.querySelectorAll) return;
    raiz.querySelectorAll('[data-i18n]').forEach(el => {
      if (el.dataset.i18nEs == null) el.dataset.i18nEs = el.dataset.i18n || el.innerHTML.trim();
      el.innerHTML = t(el.dataset.i18nEs);
    });
    for (const at of ['aria-label', 'title', 'placeholder']) {
      const sel = `[data-i18n-${at}]`;
      raiz.querySelectorAll(sel).forEach(el => {
        // La clave va en el propio atributo (`data-i18n-aria-label="Texto en
        // español"`); si está vacío, se toma el texto que hubiera la primera vez.
        const k = 'i18n' + at.replace(/(^|-)(\w)/g, (m, g, c) => c.toUpperCase()) + 'Es';
        if (el.dataset[k] == null) el.dataset[k] = el.getAttribute(`data-i18n-${at}`) || el.getAttribute(at) || '';
        el.setAttribute(at, t(el.dataset[k]));
      });
    }
  }

  /**
   * El botón: un `ES` que abre las tres opciones. Se usa en la portada y en el
   * panel; cada uno lo coloca donde le cabe y le da sus estilos.
   */
  function boton(clase = '') {
    const caja = document.createElement('div');
    caja.className = 'idioma ' + clase;
    const pintar = () => {
      caja.innerHTML = `<button type="button" class="id-btn" aria-haspopup="true" aria-expanded="false"
          aria-label="${t('Idioma')}: ${NOMBRES[actual]}">${actual.toUpperCase()}</button>
        <div class="id-menu" role="menu" hidden>${IDIOMAS.map(l =>
          `<button type="button" role="menuitemradio" aria-checked="${l === actual}" data-l="${l}" lang="${l}">
             <b>${l.toUpperCase()}</b>${NOMBRES[l]}</button>`).join('')}</div>`;
      const b = caja.querySelector('.id-btn'), m = caja.querySelector('.id-menu');
      const cerrar = () => { m.hidden = true; b.setAttribute('aria-expanded', 'false'); };
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        m.hidden = !m.hidden;
        b.setAttribute('aria-expanded', String(!m.hidden));
        if (!m.hidden) m.querySelector('[aria-checked="true"]')?.focus();
      });
      m.addEventListener('click', ev => {
        const o = ev.target.closest('[data-l]');
        if (!o) return;
        cerrar();
        poner(o.dataset.l);
      });
    };
    // Una sola vez, fuera de `pintar`: se repinta en cada cambio de idioma.
    document.addEventListener('click', ev => {
      if (caja.contains(ev.target)) return;
      const m = caja.querySelector('.id-menu');
      if (m && !m.hidden) { m.hidden = true; caja.querySelector('.id-btn')?.setAttribute('aria-expanded', 'false'); }
    });
    caja.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      const m = caja.querySelector('.id-menu');
      if (m) m.hidden = true;
      caja.querySelector('.id-btn')?.focus();
    });
    pintar();
    oyentes.add(pintar);
    return caja;
  }

  if (globalThis.document) document.documentElement.lang = actual;

  globalThis.plsI18n = {
    IDIOMAS, NOMBRES, t, anadir, poner, traducirDom, boton,
    get idioma() { return actual; },
    alCambiar(f) { oyentes.add(f); return () => oyentes.delete(f); },
    /** Solo para las pruebas. */
    _poner(l) { actual = l; },
    _dic: dic,
  };
})();
