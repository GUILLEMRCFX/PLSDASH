/**
 * PLSDASH — VaultEasterEgg
 *
 * La tarjeta del valor total es una puerta. Se arrastra hacia la derecha y
 * debajo aparece una CERRADURA: un dial que gira con el arrastre, con cuatro
 * muescas —tantas como cifras tiene el PIN que viene después— que se encienden
 * al pasar. Con la cuarta, el dial se abre en dos, la esfera de dentro se
 * enciende, fogonazo y salto a /val/.
 *
 * Hasta el 29-oct-2026 era una nube de partículas que se cargaba. Se eligió la
 * cerradura en el taller de prototipos: anuncia lo que hay detrás.
 *
 * ## No autentica
 *
 * Este módulo ya no pide ni comprueba el PIN, y no habla con
 * `/api/val/auth`. Solo navega. Quien pide el PIN es el dial de /val/, que
 * no se toca — y por eso la regla `val-auth-brute-force` de Cloudflare
 * sigue cubriendo el único sitio por donde se entra.
 *
 * ## Quitarlo
 *
 * Borrar la etiqueta <script src="/vault.js"> de index.html. Este módulo no
 * toca nada del resto de la página: envuelve el hero al arrancar y todo lo
 * suyo vive dentro de ese envoltorio.
 *
 * ## Arrastre horizontal
 *
 * Hacia la derecha y no hacia abajo: la tarjeta está arriba del todo y el
 * gesto vertical es el de recargar en móvil. `touch-action: pan-y pinch-zoom`
 * le deja el eje vertical al navegador, así que los dos gestos no se disputan.
 */
