/**
 * La esfera.
 *
 * Este módulo no sabe qué es un validador, ni un barrido, ni un APR. Recibe un
 * objeto plano con números ya normalizados y los pinta. Toda la lógica de
 * negocio vive fuera, y por eso se puede probar con datos inventados sin tocar
 * nada más.
 *
 *   actualizar({
 *     nodos:    [{ intensidad: 0..1, activo: bool }],
 *     energia:  0..1,
 *     frescura: 0..1,
 *   })
 *
 * Las POSICIONES DE LOS NODOS NO VIENEN DE LOS DATOS. Se reparten en espiral
 * de Fibonacci a partir del índice, y son deliberadamente arbitrarias: los
 * validadores corren todos en la misma máquina, así que cualquier posición que
 * pareciera significar algo estaría mintiendo. Lo que sí codifican es tamaño y
 * brillo, que salen de los datos.
 *
 * ## Las capas, de dentro a fuera
 *
 *   campo interior   cientos de puntos DENTRO del volumen → profundidad
 *   malla fina       retícula secundaria, muy tenue       → fondo
 *   cáscara          celdas translúcidas                  → volumen
 *   malla principal  la retícula marcada                  → estructura
 *   vértices         puntos con su propio halo            → grano y resplandor
 *   cadena + nodos   los validadores, en naranja          → lo único con dato
 *
 * La jerarquía entre los tres niveles de línea es la mitad del efecto: con
 * todas al mismo grosor y brillo la esfera se lee plana.
 */

import * as THREE from '../vendor/three.module.js';
import { LineSegments2 } from '../vendor/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../vendor/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../vendor/jsm/lines/LineMaterial.js';

import { construirCeldas, campoInterior } from './celdas.js';
import { ESCALONES, elegirEscalon, Vigilante } from './calidad.js';
import { crearUniformsDeformacion, inyectar, UNIFORMS_DEFORMACION, FUNCION_DEFORMACION } from './deformacion.js';

const CIAN     = new THREE.Color(0x2ad4f0);
const CIAN_OSC = new THREE.Color(0x0b4a68);
const NARANJA  = new THREE.Color(0xff8a3d);
const FONDO    = 0x03070f;

/** Direcciones repartidas por la esfera. Arbitrarias a propósito. */
function direccionesNodos(n) {
  const out = [];
  const phi = Math.PI * (1 + Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const t = Math.acos(1 - 2 * (i + 0.5) / n);
    const a = phi * i;
    out.push(new THREE.Vector3(
      Math.sin(t) * Math.cos(a),
      Math.sin(t) * Math.sin(a),
      Math.cos(t),
    ));
  }
  return out;
}

/**
 * Los números de los nodos, dibujados una vez en un canvas y usados como
 * atlas. Cada instancia toma su casilla según su índice, así que los N anillos
 * numerados se pintan en UNA llamada de dibujo. La alternativa —un sprite con
 * su textura por nodo— multiplica las llamadas por el número de validadores.
 */
function atlasNumeros(n) {
  const COL = Math.max(1, Math.ceil(Math.sqrt(n)));
  const FIL = Math.max(1, Math.ceil(n / COL));
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = COL * S; cv.height = FIL * S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#ffffff';
  g.font = '700 34px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const c = i % COL, f = Math.floor(i / COL);
    g.fillText(String(i + 1).padStart(2, '0'), c * S + S / 2, f * S + S / 2 + 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, COL, FIL };
}

/** Geometría instanciada a partir de una base, sin usar instanceMatrix. */
function instanciar(base, n) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  g.instanceCount = n;
  return g;
}

