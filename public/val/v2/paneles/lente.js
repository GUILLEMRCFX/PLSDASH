/**
 * La lente líquida de la barra inferior (29-oct-2026).
 *
 * En el móvil, el resalte de la pestaña activa deja de ser un fondo fijo y pasa
 * a ser una lente de cristal que se mueve con física de muelle: va de una
 * pestaña a otra estirándose según la velocidad, y si dejas el dedo en la barra
 * y lo arrastras, te sigue y agranda los iconos que tiene cerca. Al soltar se
 * encaja en la pestaña más cercana y la abre.
 *
 * ## Lo que NO es
 *
 * No es el Liquid Glass de Apple: ese deforma de verdad lo que hay debajo. En
 * la web la refracción real solo funciona en Chrome —no en Safari, que es donde
 * se usa el panel—, así que aquí es desenfoque, saturación y el aumento de los
 * iconos. Se dijo así antes de hacerlo.
 *
 * ## Lo que no se toca
 *
 * · La navegación sigue siendo la de siempre: tocar una pestaña dispara su
 *   `click` nativo y `activar()` hace el resto. Al arrastrar y soltar se llama
 *   al `click()` de la pestaña elegida: el mismo camino.
 * · La contracción al desplazar (`nav.js`) sigue igual. La lente mide las
 *   pestañas en cada fotograma mientras algo cambia de tamaño, así que encoge
 *   con la barra.
 * · En escritorio, y con movimiento reducido, no existe: la barra de arriba no
 *   es una píldora y allí el resalte de siempre basta.
 */

const RESORTE = 0.16;          // tirón hacia el objetivo, por fotograma a 60 fps
const AMORT_LIBRE = 0.74;      // amortiguación cuando va sola (con rebote)
const AMORT_DEDO = 0.58;       // con el dedo encima: sigue sin oscilar
const UMBRAL_ARRASTRE = 8;     // px hasta que un toque pasa a ser arrastre