(function () {
  'use strict';

  const CONFIG = {
    destino: '/val/',

    // Si el panel se mueve a val.plsdash.com hay que cambiar `destino` a la
    // URL absoluta del subdominio: con VAL_HOST definido, `plsdash.com/val/`
    // devuelve 404 y el gesto llevaría a una página en blanco. Ya no hace
    // falta nada de cookies aquí — este módulo no abre sesión.

    // Zona muerta antes de responder. Se descuenta del recorrido, así que la
    // tarjeta arranca desde cero y no da un salto al engancharse.
    zonaMuerta: 30,

    // Recorrido completo. Al llegar aquí se dispara el fogonazo; soltando
    // antes, la tarjeta vuelve a su sitio y no pasa nada.
    recorrido: 244,

    msFogonazo: 300,
    // Lo que tarda el dial en abrirse antes del fogonazo. Corto: el gesto ya
    // está hecho y lo que queda es entrar.
    msAbrir: 380,
  };

  const hero = document.querySelector('.hero');
  if (!hero || !window.PointerEvent) return;

  const reduccion = window.matchMedia('(prefers-reduced-motion:reduce)');

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
  pointer-events:none;
}
.vault-cripta canvas{display:block;width:100%;height:100%;pointer-events:none}
.vault-fogonazo{
  position:fixed;inset:0;z-index:9999;background:#fff;opacity:0;
  pointer-events:none;transition:opacity .13s linear;
}
.vault-fogonazo.on{opacity:1}`;
  document.head.appendChild(css);

  // Envolver el hero sin tocar el HTML de la página.
  const caja = document.createElement('div');
  caja.className = 'vault-caja';
  hero.parentNode.insertBefore(caja, hero);

  const cripta = document.createElement('div');
  cripta.className = 'vault-cripta';
  const lienzo = document.createElement('canvas');
  cripta.appendChild(lienzo);
  caja.appendChild(cripta);
  caja.appendChild(hero);

  const ctx = lienzo.getContext('2d');

  // ─────────────────────────────────────────────────── las partículas
  //
  // El prototipo usa 420 sobre un lienzo de densidad ×2. Es una web pública
  // y hay iPhones viejos: en pantalla estrecha, o con una densidad que
  // multiplica los píxeles a pintar, se bajan.
  function cuantasParticulas() {
    const ancho = window.innerWidth;
    const dpr = window.devicePixelRatio || 1;
    let n = ancho < 560 ? 240 : 420;
    if (dpr >= 3) n = Math.round(n * 0.65);
    else if (dpr > 2) n = Math.round(n * 0.8);
    return Math.max(120, n);
  }

  let N = 0, pts = [];
  function sembrar() {
    N = cuantasParticulas();
    pts = [];
    // Espiral de Fibonacci: reparto uniforme sobre la esfera sin agrupaciones.
    for (let i = 0; i < N; i++) {
      const t = Math.acos(1 - 2 * (i + 0.5) / N);
      const ph = Math.PI * (1 + Math.sqrt(5)) * i;
      pts.push({
        x: Math.sin(t) * Math.cos(ph),
        y: Math.sin(t) * Math.sin(ph),
        z: Math.cos(t),
        o: 0.35 + Math.random() * 0.65,   // opacidad propia
        s: 0.25 + Math.random() * 0.75,   // radio en px CSS
        f: Math.random() * 6.28,          // fase del temblor
        w: 0.4 + Math.random(),           // ritmo del temblor
      });
    }
  }

  // Medidas del lienzo, en px CSS. `escala` adapta los tamaños del prototipo
  // (pensados para una tarjeta de 190px de alto) a la tarjeta real.
  let anchoCSS = 0, altoCSS = 0, escala = 1;

  function medir() {
    const r = hero.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    anchoCSS = r.width;
    altoCSS = r.height;
    escala = altoCSS / 190;
    lienzo.width = Math.round(anchoCSS * dpr);
    lienzo.height = Math.round(altoCSS * dpr);
    // Todo el dibujo se hace en px CSS; el contexto se encarga de la densidad.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function mezcla(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  const CIAN = [34, 211, 238], VIOLETA = [168, 85, 247], ROSA = [255, 92, 168];
  function tono(t) {
    const m = t < 0.5 ? mezcla(CIAN, VIOLETA, t / 0.5) : mezcla(VIOLETA, ROSA, (t - 0.5) / 0.5);
    return 'rgb(' + (m[0] | 0) + ',' + (m[1] | 0) + ',' + (m[2] | 0) + ')';
  }

  let giro = 0, deriva = 0;
  let muescas = 0, golpe = 0;      // muescas pasadas y el destello de la última
  let abre = 0;                    // 0..1 mientras el dial se abre al final

  /* La esfera de partículas, pequeña, dentro del dial. */
  function esfera(cx, cy, R, brillo, col) {
    const ca = Math.cos(giro), sa = Math.sin(giro);
    ctx.fillStyle = col;
    for (let i = 0; i < N; i++) {
      const q = pts[i];
      const rx = q.x * ca - q.z * sa, rz = q.x * sa + q.z * ca;
      const pz = 1.9 / (1.9 + rz);
      const jx = Math.sin(q.f + deriva * q.w) * (1 - brillo) * 3 * escala;
      ctx.globalAlpha = Math.min(1, (0.25 + brillo * 0.75) * q.o * pz);
      ctx.beginPath();
      ctx.arc(cx + (rx * R + jx) * pz, cy + q.y * R * pz, q.s * pz * (0.6 + brillo * 0.6) * escala, 0, 6.284);
      ctx.fill();
    }
  }

  function dibujar(x, p) {
    ctx.clearRect(0, 0, anchoCSS, altoCSS);
    deriva += 0.012;
    giro += 0.006 + p * 0.03 + abre * 0.2;

    // El dial va centrado en la rendija que deja la tarjeta: se ve entero en
    // cuanto hay sitio, y antes asoma por el borde.
    const R = altoCSS * 0.34;
    // Mientras no cabe, asoma pegado al borde; en cuanto cabe, al centro de
    // la rendija. En x = 2,5 R las dos reglas dan lo mismo: no hay salto.
    const cx = x / 2 >= R * 1.25 ? x / 2 : x - R * 1.25, cy = altoCSS / 2;
    const n = Math.min(4, Math.floor(p * 4 + 1e-6));
    if (n > muescas) golpe = 1;
    muescas = n;
    golpe = Math.max(0, golpe - 0.06);
    const col = tono(p);
    const giroDial = p * Math.PI * 3;

    // Halo de fondo: sube con el recorrido y con cada muesca.
    ctx.globalAlpha = 0.06 + p * 0.18 + golpe * 0.22 + abre * 0.4;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, 6.284); ctx.fill();

    // La esfera de dentro: apagada mientras está cerrado, se enciende al abrir.
    esfera(cx, cy, R * (0.42 + abre * 0.35), 0.25 + p * 0.25 + abre * 0.75, col);

    // Las dos mitades del dial, con sus marcas. Al abrir se separan.
    ctx.lineCap = 'round';
    for (const lado of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + lado * abre * R * 1.1, cy);
      ctx.rotate(giroDial);
      const a0 = lado < 0 ? Math.PI / 2 : -Math.PI / 2;
      ctx.globalAlpha = 0.45 + p * 0.45;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5 * escala;
      ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + Math.PI); ctx.stroke();
      for (let i = 0; i <= 30; i++) {
        const a = a0 + (i / 30) * Math.PI;
        const largo = (i % 5 === 0 ? 9 : 4) * escala;
        ctx.globalAlpha = (i % 5 === 0 ? 0.8 : 0.35) * (0.5 + p * 0.5);
        ctx.lineWidth = (i % 5 === 0 ? 1.4 : 1) * escala;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (R - 3 * escala), Math.sin(a) * (R - 3 * escala));
        ctx.lineTo(Math.cos(a) * (R - 3 * escala - largo), Math.sin(a) * (R - 3 * escala - largo));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Las cuatro muescas, fijas: no giran con el dial. Se encienden al pasar.
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 2;
      const separa = abre * R * 1.1 * Math.sign(Math.round(Math.cos(a) * 100));
      const mx = cx + Math.cos(a) * (R + 12 * escala) + separa, my = cy + Math.sin(a) * (R + 12 * escala);
      const encendida = i < n;
      ctx.globalAlpha = encendida ? 1 : 0.35;
      ctx.fillStyle = encendida ? (n >= 4 ? '#fff' : col) : col;
      ctx.beginPath(); ctx.arc(mx, my, (encendida ? 3.6 : 2.4) * escala, 0, 6.284); ctx.fill();
      if (encendida && i === n - 1 && golpe > 0) {
        ctx.globalAlpha = golpe;
        ctx.strokeStyle = col; ctx.lineWidth = 1.2 * escala;
        ctx.beginPath(); ctx.arc(mx, my, (6 + (1 - golpe) * 18) * escala, 0, 6.284); ctx.stroke();
      }
    }

    // El corazón, al abrirse: un punto blanco que crece hasta el fogonazo.
    if (abre > 0) {
      ctx.globalAlpha = Math.min(1, abre * 1.2);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx, cy, (2 + abre * 10) * escala, 0, 6.284); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ───────────────────────────────────────────── arrastre de la tapa
  let x = 0;                  // desplazamiento visual, px CSS
  let arrastrando = false, armado = false, descartado = false, hecho = false;
  let inicioX = 0, inicioY = 0, baseX = 0;
  let raf = null, volviendo = false;

  function aplicar() {
    hero.style.transform = x ? `translateX(${x}px)` : '';
    if (!reduccion.matches) dibujar(x, Math.max(0, Math.min(1, x / CONFIG.recorrido)));
  }

  // El bucle solo existe mientras hay gesto. En reposo, cero trabajo: ni un
  // requestAnimationFrame pendiente. La vuelta a cero se hace aquí dentro y
  // no en su propio rAF, para que no haya dos bucles pisándose.
  function bucle() {
    if (volviendo) {
      x *= 0.82;
      if (x < 0.5) { x = 0; volviendo = false; }
    }
    aplicar();
    if (arrastrando || volviendo || hecho) raf = requestAnimationFrame(bucle);
    else { raf = null; ctx.clearRect(0, 0, anchoCSS, altoCSS); }
  }
  function arrancarBucle() { if (raf === null) raf = requestAnimationFrame(bucle); }

  function completar() {
    if (hecho) return;
    hecho = true;
    arrastrando = false;
    x = CONFIG.recorrido;

    // Con movimiento reducido no hay fogonazo: un destello a pantalla
    // completa es justo lo que esa preferencia pide evitar.
    if (reduccion.matches) { window.location.href = CONFIG.destino; return; }

    // El dial se abre en dos y, ya abierto, el fogonazo y el salto.
    const t0 = performance.now();
    const abrir = ahora => {
      abre = Math.min(1, (ahora - t0) / CONFIG.msAbrir);
      if (abre < 1) { requestAnimationFrame(abrir); return; }
      const flash = document.createElement('div');
      flash.className = 'vault-fogonazo';
      document.body.appendChild(flash);
      requestAnimationFrame(() => flash.classList.add('on'));
      setTimeout(() => { window.location.href = CONFIG.destino; }, CONFIG.msFogonazo);
    };
    requestAnimationFrame(abrir);
  }

  hero.addEventListener('pointerdown', ev => {
    if (hecho) return;
    // En ratón se exige el botón principal. En táctil y lápiz no se filtra
    // aquí: un `buttons` raro de un dispositivo concreto dejaría el gesto
    // inservible, y el filtro que de verdad importa está en pointermove.
    if (ev.pointerType === 'mouse' && ev.buttons !== 1) return;
    if (!pts.length) sembrar();
    if (!medir()) return;
    arrastrando = true;
    armado = false;
    descartado = false;
    inicioX = ev.clientX;
    inicioY = ev.clientY;
    baseX = x;
    try { hero.setPointerCapture(ev.pointerId); } catch {}
    arrancarBucle();
  });

  hero.addEventListener('pointermove', ev => {
    if (!arrastrando || hecho) return;

    // ESTO es lo que arreglaba el fallo de escritorio: en producción bastaba
    // pasar el ratón por encima para que la tarjeta se moviera y se quedara
    // enganchada. Sin botón pulsado, el gesto termina aquí.
    if (!ev.buttons) { terminar(ev); return; }

    let d = ev.clientX - inicioX;

    if (!armado) {
      if (descartado) return;
      const dy = ev.clientY - inicioY;
      // Si el gesto se declara vertical antes de recorrer lo suficiente en
      // horizontal, es un scroll y no se vuelve a mirar hasta soltar.
      if (Math.abs(dy) > Math.abs(d) && Math.abs(dy) > 10) { descartado = true; return; }
      if (Math.abs(d) < CONFIG.zonaMuerta) return;
      // La zona muerta se descuenta: el recorrido empieza en cero.
      armado = true;
      inicioX = ev.clientX;
      d = 0;
    }

    x = Math.max(0, Math.min(CONFIG.recorrido, baseX + d));
    if (x >= CONFIG.recorrido) completar();
  });

  function terminar(ev) {
    if (!arrastrando) return;
    arrastrando = false;
    descartado = false;
    if (ev) { try { hero.releasePointerCapture(ev.pointerId); } catch {} }
    // Soltando antes del final, la tarjeta vuelve a su sitio y no pasa nada.
    if (!hecho && x > 0) volviendo = true;
  }
  hero.addEventListener('pointerup', terminar);
  hero.addEventListener('pointercancel', terminar);

  // Al volver a la portada desde /val/ (incluida la vuelta atrás del
  // navegador, que puede servir la página de la caché) la tarjeta debe
  // aparecer cerrada: no se recuerda ningún estado.
  window.addEventListener('pageshow', () => {
    hecho = false; arrastrando = false; volviendo = false;
    x = 0; abre = 0; muescas = 0; golpe = 0;
    hero.style.transform = '';
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    if (anchoCSS) ctx.clearRect(0, 0, anchoCSS, altoCSS);
    const f = document.querySelector('.vault-fogonazo');
    if (f) f.remove();
  });

  window.addEventListener('resize', () => {
    if (raf !== null) medir();
  });
})();