export function crearEsfera(contenedor, { escalon = null, semilla, bloom = null } = {}) {
  const nombreEscalon = escalon || elegirEscalon();
  let cfg = { ...ESCALONES[nombreEscalon] };
  // `bloom` fuerza el postprocesado con independencia del escalón. Existe para
  // poder comparar la misma pantalla con y sin él y medir cuánta diferencia
  // hace de verdad, que es la única forma de decidir si en móvil compensa.
  if (bloom !== null) cfg.bloom = !!bloom;
  const reducido = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  // ─────────────────────────────────────────────── renderer y escena
  const renderer = new THREE.WebGLRenderer({
    antialias: nombreEscalon !== 'bajo',
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setClearColor(FONDO, 1);
  // ACES hace que lo muy brillante caiga a blanco en vez de recortarse en cian
  // plano. Es la mitad del resplandor que no pone el bloom.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  contenedor.appendChild(renderer.domElement);

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camara.position.set(0, 0, 3.05);
  const grupo = new THREE.Group();
  escena.add(grupo);

  const uniformes = crearUniformsDeformacion(THREE);
  uniformes.uRespiracion.value = reducido ? 0 : 1;
  const uFrescura = { value: 1 };
  const uEnergia  = { value: 0.5 };
  const materialesLinea = [];              // para repartirles `resolution`

  // ─────────────────────────────────────────────── geometría
  const celdas = construirCeldas(THREE, { nCeldas: cfg.celdas, semilla, variacion: 1 });
  // La malla fina es un segundo Voronoi independiente, mucho más denso. Que
  // sea otro y no una subdivisión del primero es lo que impide que las dos
  // retículas rimen y acaben leyéndose como una sola.
  const fina = construirCeldas(THREE, {
    nCeldas: cfg.celdasFinas, semilla: (semilla || 20260815) + 7717, variacion: 0.75,
  });
  const campo = campoInterior(cfg.puntosInterior);

  // ── cáscara translúcida ──
  // Aditiva y sin escribir profundidad: las caras de atrás SUMAN luz a las de
  // delante en vez de quedar ocultas. Eso da la translucidez sin pagar
  // transparencia real, que sería mucho más cara.
  const matCascara = new THREE.ShaderMaterial({
    uniforms: { ...uniformes, uFrescura, uEnergia, uColor: { value: CIAN_OSC.clone() } },
    vertexShader: /* glsl */`
      #include <common>
      ${UNIFORMS_DEFORMACION}
      ${FUNCION_DEFORMACION}
      attribute float aTono;
      varying float vTono;
      varying float vBorde;
      void main(){
        vTono = aTono;
        vec3 p = deformar(position);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 nVista = normalize(normalMatrix * normalize(p));
        vBorde = 1.0 - abs(dot(nVista, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uFrescura; uniform float uEnergia;
      varying float vTono; varying float vBorde;
      void main(){
        float borde = pow(vBorde, 2.6);
        float matiz = 0.55 + vTono * 0.45;
        vec3 col = uColor * matiz * (0.006 + borde * 0.22) * (0.5 + uEnergia * 0.7);
        col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const cascara = new THREE.Mesh(celdas.cascara, matCascara);
  cascara.frustumCulled = false;
  grupo.add(cascara);

  // ── puntos ──
  // El mismo material sirve para el campo interior y para los vértices de la
  // retícula. Cada punto lleva núcleo duro Y halo ancho en el mismo
  // cuadrilátero: eso es un bloom por punto, en la misma pasada, y es de donde
  // sale el resplandor. Antes lo ponía un aro uniforme pegado al contorno, y
  // se notaba postizo.
  function materialPuntos(color, tamBase, tamVar, ganancia) {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniformes, uFrescura, uEnergia,
        uTam: { value: cfg.punto }, uColor: { value: color.clone() },
        uBase: { value: tamBase }, uVar: { value: tamVar }, uGan: { value: ganancia } },
      vertexShader: /* glsl */`
        #include <common>
        ${UNIFORMS_DEFORMACION}
        ${FUNCION_DEFORMACION}
        attribute vec3 aDir;
        attribute float aBrillo;
        uniform float uTam; uniform float uBase; uniform float uVar;
        varying vec2 vP; varying float vB;
        void main(){
          vP = position.xy; vB = aBrillo;
          // El campo interior no está sobre la superficie, así que se deforma
          // su dirección y se conserva el radio: la nube acompaña al bulto sin
          // salirse del volumen.
          float radio = length(aDir);
          vec3 p = deformar(aDir) * radio;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          mv.xy += position.xy * (uBase + aBrillo * uVar) * uTam;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uFrescura; uniform float uEnergia; uniform float uGan;
        varying vec2 vP; varying float vB;
        void main(){
          float d = length(vP) * 2.0;
          if (d > 1.0) discard;
          float nucleo = pow(1.0 - d, 2.4);
          float halo   = exp(-d * 2.6) * 0.30;
          float i = nucleo + halo;
          vec3 col = mix(uColor, vec3(1.0), nucleo * nucleo * 0.8) * vB * uGan * (0.7 + uEnergia * 0.8);
          col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
          gl_FragColor = vec4(col, i * vB * uGan);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  const planoUnidad = new THREE.PlaneGeometry(1, 1);
  function nube(pos, brillo, material) {
    const g = instanciar(planoUnidad, brillo.length);
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute('aBrillo', new THREE.InstancedBufferAttribute(brillo, 1));
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    grupo.add(m);
    return m;
  }

  // Campo interior: la pieza que quita la sensación de cáscara hueca.
  nube(campo.pos, campo.brillo, materialPuntos(CIAN, 0.006, 0.020, 0.85));

  // ── líneas, en tres niveles ──
  function materialLinea(color, grosor, ganancia) {
    const m = new LineMaterial({
      color: 0xffffff, linewidth: grosor,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    Object.assign(m.uniforms, uniformes, { uFrescura, uEnergia,
      uCian: { value: color.clone() },
      uIntensidad: { value: cfg.intensidad * ganancia } });

    // La deformación se aplica a los DOS extremos. Como `deformar` es función
    // pura de la posición en reposo, dos aristas que comparten vértice siguen
    // unidas sin guardar ninguna adyacencia.
    m.vertexShader = inyectar(m.vertexShader)
      .replace('vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
               'vec4 start = modelViewMatrix * vec4( deformar(instanceStart), 1.0 );')
      .replace('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
               'vec4 end = modelViewMatrix * vec4( deformar(instanceEnd), 1.0 );');

    m.fragmentShader = m.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFrescura; uniform float uEnergia; uniform float uIntensidad;
        uniform vec3 uCian;`)
      .replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );',
        `float d = abs(vUv.y);
         float nucleo = exp(-d * d * 6.0);
         float halo   = exp(-d * 2.1) * 0.30;
         vec3 col = mix(uCian, vec3(1.0), nucleo * 0.32) * (0.6 + uEnergia * 0.7);
         col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
         gl_FragColor = vec4(col, alpha * (nucleo + halo) * 0.85 * uIntensidad);`);
    materialesLinea.push(m);
    return m;
  }

  function malla(posiciones, material, orden = 0) {
    const g = new LineSegmentsGeometry();
    g.setPositions(posiciones);
    const l = new LineSegments2(g, material);
    l.frustumCulled = false;
    l.renderOrder = orden;
    grupo.add(l);
    return l;
  }

  // Nivel 2 — malla fina de fondo. Muy tenue: su trabajo es que se perciba
  // estructura por debajo de la retícula marcada, no competir con ella.
  malla(fina.aristas, materialLinea(CIAN, cfg.grosorFino, cfg.ganFina));
  // Nivel 1 — retícula principal.
  malla(celdas.aristas, materialLinea(CIAN, cfg.grosor, 1));

  // Vértices de la retícula, con su halo.
  nube(celdas.puntos, celdas.brilloPunto, materialPuntos(CIAN, 0.009, 0.017, 1.25));

  // ── atmósfera ──
  // Queda muy floja a propósito. Antes hacía todo el resplandor y se notaba:
  // un aro azul uniforme pegado al contorno. Ahora el brillo lo ponen los
  // puntos, y esto solo asienta la silueta sobre el fondo.
  const uAtmosfera = { value: cfg.atmosfera };
  const matAtmosfera = new THREE.ShaderMaterial({
    uniforms: { uAtmosfera, uFrescura, uEnergia, uColor: { value: CIAN.clone() },
      uSilueta: { value: 0.545 } },
    vertexShader: /* glsl */`
      varying vec2 vP;
      void main(){
        vP = position.xy;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * 2.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uAtmosfera; uniform float uFrescura; uniform float uEnergia;
      uniform float uSilueta; uniform vec3 uColor;
      varying vec2 vP;
      void main(){
        float r = length(vP);
        float dentro = smoothstep(uSilueta - 0.055, uSilueta - 0.005, r);
        float fuera  = exp(-pow(max(0.0, r - uSilueta) / 0.10, 2.0));
        float g = dentro * fuera * uAtmosfera * (0.45 + uEnergia * 0.75);
        vec3 col = uColor * g;
        col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
        gl_FragColor = vec4(col, g);
      }`,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const atmosfera = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matAtmosfera);
  atmosfera.frustumCulled = false;
  atmosfera.renderOrder = -1;
  escena.add(atmosfera);

  // ── anillos de ambiente ──
  {
    const anillos = new THREE.Group();
    for (const [radio, inclinacion, alfa] of [[1.14, 0.05, 0.16], [1.24, -0.09, 0.10], [1.36, 0.13, 0.06]]) {
      const pts = [];
      const N = 128;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, b = ((i + 1) / N) * Math.PI * 2;
        pts.push(Math.cos(a) * radio, 0, Math.sin(a) * radio,
                 Math.cos(b) * radio, 0, Math.sin(b) * radio);
      }
      const g = new LineSegmentsGeometry();
      g.setPositions(new Float32Array(pts));
      const m = new LineMaterial({ color: 0x2ad4f0, linewidth: 1, transparent: true,
        opacity: alfa, depthWrite: false, blending: THREE.AdditiveBlending });
      materialesLinea.push(m);
      const l = new LineSegments2(g, m);
      l.frustumCulled = false;
      l.rotation.set(inclinacion, 0, inclinacion * 1.6);
      anillos.add(l);
    }
    anillos.rotation.x = 1.36;
    escena.add(anillos);
  }

  // ─────────────────────────────────────────── nodos de validador
  //
  // Anillos con el número dentro, encadenados por una línea naranja.
  //
  // ⚠ LA CADENA ES ADORNO, NO UN DATO. No representa ninguna conexión: los
  // validadores corren todos en la misma máquina y no se hablan entre ellos.
  // Une los nodos por orden de índice, que además es un orden arbitrario.
  // Queda escrito aquí para que nadie —nosotros dentro de unos meses
  // incluidos— la lea como si dijera algo sobre la topología.
  let nNodos = 0, mallaNodos = null, mallaCadena = null, atlas = null;
  const matCadena = materialLinea(NARANJA, cfg.grosor * 1.25, 1.75);

  const matNodo = new THREE.ShaderMaterial({
    uniforms: { ...uniformes, uFrescura, uEnergia,
      uTam: { value: cfg.halo }, uColor: { value: NARANJA.clone() },
      uAtlas: { value: null }, uRejilla: { value: new THREE.Vector2(1, 1) } },
    vertexShader: /* glsl */`
      #include <common>
      ${UNIFORMS_DEFORMACION}
      ${FUNCION_DEFORMACION}
      attribute vec3 aDir;
      attribute float aInt;
      attribute float aIndice;
      uniform float uTam;
      varying vec2 vP; varying float vI; varying float vIdx;
      void main(){
        vP = position.xy; vI = aInt; vIdx = aIndice;
        vec4 mv = modelViewMatrix * vec4(deformar(aDir), 1.0);
        mv.xy += position.xy * (0.160 + aInt * 0.050) * uTam;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uFrescura; uniform float uEnergia;
      uniform sampler2D uAtlas; uniform vec2 uRejilla;
      varying vec2 vP; varying float vI; varying float vIdx;
      void main(){
        float r = length(vP) * 2.0;
        float aro  = smoothstep(0.58, 0.66, r) * (1.0 - smoothstep(0.74, 0.82, r));
        // El resplandor sale del propio nodo, no de un contorno externo.
        float glow = exp(-pow((r - 0.68) / 0.30, 2.0)) * 0.28;
        // Número: se muestrea la casilla del atlas que toca a este índice.
        float col = mod(vIdx, uRejilla.x);
        float fil = floor(vIdx / uRejilla.x);
        vec2 uvLocal = vP / 0.40 + 0.5;
        float texto = 0.0;
        if (uvLocal.x > 0.0 && uvLocal.x < 1.0 && uvLocal.y > 0.0 && uvLocal.y < 1.0) {
          // El canvas crece hacia abajo y la textura hacia arriba: se invierte
          // la fila o el 01 sale en la casilla equivocada.
          vec2 uv = (vec2(col, uRejilla.y - 1.0 - fil) + uvLocal) / uRejilla;
          texto = texture2D(uAtlas, uv).a;
        }
        float i = aro * (0.95 + vI * 0.6) + glow * (0.7 + vI * 0.8) + texto * 1.9;
        if (i < 0.004) discard;
        vec3 c = mix(uColor, vec3(1.0), max(texto * 0.92, aro * 0.30));
        c *= (0.75 + uEnergia * 0.5);
        c = mix(vec3(dot(c, vec3(0.33))), c, uFrescura);
        gl_FragColor = vec4(c * i, i);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  function construirNodos(n) {
    for (const m of [mallaNodos, mallaCadena]) {
      if (m) { grupo.remove(m); m.geometry.dispose(); }
    }
    mallaNodos = mallaCadena = null;
    nNodos = n;
    if (n === 0) return;

    const dirs = direccionesNodos(n);
    const aDir = new Float32Array(n * 3);
    const aInt = new Float32Array(n);
    const aIdx = new Float32Array(n);
    dirs.forEach((d, i) => {
      aDir[i * 3] = d.x; aDir[i * 3 + 1] = d.y; aDir[i * 3 + 2] = d.z;
      aInt[i] = 0.5; aIdx[i] = i;
    });

    if (atlas) atlas.tex.dispose();
    atlas = atlasNumeros(n);
    matNodo.uniforms.uAtlas.value = atlas.tex;
    matNodo.uniforms.uRejilla.value.set(atlas.COL, atlas.FIL);

    const g = instanciar(planoUnidad, n);
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(aDir, 3));
    g.setAttribute('aInt', new THREE.InstancedBufferAttribute(aInt, 1));
    g.setAttribute('aIndice', new THREE.InstancedBufferAttribute(aIdx, 1));
    mallaNodos = new THREE.Mesh(g, matNodo);
    mallaNodos.frustumCulled = false;
    mallaNodos.renderOrder = 3;
    grupo.add(mallaNodos);

    // La cadena: arcos de círculo máximo entre nodos consecutivos, cerrando el
    // ciclo. Se trocea para que siga la curvatura en vez de atravesar la
    // esfera por dentro, y va un pelo por fuera de la superficie.
    if (n >= 2) {
      const TROZOS = 12;
      const pts = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      const p = new THREE.Vector3(), q = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        a.copy(dirs[i]); b.copy(dirs[(i + 1) % n]);
        for (let k = 0; k < TROZOS; k++) {
          p.copy(a).lerp(b, k / TROZOS).normalize().multiplyScalar(1.012);
          q.copy(a).lerp(b, (k + 1) / TROZOS).normalize().multiplyScalar(1.012);
          pts.push(p.x, p.y, p.z, q.x, q.y, q.z);
        }
      }
      const gc = new LineSegmentsGeometry();
      gc.setPositions(new Float32Array(pts));
      mallaCadena = new LineSegments2(gc, matCadena);
      mallaCadena.frustumCulled = false;
      mallaCadena.renderOrder = 2;
      grupo.add(mallaCadena);
    }
  }

  // ─────────────────────────────────────────────── postprocesado
  //
  // APAGADO EN TODOS LOS ESCALONES, y no por rendimiento: se ve peor.
  //
  // El bloom tenía sentido cuando las primitivas eran planas. Desde que cada
  // arista lleva su degradado y cada punto su núcleo con halo, el
  // postprocesado vuelve a difuminar lo que ya brillaba y el resultado es
  // lechoso: medido a 1440 y a 390, el brillo medio pasa de 19 a 59 y el área
  // de halo del 12% al 78%. El negro entre las celdas se vuelve gris, los
  // puntos se disuelven y los aros naranjas viran a blanco.
  //
  // El efecto secundario bueno es que escritorio y móvil pasan a usar
  // exactamente la misma técnica, así que la brecha entre ambos desaparece de
  // raíz en vez de compensarse.
  //
  // El camino se deja montado y accesible con `bloom: true` (o `?bloom=1`)
  // para poder volver a mirarlo, pero los módulos se cargan solo si se pide:
  // así no se descargan los ~28 KB del postprocesado en el caso normal.
  let composer = null, pasoBloom = null;
  async function montarBloom() {
    if (composer) return;
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('../vendor/jsm/postprocessing/EffectComposer.js'),
      import('../vendor/jsm/postprocessing/RenderPass.js'),
      import('../vendor/jsm/postprocessing/UnrealBloomPass.js'),
      import('../vendor/jsm/postprocessing/OutputPass.js'),
    ]);
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(escena, camara));
    pasoBloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.55, 0.62);
    composer.addPass(pasoBloom);
    composer.addPass(new OutputPass());
    composer.setSize(ancho, alto);
  }
  function desmontarBloom() {
    if (!composer) return;
    composer.dispose?.();
    composer = null; pasoBloom = null;
  }
  if (cfg.bloom) montarBloom();

  // ─────────────────────────────────────────────── tamaño
  let ancho = 1, alto = 1;
  function medir() {
    const r = contenedor.getBoundingClientRect();
    ancho = Math.max(1, Math.round(r.width));
    alto  = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, cfg.dprMax);
    renderer.setPixelRatio(dpr);
    renderer.setSize(ancho, alto, false);
    camara.aspect = ancho / alto;

    // El encuadre se calcula, no se fija a ojo. `fov` es el VERTICAL, así que
    // en pantalla estrecha y alta el ángulo horizontal es mucho menor y la
    // esfera se sale por los lados aunque quepa de sobra por arriba.
    const MARGEN = 1.18;
    const vFov = camara.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camara.aspect);
    const d = Math.max(MARGEN / Math.tan(vFov / 2), MARGEN / Math.tan(hFov / 2));
    camara.position.z = d;
    camara.updateProjectionMatrix();

    // Radio aparente de la silueta: una esfera de radio 1 a distancia d se
    // proyecta algo mayor que 1 por la perspectiva, y la atmósfera tiene que
    // engancharse justo ahí.
    const silueta = 1 / Math.sqrt(Math.max(1e-4, 1 - 1 / (d * d)));
    matAtmosfera.uniforms.uSilueta.value = silueta / 2.0;

    for (const m of materialesLinea) m.resolution.set(ancho * dpr, alto * dpr);
    if (composer) composer.setSize(ancho, alto);
  }
  const observador = new ResizeObserver(medir);
  observador.observe(contenedor);
  medir();

  // ─────────────────────────────────────────────── interacción
  let girX = 0, girY = 0, velX = 0, velY = 0;
  let arrastrando = false, ultX = 0, ultY = 0;
  const objetivoPuntero = new THREE.Vector3(0, 0, 1);
  let objetivoFuerza = 0;

  const rayo = new THREE.Raycaster();
  const esferaMat = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
  const golpe = new THREE.Vector3();
  const invQ = new THREE.Quaternion();

  function apuntar(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    const nx = ((ev.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((ev.clientY - r.top) / r.height) * 2 + 1;
    rayo.setFromCamera({ x: nx, y: ny }, camara);
    if (!rayo.ray.intersectSphere(esferaMat, golpe)) { objetivoFuerza = 0; return; }
    // El puntero se guarda en espacio del OBJETO: la esfera gira, y en espacio
    // de mundo el bulto se quedaría clavado en la pantalla en vez de viajar
    // con la superficie.
    invQ.copy(grupo.quaternion).invert();
    objetivoPuntero.copy(golpe).normalize().applyQuaternion(invQ);
    objetivoFuerza = 1;
  }

  const lienzo = renderer.domElement;
  lienzo.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.buttons !== 1) return;
    arrastrando = true; ultX = ev.clientX; ultY = ev.clientY;
    try { lienzo.setPointerCapture(ev.pointerId); } catch {}
    apuntar(ev);
  });
  lienzo.addEventListener('pointermove', ev => {
    // Sin botón pulsado no hay arrastre.
    if (arrastrando && !ev.buttons) arrastrando = false;
    if (arrastrando) {
      velY += (ev.clientX - ultX) * 0.00042;
      velX += (ev.clientY - ultY) * 0.00042;
      ultX = ev.clientX; ultY = ev.clientY;
    }
    apuntar(ev);
  });
  const soltar = ev => {
    arrastrando = false;
    try { lienzo.releasePointerCapture(ev.pointerId); } catch {}
    if (ev.pointerType !== 'mouse') objetivoFuerza = 0;
  };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);
  lienzo.addEventListener('pointerleave', () => { objetivoFuerza = 0; });

  // ─────────────────────────────────────────────── estado de la app
  let energiaObjetivo = 0.5, frescuraObjetivo = 1;

  function actualizar(estado) {
    if (!estado) return;
    const lista = estado.nodos || [];
    if (lista.length !== nNodos) construirNodos(lista.length);
    if (mallaNodos) {
      const att = mallaNodos.geometry.getAttribute('aInt');
      for (let i = 0; i < lista.length; i++) {
        att.array[i] = Math.max(0, Math.min(1, lista[i].intensidad ?? 0.5));
      }
      att.needsUpdate = true;
    }
    if (estado.energia  != null) energiaObjetivo  = Math.max(0, Math.min(1, estado.energia));
    if (estado.frescura != null) frescuraObjetivo = Math.max(0, Math.min(1, estado.frescura));
  }

  // ─────────────────────────────────────────────── bucle
  const vigilante = new Vigilante(() => degradar());
  function degradar() {
    // Sin bloom que apagar, lo único barato que queda es bajar la resolución.
    // La geometría no se toca: rehacerla a mitad de sesión daría un tirón y
    // cambiaría el dibujo de las celdas delante del usuario.
    if (composer) { desmontarBloom(); return true; }
    if (cfg.dprMax > 1.0) { cfg.dprMax = Math.max(1.0, cfg.dprMax - 0.25); medir(); return true; }
    return false;
  }

  let raf = null, ultimo = performance.now(), visible = true, reloj = 0;
  let fps = 0, muestrasFps = 0, acumFps = 0, fotogramas = 0;

  function bucle(ahora) {
    raf = requestAnimationFrame(bucle);
    const dt = Math.min(0.05, (ahora - ultimo) / 1000);
    const msFrame = ahora - ultimo;
    ultimo = ahora;
    if (!visible) return;

    vigilante.fotograma(msFrame);
    fotogramas++;
    acumFps += msFrame;
    if (++muestrasFps >= 15) { fps = Math.round(1000 / (acumFps / muestrasFps)); acumFps = 0; muestrasFps = 0; }

    reloj += dt;
    uniformes.uTiempo.value = reloj;

    if (!reducido) girY += dt * 0.055;
    girY += velY; girX += velX;
    velX *= 0.92; velY *= 0.92;
    girX = Math.max(-1.15, Math.min(1.15, girX));
    grupo.rotation.set(girX, girY, 0);

    const k = 1 - Math.exp(-dt * 7);
    uniformes.uFuerza.value += (objetivoFuerza - uniformes.uFuerza.value) * k;
    uniformes.uPuntero.value.lerp(objetivoPuntero, k);
    uEnergia.value  += (energiaObjetivo  - uEnergia.value)  * k * 0.5;
    uFrescura.value += (frescuraObjetivo - uFrescura.value) * k * 0.5;

    if (composer) composer.render(); else renderer.render(escena, camara);
  }

  // En reposo, cero trabajo.
  const alVer = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
  alVer.observe(contenedor);
  const alCambiarPestana = () => { visible = !document.hidden; ultimo = performance.now(); };
  document.addEventListener('visibilitychange', alCambiarPestana);

  raf = requestAnimationFrame(bucle);

  return {
    actualizar,
    info: () => ({
      escalon: nombreEscalon, bloom: !!composer, fps, fotogramas,
      celdas: celdas.nCeldas, segmentos: celdas.nSegmentos,
      celdasFinas: fina.nCeldas, segmentosFinos: fina.nSegmentos,
      puntosInterior: campo.n, vertices: celdas.nPuntos,
      triangulos: celdas.nTriangulos, msGeometria: celdas.ms + fina.ms,
      nodos: nNodos, dpr: renderer.getPixelRatio(), ancho, alto, visible,
      fuerza: uniformes.uFuerza.value, respiracion: uniformes.uRespiracion.value,
      llamadas: renderer.info.render.calls, reducido,
    }),
    destruir() {
      cancelAnimationFrame(raf);
      observador.disconnect(); alVer.disconnect();
      document.removeEventListener('visibilitychange', alCambiarPestana);
      desmontarBloom();
      if (atlas) atlas.tex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
