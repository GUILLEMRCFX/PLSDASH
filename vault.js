/**
 * PLSDASH — VaultEasterEgg
 *
 * La tarjeta del valor total es una tapa. Se arrastra hacia la derecha y
 * debajo aparece un candado de combinación de cuatro ruedas. La combinación
 * correcta lleva al Validator Dashboard con la sesión ya abierta.
 *
 * ## Quitarlo
 *
 * Borrar la etiqueta <script src="/vault.js"> de index.html. Este módulo no
 * toca nada del resto de la página: envuelve el hero al arrancar y todo lo
 * suyo vive dentro de ese envoltorio.
 *
 * ## La validación es del servidor
 *
 * El PIN no se comprueba aquí. Los cuatro dígitos van a `/api/val/auth`, el
 * mismo endpoint que usa el teclado de /val/, y el servidor decide. Este
 * archivo no sabe cuál es el PIN ni puede saberlo.
 *
 * ## Arrastre horizontal
 *
 * Hacia la derecha y no hacia abajo: la tarjeta está arriba del todo y el
 * gesto vertical es el de recargar en móvil. Aun así se exige mantener
 * pulsado antes de arrastrar, porque un scroll que empieza en diagonal no
 * debe abrir nada.
 */
(function () {
  'use strict';

  const CONFIG = {
    // Mismo endpoint que el teclado de /val/. No duplicar la lógica del PIN.
    endpoint: '/api/val/auth',
    destino: '/val/',
    // Si el panel se mueve a val.plsdash.com hay que cambiar `destino` y, sobre
    // todo, que la cookie de sesión salga con Domain=.plsdash.com; si no, no
    // viaja entre hostnames y el panel volverá a pedir el PIN.
    // Desplazamiento horizontal mínimo antes de responder. Al ir en el eje
    // contrario al scroll, el conflicto desaparece solo y no hace falta
    // pulsación mantenida: basta con no dispararlo con un roce.
    minArranque: 30,
    umbralAsoma: 70,       // px visuales: empieza a verse la oscuridad
    umbralAbierto: 140,    // px visuales: tope, CLACK, candado a la vista

    // 0,68 y no el 0,55 pedido: las cuatro ruedas necesitan unos 140px de
    // hueco, y con 0,55 abrir exigía 364px de arrastre — más ancho del que
    // tiene un móvil de 390px. A 0,68 el tope llega a los 247px, que sí cabe,
    // y la resistencia progresiva se mantiene: el ratio efectivo cae de 0,64
    // al principio a 0,48 al final, así que sigue costando más cuanto más
    // lejos. Se nota pesado sin volverse imposible.
    resistencia: 0.68,
  };

  const hero = document.querySelector('.hero');
  if (!hero || !window.PointerEvent) return;

  // ─────────────────────────────────────────────────────────── sonido
  //
  // Generado, sin archivos. El contexto se crea en el primer gesto para no
  // pelearse con las políticas de autoplay.
  let audio = null;
  function ctx() {
    if (audio === null) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { audio = false; }
    }
    return audio || null;
  }

  function clack(fuerza = 1) {
    const ac = ctx();
    if (!ac) return;
    const t = ac.currentTime;
    // Ruido corto y filtrado: un golpe seco de metal, no un tono.
    const n = ac.createBufferSource();
    const buf = ac.createBuffer(1, 512, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = buf;

    const filtro = ac.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = 2400;
    filtro.Q.value = 1.2;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.055 * fuerza, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    n.connect(filtro).connect(g).connect(ac.destination);
    n.start(t); n.stop(t + 0.06);
  }

  function clunk() {
    const ac = ctx();
    if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.22);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.075, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + 0.34);
    clack(0.7);
  }

  // ─────────────────────────────────────────────── estructura y estilos
  const css = document.createElement('style');
  css.textContent = `
.vault-caja{position:relative;margin-bottom:16px}
.vault-caja > .hero{
  margin-bottom:0;position:relative;z-index:2;will-change:transform;
  /* El navegador se queda el desplazamiento vertical y nosotros solo el
     horizontal, así que el scroll de la página nunca llega a disputarse.
     pinch-zoom va explícito para no perder el zoom con dos dedos. */
  touch-action:pan-y pinch-zoom;
}
.vault-cripta{
  position:absolute;inset:0;z-index:1;border-radius:24px;overflow:hidden;
  background:linear-gradient(150deg,#0a0710,#05040a 60%);
  box-shadow:inset 0 2px 14px rgba(0,0,0,.9),inset 0 0 60px rgba(0,0,0,.7);
  display:flex;align-items:center;justify-content:flex-start;
  padding-left:14px;opacity:0;pointer-events:none;
}
.vault-cripta.visible{opacity:1}
/* La oscuridad entra antes que el mecanismo: primero se intuye que hay algo. */
.vault-cripta{transition:opacity .18s ease-out}
.vault-cripta.activa{pointer-events:auto}
@media(max-width:560px){ .vault-cripta{padding-left:9px} }

/* ── el candado ── */
/* Escalado para caber en los 140px que deja la tapa al llegar al tope. */
/* Escalado para caber en los 140px que deja la tapa al llegar al tope, y
   desplazado por --vp: entra desde detrás del borde izquierdo a medida que la
   tapa se retira, como un mecanismo corredero. */
.candado{
  display:flex;align-items:center;transform-origin:left center;
  transform:translateX(calc((var(--vp,0) - 1) * 96px)) scale(.9);
}
@media(max-width:560px){
  .candado{transform:translateX(calc((var(--vp,0) - 1) * 88px)) scale(.82)}
}

.cuerpo{
  position:relative;padding:15px 11px 13px;border-radius:11px;
  background:linear-gradient(165deg,#3a3a42,#1c1c22 55%,#141419);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.16),
    inset 0 -2px 6px rgba(0,0,0,.75),
    0 10px 24px -8px rgba(0,0,0,.9);
  border:1px solid #0c0c11;
}
/* Textura discreta: un tramado fino que rompe el plano sin dibujarse. */
.cuerpo::after{
  content:"";position:absolute;inset:0;border-radius:12px;pointer-events:none;
  background:repeating-linear-gradient(92deg,rgba(255,255,255,.028) 0 1px,transparent 1px 3px);
  mix-blend-mode:overlay;
}
/* Marcas de uso: dos rozaduras asimétricas, apenas visibles. */
.cuerpo::before{
  content:"";position:absolute;inset:0;border-radius:12px;pointer-events:none;
  background:
    linear-gradient(118deg,transparent 28%,rgba(255,255,255,.05) 29%,transparent 30%),
    linear-gradient(74deg,transparent 61%,rgba(0,0,0,.4) 62%,transparent 63%);
}

.arco{
  position:absolute;left:50%;transform:translateX(-50%);top:-26px;
  width:52px;height:34px;z-index:-1;transition:none;
}

.ruedas{display:flex;gap:4px;position:relative}
.rueda{
  position:relative;width:28px;height:60px;border-radius:5px;overflow:hidden;
  background:linear-gradient(180deg,#0b0b0f,#232329 22%,#33333c 50%,#232329 78%,#0b0b0f);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.85),inset 0 0 10px rgba(0,0,0,.7);
  cursor:ns-resize;touch-action:none;
}
@media(max-width:560px){ .rueda{width:26px;height:54px} }
/* El cilindro se curva: oscuro arriba y abajo, claro en el centro. */
.rueda::after{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(180deg,rgba(0,0,0,.92),rgba(0,0,0,0) 34%,rgba(0,0,0,0) 66%,rgba(0,0,0,.92));
}
.rueda-tira{
  position:absolute;left:0;right:0;top:0;
  display:flex;flex-direction:column;align-items:center;will-change:transform;
}
.rueda-tira span{
  height:22px;line-height:22px;font-family:'JetBrains Mono',ui-monospace,monospace;
  font-size:15px;font-weight:500;color:#c9c9d4;text-shadow:0 1px 0 rgba(0,0,0,.9);
}
@media(max-width:560px){ .rueda-tira span{height:20px;line-height:20px;font-size:14px} }

/* Línea de lectura: por donde se lee la combinación. */
.lectura{
  position:absolute;left:-4px;right:-4px;top:50%;height:22px;transform:translateY(-50%);
  pointer-events:none;border-top:1px solid rgba(255,255,255,.14);
  border-bottom:1px solid rgba(0,0,0,.85);
  background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.01));
}
@media(max-width:560px){ .lectura{height:20px} }

.vault-caja.temblor > .hero{animation:vault-temblor .4s}
@keyframes vault-temblor{
  0%,100%{transform:translateX(var(--vx,0))}
  25%{transform:translateX(calc(var(--vx,0) - 3px))}
  75%{transform:translateX(calc(var(--vx,0) + 3px))}
}
.candado.error{animation:vault-error .38s}
@keyframes vault-error{
  0%,100%{transform:scale(var(--vs,.92)) translateX(0)}
  20%{transform:scale(var(--vs,.92)) translateX(-4px)}
  60%{transform:scale(var(--vs,.92)) translateX(4px)}
}
@media(prefers-reduced-motion:reduce){
  .vault-caja.temblor > .hero,.candado.error{animation:none}
}`;
  document.head.appendChild(css);

  // Envolver el hero sin tocar el HTML de la página.
  const caja = document.createElement('div');
  caja.className = 'vault-caja';
  hero.parentNode.insertBefore(caja, hero);

  const cripta = document.createElement('div');
  cripta.className = 'vault-cripta';
  cripta.innerHTML = `
    <div class="candado" aria-hidden="true">
      <div class="cuerpo">
        <svg class="arco" viewBox="0 0 52 34" fill="none">
          <path d="M8 34V17a18 18 0 0 1 36 0v17" stroke="url(#vg)" stroke-width="7" stroke-linecap="round"/>
          <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="34">
            <stop offset="0" stop-color="#6e6e7a"/><stop offset=".5" stop-color="#3d3d47"/>
            <stop offset="1" stop-color="#232329"/>
          </linearGradient></defs>
        </svg>
        <div class="ruedas"></div>
        <div class="lectura"></div>
      </div>
    </div>`;
  caja.appendChild(cripta);
  caja.appendChild(hero);

  const candado = cripta.querySelector('.candado');
  const arco = cripta.querySelector('.arco');
  const contenedorRuedas = cripta.querySelector('.ruedas');

  // ───────────────────────────────────────────────────── las ruedas
  const ALTO_DIGITO = window.matchMedia('(max-width:560px)').matches ? 20 : 22;
  const REPETICIONES = 7;           // tira larga para poder girar sin saltos
  const ruedas = [];

  for (let r = 0; r < 4; r++) {
    const rueda = document.createElement('div');
    rueda.className = 'rueda';
    const tira = document.createElement('div');
    tira.className = 'rueda-tira';
    for (let i = 0; i < 10 * REPETICIONES; i++) {
      const s = document.createElement('span');
      s.textContent = String(i % 10);
      tira.appendChild(s);
    }
    rueda.appendChild(tira);
    contenedorRuedas.appendChild(rueda);

    const estado = {
      el: rueda, tira,
      pos: 10 * ALTO_DIGITO * Math.floor(REPETICIONES / 2), // centro de la tira
      vel: 0, arrastrando: false, ultimoDigito: 0, anim: null,
    };
    ruedas.push(estado);
    pintarRueda(estado);
    engancharRueda(estado);
  }

  function digitoDe(e) {
    const idx = Math.round(e.pos / ALTO_DIGITO);
    return ((idx % 10) + 10) % 10;
  }

  function pintarRueda(e) {
    // El número seleccionado queda centrado en la ventana de lectura.
    const centro = e.el.clientHeight / 2 - ALTO_DIGITO / 2;
    e.tira.style.transform = `translateY(${centro - e.pos}px)`;

    const d = digitoDe(e);
    if (d !== e.ultimoDigito) { e.ultimoDigito = d; clack(0.85); }
  }

  /**
   * Física: velocidad con rozamiento, y al frenar un tirón hacia el número
   * más cercano con algo de rebote. No una transición plana de 5 a 6.
   */
  function girar(e) {
    if (e.anim) return;
    const paso = () => {
      e.anim = null;
      if (e.arrastrando) return;

      if (Math.abs(e.vel) > 0.4) {
        e.pos += e.vel;
        e.vel *= 0.94;                       // rozamiento
      } else {
        const destino = Math.round(e.pos / ALTO_DIGITO) * ALTO_DIGITO;
        const dist = destino - e.pos;
        if (Math.abs(dist) < 0.35 && Math.abs(e.vel) < 0.35) {
          e.pos = destino; e.vel = 0;
          pintarRueda(e);
          // Se comprueba al asentar, no al soltar: al soltar esta animación
          // acaba de empezar y la comprobación se encontraría la rueda en
          // movimiento y se marcharía sin intentar nada.
          comprobar();
          return;                            // encajada
        }
        // Muelle: acelera hacia el diente y se pasa un poco antes de asentar.
        e.vel += dist * 0.22;
        e.vel *= 0.62;
        e.pos += e.vel;
      }
      pintarRueda(e);
      e.anim = requestAnimationFrame(paso);
    };
    e.anim = requestAnimationFrame(paso);
  }

  function engancharRueda(e) {
    let ultimaY = 0, ultimoT = 0;

    e.el.addEventListener('pointerdown', ev => {
      if (!cripta.classList.contains('activa')) return;
      ev.preventDefault();
      e.el.setPointerCapture(ev.pointerId);
      e.arrastrando = true;
      e.vel = 0;
      ultimaY = ev.clientY;
      ultimoT = performance.now();
      if (e.anim) { cancelAnimationFrame(e.anim); e.anim = null; }
    });

    e.el.addEventListener('pointermove', ev => {
      if (!e.arrastrando) return;
      const dy = ev.clientY - ultimaY;
      const dt = Math.max(1, performance.now() - ultimoT);
      e.pos -= dy;
      e.vel = -dy * (16 / dt);               // px por fotograma
      ultimaY = ev.clientY;
      ultimoT = performance.now();
      pintarRueda(e);
    });

    const soltar = ev => {
      if (!e.arrastrando) return;
      e.arrastrando = false;
      try { e.el.releasePointerCapture(ev.pointerId); } catch {}
      e.vel = Math.max(-38, Math.min(38, e.vel));
      girar(e);
    };
    e.el.addEventListener('pointerup', soltar);
    e.el.addEventListener('pointercancel', soltar);

    // La rueda del ratón mueve un dígito, para no depender solo del arrastre.
    e.el.addEventListener('wheel', ev => {
      if (!cripta.classList.contains('activa')) return;
      ev.preventDefault();
      e.pos += Math.sign(ev.deltaY) * ALTO_DIGITO;
      pintarRueda(e);
      comprobar();
    }, { passive: false });
  }

  // ────────────────────────────────────────── arrastre de la tapa
  let px = 0;                 // desplazamiento visual actual
  let arrastrando = false, descartado = false, inicioX = 0, inicioY = 0;
  let abierto = false, comprobando = false;

  function moverTapa(v) {
    px = v;
    hero.style.setProperty('--vx', v + 'px');
    hero.style.transform = `translateX(${v}px)`;

    // Cuánto se ha abierto, de 0 a 1. El candado va enganchado a esto: sale
    // de detrás del borde izquierdo a un ritmo algo distinto al de la tapa,
    // y ese desfase es lo que hace que parezca que estaba ahí debajo.
    const progreso = Math.min(1, v / CONFIG.umbralAbierto);
    cripta.style.setProperty('--vp', progreso.toFixed(3));

    cripta.classList.toggle('visible', v > 12);
    const listo = v >= CONFIG.umbralAbierto - 2;
    cripta.classList.toggle('activa', listo);
  }

  function cerrarTapa() {
    abierto = false;
    cripta.classList.remove('activa');
    const animar = () => {
      px *= 0.82;
      if (px < 0.5) { moverTapa(0); hero.style.transform = ''; return; }
      moverTapa(px);
      requestAnimationFrame(animar);
    };
    animar();
  }

  hero.addEventListener('pointerdown', ev => {
    if (abierto || ev.target.closest('.vault-cripta')) return;
    inicioX = ev.clientX; inicioY = ev.clientY;
    descartado = false;
    ctx();                                   // el contexto de audio nace aquí
  });

  hero.addEventListener('pointermove', ev => {
    if (abierto || descartado) return;
    const dx = ev.clientX - inicioX;
    const dy = ev.clientY - inicioY;

    if (!arrastrando) {
      // Bloqueo de eje: si el gesto se declara vertical antes de recorrer lo
      // suficiente en horizontal, es un scroll y no se vuelve a mirar hasta
      // que se levante el dedo. `touch-action: pan-y` ya deja ese scroll en
      // manos del navegador, así que ni siquiera llegan más eventos.
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { descartado = true; return; }
      // Solo hacia la derecha, y solo pasado el mínimo: un roce no abre nada.
      if (dx < CONFIG.minArranque) return;
      arrastrando = true;
      try { hero.setPointerCapture(ev.pointerId); } catch {}
    }

    // Resistencia creciente: cuanto más lejos, más cuesta. Sacar una pieza
    // pesada de su ranura, no deslizar una tarjeta. Se descuenta el mínimo de
    // arranque para que el movimiento empiece desde cero y no dé un salto.
    const bruto = Math.max(0, dx - CONFIG.minArranque);
    const suave = bruto * CONFIG.resistencia * (1 - Math.min(0.3, bruto / 1500));
    const tope = CONFIG.umbralAbierto;

    if (suave >= tope && !abierto) {
      moverTapa(tope);
      abierto = true;
      clack(1);                              // CLACK: la tapa toca el tope
      return;
    }
    moverTapa(Math.min(suave, tope));
  });

  const finTapa = ev => {
    descartado = false;
    if (!arrastrando) return;
    arrastrando = false;
    try { hero.releasePointerCapture(ev.pointerId); } catch {}
    // Sin llegar al tope, la tapa vuelve a su sitio.
    if (!abierto) cerrarTapa();
  };
  hero.addEventListener('pointerup', finTapa);
  hero.addEventListener('pointercancel', finTapa);

  // Tocar fuera cierra la tapa.
  document.addEventListener('pointerdown', ev => {
    if (abierto && !caja.contains(ev.target)) cerrarTapa();
  });

  // ──────────────────────────────────────────────── validación
  async function comprobar() {
    if (comprobando || !abierto) return;
    // Solo se intenta cuando las cuatro ruedas están quietas y encajadas.
    if (ruedas.some(r => r.arrastrando || r.anim)) return;

    const pin = ruedas.map(digitoDe).join('');
    comprobando = true;

    // El mecanismo cede: el arco se tensa mientras el servidor responde.
    arco.style.transition = 'transform .18s ease-out';
    arco.style.transform = 'translateX(-50%) translateY(-2px)';

    let ok = false;
    try {
      const res = await fetch(CONFIG.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      ok = res.ok;
    } catch { ok = false; }

    if (ok) abrir(); else rechazar();
    comprobando = false;
  }

  function abrir() {
    clunk();
    arco.style.transition = 'transform .55s cubic-bezier(.34,1.26,.64,1)';
    arco.style.transform = 'translateX(-50%) translateY(-19px)';

    // La tapa acusa el golpe: se mueve un poco más.
    setTimeout(() => { moverTapa(CONFIG.umbralAbierto + 10); }, 90);

    // Glitch mínimo, un parpadeo y ya. Nada de celebración.
    setTimeout(() => {
      document.documentElement.style.transition = 'opacity .12s';
      document.documentElement.style.opacity = '.88';
    }, 380);

    setTimeout(() => { window.location.href = CONFIG.destino; }, 620);
  }

  function rechazar() {
    // Como un candado de verdad: el arco lo intenta, no cede, y se queda.
    arco.style.transition = 'transform .1s';
    arco.style.transform = 'translateX(-50%) translateY(-4px)';
    clack(1);
    setTimeout(() => {
      arco.style.transform = 'translateX(-50%)';
      clack(1);
      candado.classList.add('error');
      caja.classList.add('temblor');
    }, 130);
    setTimeout(() => {
      candado.classList.remove('error');
      caja.classList.remove('temblor');
      hero.style.transform = `translateX(${px}px)`;
    }, 560);
    // Ni mensaje ni pista. Las ruedas se quedan donde están.
  }
})();