export function engancharLente(raiz = document) {
  const pest = raiz.querySelector('.pestanas');
  if (!pest || !window.PointerEvent) return null;
  const movil = window.matchMedia('(max-width: 819px)');
  const menos = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tabs = [...pest.querySelectorAll('[role="tab"]')];
  const icono = t => t.querySelector('.pt-ico');

  const lente = document.createElement('span');
  lente.className = 'lente';
  lente.setAttribute('aria-hidden', 'true');
  pest.prepend(lente);

  let x = 0, v = 0, w = 0, objetivoX = 0, objetivoW = 0;
  let esc = 1, escV = 0;
  let pulsado = false, arrastrando = false, x0 = 0, dedo = null;
  let raf = 0, ult = 0, quieto = 0, colocada = false;

  const activa = () => Math.max(0, tabs.findIndex(t => t.getAttribute('aria-selected') === 'true'));
  const habilitada = () => movil.matches && !menos.matches;

  function medida(i) {
    const p = pest.getBoundingClientRect(), r = tabs[i].getBoundingClientRect();
    return { c: r.left - p.left + r.width / 2, w: r.width };
  }
  function bajoElDedo(px) {
    let mejor = 0, md = Infinity;
    tabs.forEach((t, i) => { const d = Math.abs(medida(i).c - px); if (d < md) { md = d; mejor = i; } });
    return mejor;
  }
  function apuntar() {
    const m = medida(activa());
    if (!pulsado) objetivoX = m.c;
    objetivoW = m.w;
    if (!colocada) { x = objetivoX; w = objetivoW; colocada = true; }
  }

  function pintar() {
    const sx = 1 + Math.min(Math.abs(v) * 0.022, 0.45);
    const sy = 1 - Math.min(Math.abs(v) * 0.008, 0.18);
    lente.style.width = `${w}px`;
    lente.style.transform =
      `translateX(${x - w / 2}px) translateY(${pulsado ? -2 : 0}px) scale(${sx * esc}, ${sy * esc})`;
    // Los iconos que la lente tiene cerca crecen y suben. Solo con el dedo
    // encima: en reposo la barra está quieta, como siempre.
    tabs.forEach((t, i) => {
      const ico = icono(t);
      if (!ico) return;
      const d = (medida(i).c - x) / 38;
      const k = pulsado ? Math.exp(-d * d) : 0;
      ico.style.transform = k > 0.01 ? `translateY(${-k * 4}px) scale(${1 + k * 0.28})` : '';
    });
  }

  function paso(ahora) {
    const f = Math.min(2, ((ahora - (ult || ahora)) / 16.7) || 1);
    ult = ahora;
    apuntar();
    v += (objetivoX - x) * RESORTE * f;
    v *= Math.pow(pulsado ? AMORT_DEDO : AMORT_LIBRE, f);
    x += v * f;
    w += (objetivoW - w) * 0.3 * f;
    escV += ((pulsado ? 1.12 : 1) - esc) * 0.25 * f;
    escV *= Math.pow(0.62, f);
    esc += escV * f;
    pintar();
    // Se duerme cuando lleva un rato quieta: una barra parada no gasta batería.
    const enReposo = !pulsado && Math.abs(v) < 0.02 && Math.abs(objetivoX - x) < 0.3
      && Math.abs(esc - 1) < 0.002 && Math.abs(objetivoW - w) < 0.3;
    quieto = enReposo ? quieto + 1 : 0;
    raf = quieto > 20 ? 0 : requestAnimationFrame(paso);
  }
  function despertar() {
    if (!habilitada()) return;
    quieto = 0;
    if (!raf) { ult = 0; raf = requestAnimationFrame(paso); }
  }

  function aplicarModo() {
    const si = habilitada();
    document.documentElement.toggleAttribute('data-lente', si);
    lente.hidden = !si;
    if (!si) tabs.forEach(t => { const i = icono(t); if (i) i.style.transform = ''; });
    colocada = false;
    despertar();
  }

  const local = ev => ev.clientX - pest.getBoundingClientRect().left;
  pest.addEventListener('pointerdown', ev => {
    if (!habilitada() || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    pulsado = true; arrastrando = false; dedo = ev.pointerId;
    x0 = ev.clientX; objetivoX = local(ev);
    despertar();
  });
  pest.addEventListener('pointermove', ev => {
    if (!pulsado || ev.pointerId !== dedo) return;
    if (!arrastrando && Math.abs(ev.clientX - x0) > UMBRAL_ARRASTRE) {
      arrastrando = true;
      // Solo al arrastrar se captura el puntero: un toque normal tiene que
      // acabar en el `click` nativo de su pestaña, y la captura lo impediría.
      try { pest.setPointerCapture(ev.pointerId); } catch {}
    }
    const p = pest.getBoundingClientRect();
    objetivoX = Math.max(20, Math.min(p.width - 20, local(ev)));
    despertar();
  });
  const soltar = ev => {
    if (!pulsado || ev.pointerId !== dedo) return;
    pulsado = false; dedo = null;
    if (arrastrando && ev.type === 'pointerup') tabs[bajoElDedo(local(ev))].click();
    arrastrando = false;
    try { pest.releasePointerCapture(ev.pointerId); } catch {}
    despertar();
  };
  pest.addEventListener('pointerup', soltar);
  pest.addEventListener('pointercancel', soltar);

  // Cambio de pestaña por cualquier camino: toque, teclado, hash.
  new MutationObserver(despertar).observe(pest, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
  // La contracción al desplazar cambia el tamaño de las pestañas.
  const ro = new ResizeObserver(despertar);
  tabs.forEach(t => ro.observe(t));
  movil.addEventListener?.('change', aplicarModo);
  menos.addEventListener?.('change', aplicarModo);
  aplicarModo();

  return { lente, estado: () => ({ x, objetivoX, w, pulsado, arrastrando, activa: activa(), habilitada: habilitada() }) };
}
