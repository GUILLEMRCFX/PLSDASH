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
 * ## Las capas, de dentro a fuera
 *
 *   campo interior   cientos de puntos DENTRO del volumen → profundidad
 *   malla fina       retícula secundaria, muy tenue       → fondo
 *   cáscara          caras translúcidas                   → volumen
 *   malla principal  la retícula marcada                  → estructura
 *   vértices         puntos con núcleo duro               → grano y resplandor
 *   cadena + nodos   los validadores, en naranja          → lo único con dato
 *
 * La jerarquía entre los tres niveles de línea es la mitad del efecto: con
 * todas al mismo grosor y brillo la esfera se lee plana.
 *
 * ## Dos geometrías intercambiables
 *
 * `setGeometria('voronoi' | 'geodesica')` cambia SOLO la malla; el campo
 * interior, los nodos, la cadena y el resplandor son los mismos en las dos.
 * Es provisional, para poder decidir mirándolas en vez de imaginándolas.
 *
 * ## Sobre el grosor de las líneas
 *
 * `LineSegments2` NO usa el `gl.lineWidth` de WebGL, que efectivamente se
 * ignora y siempre da un píxel. Construye un quad indexado por segmento
 * (`LineSegmentsGeometry`) y lo expande en espacio de pantalla desde el vertex
 * shader, así que `linewidth` es un uniform propio en píxeles CSS y el grosor
 * es real y controlable. Sigue siendo una llamada de dibujo por malla.
 */

import * as THREE from '../vendor/three.module.js';
import { LineSegments2 } from '../vendor/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../vendor/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../vendor/jsm/lines/LineMaterial.js';

import { construirCeldas, construirGeodesica, campoInterior } from './celdas.js';
import { ESCALONES, elegirEscalon, Vigilante } from './calidad.js';
import { crearUniformsDeformacion, inyectar, UNIFORMS_DEFORMACION, FUNCION_DEFORMACION } from './deformacion.js';

const CIAN     = new THREE.Color(0x2ad4f0);
const CIAN_OSC = new THREE.Color(0x0b4a68);
const NARANJA  = new THREE.Color(0xff8a3d);
// Negro puro. Cualquier gris azulado de fondo se come el contraste justo donde
// la nitidez se juega: entre las celdas.
const FONDO    = 0x000000;

/** Direcciones repartidas por la esfera. Arbitrarias a propósito. */
function direccionesFibonacci(n) {
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
 * Las mismas direcciones, pero clavadas en el vértice más cercano de la malla.
 * Así el nodo se apoya en la estructura en vez de flotar sobre ella. Se
 * descartan los repetidos: con subdivisión suficiente sobran vértices para
 * muchos más de diez validadores, así que el recuento nunca se ve limitado.
 */
function ajustarAVertices(dirs, vertices) {
  const usados = new Set();
  const n = vertices.length / 3;
  return dirs.map(d => {
    let mejor = -2, mejorId = -1;
    for (let i = 0; i < n; i++) {
      if (usados.has(i)) continue;
      const p = d.x * vertices[i * 3] + d.y * vertices[i * 3 + 1] + d.z * vertices[i * 3 + 2];
      if (p > mejor) { mejor = p; mejorId = i; }
    }
    if (mejorId < 0) return d.clone();
    usados.add(mejorId);
    return new THREE.Vector3(vertices[mejorId * 3], vertices[mejorId * 3 + 1], vertices[mejorId * 3 + 2]);
  });
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
  // 128 y no 64: el número se amplía bastante en pantalla y a 64 el borde
  // llegaba blando. Es el mismo coste de subida, una sola vez.
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = COL * S; cv.height = FIL * S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#ffffff';
  g.font = '700 68px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const c = i % COL, f = Math.floor(i / COL);
    g.fillText(String(i + 1).padStart(2, '0'), c * S + S / 2, f * S + S / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
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

export function crearEsfera(contenedor, { escalon = null, semilla, geometria = 'voronoi' } = {}) {
  const nombreEscalon = escalon || elegirEscalon();
  const cfg = { ...ESCALONES[nombreEscalon] };
  const reducido = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  // ─────────────────────────────────────────────── renderer y escena
  const renderer = new THREE.WebGLRenderer({
    // Siempre activo, también en el escalón bajo. Sin postprocesado se dibuja
    // directamente al framebuffer por defecto, que es justo donde el MSAA
    // funciona — y es lo que quita los escalones de las siluetas. Es de lo más
    // barato que se puede comprar en nitidez.
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
    depth: true,
  });
  renderer.setClearColor(FONDO, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  contenedor.appendChild(renderer.domElement);

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camara.position.set(0, 0, 3.05);
  const grupo = new THREE.Group();
  escena.add(grupo);

  const uniformes = crearUniformsDeformacion();
  uniformes.uRespiracion.value = reducido ? 0 : 1;
  const uFrescura = { value: 1 };
  const uEnergia  = { value: 0.5 };
  const materialesLinea = [];

  // ─────────────────────────────────────────────── materiales
  function materialCascara() {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniformes, uFrescura, uEnergia, uColor: { value: CIAN_OSC.clone() } },
      vertexShader: /* glsl */`
        #include <common>
        ${UNIFORMS_DEFORMACION}
        ${FUNCION_DEFORMACION}
        attribute float aTono;
        varying float vTono; varying float vBorde;
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
          float borde = pow(vBorde, 3.0);
          float matiz = 0.55 + vTono * 0.45;
          // Muy tenue: la cáscara insinúa volumen y enciende la silueta. Si
          // aporta de más, el negro entre celdas deja de ser negro y toda la
          // nitidez se va con él.
          vec3 col = uColor * matiz * (0.004 + borde * 0.20) * (0.5 + uEnergia * 0.7);
          col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
          gl_FragColor = vec4(col, 1.0);
        }`,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }

  /**
   * Puntos: núcleo DURO con borde de un par de píxeles y un halo corto detrás.
   * La versión anterior era una caída exponencial desde el centro y se leía
   * como mancha difusa; esto se lee como punto.
   */
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
          // El campo interior no está sobre la superficie: se deforma su
          // dirección y se conserva el radio, así la nube no se sale.
          float radio = length(aDir);
          vec4 mv = modelViewMatrix * vec4(deformar(aDir) * radio, 1.0);
          mv.xy += position.xy * (uBase + aBrillo * uVar) * uTam;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uFrescura; uniform float uEnergia; uniform float uGan;
        varying vec2 vP; varying float vB;
        void main(){
          float d = length(vP) * 2.0;
          if (d > 1.0) discard;
          // Disco sólido con caída corta: núcleo, no mancha.
          float nucleo = 1.0 - smoothstep(0.30, 0.46, d);
          float halo   = exp(-d * 3.6) * 0.20;
          float i = nucleo + halo;
          vec3 col = mix(uColor, vec3(1.0), nucleo * 0.45) * vB * uGan * (0.75 + uEnergia * 0.75);
          col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
          gl_FragColor = vec4(col, i * vB * uGan);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  function materialLinea(color, grosor, ganancia) {
    const m = new LineMaterial({
      color: 0xffffff, linewidth: grosor,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    Object.assign(m.uniforms, uniformes, { uFrescura, uEnergia,
      uCian: { value: color.clone() },
      uIntensidad: { value: cfg.intensidad * ganancia } });

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
        // Núcleo estrecho y duro: el quad es más ancho que la línea visible, y
        // esa banda de más es la que antialía el borde por sí sola. Subir el
        // exponente afina la línea sin adelgazar el quad, que es lo que la
        // deja limpia en vez de gris.
        `float d = abs(vUv.y);
         float nucleo = exp(-d * d * 11.0);
         float halo   = exp(-d * 2.6) * 0.20;
         // El centro casi a blanco: una línea estrecha y muy brillante se lee
         // afilada; una estrecha y tenue se lee simplemente débil.
         vec3 col = mix(uCian, vec3(1.0), nucleo * 0.24) * (0.6 + uEnergia * 0.7);
         col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
         gl_FragColor = vec4(col, alpha * (nucleo + halo) * uIntensidad);`);
    materialesLinea.push(m);
    return m;
  }

  const planoUnidad = new THREE.PlaneGeometry(1, 1);
  const matCascara  = materialCascara();
  const matFina     = materialLinea(CIAN, cfg.grosorFino, cfg.ganFina);
  const matPrincipal= materialLinea(CIAN, cfg.grosor, 1);
  const matVertices = materialPuntos(CIAN, 0.0075, 0.014, 1.45);
  const matCampo    = materialPuntos(CIAN, 0.005, 0.015, 0.62);
  const matCadena   = materialLinea(NARANJA, cfg.grosor * 1.25, 1.75);

  function nube(pos, brillo, material, destino) {
    const g = instanciar(planoUnidad, brillo.length);
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute('aBrillo', new THREE.InstancedBufferAttribute(brillo, 1));
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    destino.add(m);
    return m;
  }

  function malla(posiciones, material, destino) {
    const g = new LineSegmentsGeometry();
    g.setPositions(posiciones);
    const l = new LineSegments2(g, material);
    l.frustumCulled = false;
    destino.add(l);
    return l;
  }

  // ─────────────────────────────────────────────── las dos mallas
  //
  // Se construyen las dos al arrancar y se alterna la visibilidad. Cuesta unas
  // decenas de milisegundos más al cargar, pero el cambio es instantáneo, que
  // es justo lo que hace falta para poder compararlas.
  function montarMalla(datos) {
    const g = new THREE.Group();
    malla(datos.aristasFinas, matFina, g);       // nivel 2, fondo
    g.add(Object.assign(new THREE.Mesh(datos.cascara, matCascara), { frustumCulled: false }));
    malla(datos.aristas, matPrincipal, g);       // nivel 1, estructura
    nube(datos.puntos, datos.brilloPunto, matVertices, g);
    grupo.add(g);
    return g;
  }

  const vor = construirCeldas(THREE, { nCeldas: cfg.celdas, semilla, variacion: 1 });
  const vorFina = construirCeldas(THREE, {
    nCeldas: cfg.celdasFinas, semilla: (semilla || 20260815) + 7717, variacion: 0.75,
  });
  const geo = construirGeodesica(THREE, { detalle: cfg.geoDetalle, semilla });
  const geoFina = construirGeodesica(THREE, { detalle: cfg.geoDetalleFino, semilla: (semilla || 20260815) + 31 });

  const MALLAS = {
    voronoi:   { ...vor, aristasFinas: vorFina.aristas, nSegmentosFinos: vorFina.nSegmentos, vertices: null },
    geodesica: { ...geo, aristasFinas: geoFina.aristas, nSegmentosFinos: geoFina.nSegmentos },
  };

  const grupos = {
    voronoi:   montarMalla(MALLAS.voronoi),
    geodesica: montarMalla(MALLAS.geodesica),
  };

  let tipo = (geometria === 'geodesica') ? 'geodesica' : 'voronoi';

  // Campo interior: común a las dos, fuera de los grupos conmutables.
  const campo = campoInterior(cfg.puntosInterior);
  nube(campo.pos, campo.brillo, matCampo, grupo);

  // ── atmósfera ──
  // Muy floja: el resplandor lo ponen los puntos y las aristas. Esto solo
  // asienta la silueta, y de más lavaría el negro del fondo.
  const matAtmosfera = new THREE.ShaderMaterial({
    uniforms: { uAtmosfera: { value: cfg.atmosfera }, uFrescura, uEnergia,
      uColor: { value: CIAN.clone() }, uSilueta: { value: 0.545 } },
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
        float dentro = smoothstep(uSilueta - 0.05, uSilueta - 0.005, r);
        float fuera  = exp(-pow(max(0.0, r - uSilueta) / 0.07, 2.0));
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
    for (const [radio, inclinacion, alfa] of [[1.14, 0.05, 0.14], [1.24, -0.09, 0.09], [1.36, 0.13, 0.05]]) {
      const pts = [];
      const N = 160;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, b = ((i + 1) / N) * Math.PI * 2;
        pts.push(Math.cos(a) * radio, 0, Math.sin(a) * radio,
                 Math.cos(b) * radio, 0, Math.sin(b) * radio);
      }
      const g = new LineSegmentsGeometry();
      g.setPositions(new Float32Array(pts));
      const m = new LineMaterial({ color: 0x2ad4f0, linewidth: 0.9, transparent: true,
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
  // ⚠ LA CADENA ES ADORNO, NO UN DATO. No representa ninguna conexión: los
  // validadores corren todos en la misma máquina y no se hablan entre ellos, y
  // además une los nodos por orden de índice, que es arbitrario. Queda escrito
  // aquí para que nadie —nosotros dentro de unos meses incluidos— la lea como
  // si dijera algo sobre la topología.
  let nNodos = 0, mallaNodos = null, mallaCadena = null, atlas = null;
  let intensidades = [];

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
        // Aro fino y de bordes cortos: el ancho de transición marca lo afilado
        // que se ve el anillo.
        float aro  = smoothstep(0.60, 0.645, r) * (1.0 - smoothstep(0.715, 0.76, r));
        float glow = exp(-pow((r - 0.68) / 0.26, 2.0)) * 0.24;
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

    // En la geodésica los nodos se clavan en vértices reales de la malla; en
    // el Voronoi se quedan en las direcciones de Fibonacci.
    const base = direccionesFibonacci(n);
    const verts = MALLAS[tipo].vertices;
    const dirs = verts ? ajustarAVertices(base, verts) : base;

    const aDir = new Float32Array(n * 3);
    const aInt = new Float32Array(n);
    const aIdx = new Float32Array(n);
    dirs.forEach((d, i) => {
      aDir[i * 3] = d.x; aDir[i * 3 + 1] = d.y; aDir[i * 3 + 2] = d.z;
      aInt[i] = intensidades[i] ?? 0.5; aIdx[i] = i;
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

    if (n >= 2) {
      const TROZOS = 14;
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

  function aplicarTipo() {
    grupos.voronoi.visible   = tipo === 'voronoi';
    grupos.geodesica.visible = tipo === 'geodesica';
    if (nNodos) construirNodos(nNodos);   // las posiciones cambian con la malla
  }
  aplicarTipo();

  // ─────────────────────────────────────────────── tamaño y zoom
  let ancho = 1, alto = 1, distanciaBase = 3.05, zoom = 1;
  const ZOOM_MIN = 0.72, ZOOM_MAX = 2.2;

  function aplicarCamara() {
    camara.position.z = distanciaBase / zoom;
    camara.updateProjectionMatrix();
    const d = camara.position.z;
    const silueta = 1 / Math.sqrt(Math.max(1e-4, 1 - 1 / (d * d)));
    matAtmosfera.uniforms.uSilueta.value = silueta / 2.0;
  }

  function medir() {
    const r = contenedor.getBoundingClientRect();
    ancho = Math.max(1, Math.round(r.width));
    alto  = Math.max(1, Math.round(r.height));
    // Topado a 2: pasar a 3 multiplica por 2,25 los píxeles a rellenar sin que
    // se aprecie. La nitidez no está aquí, está en las líneas y el contraste.
    const dpr = Math.min(window.devicePixelRatio || 1, cfg.dprMax);
    renderer.setPixelRatio(dpr);
    renderer.setSize(ancho, alto, false);
    camara.aspect = ancho / alto;

    // `fov` es el VERTICAL: en pantalla estrecha y alta el ángulo horizontal
    // es mucho menor y la esfera se saldría por los lados.
    const MARGEN = 1.18;
    const vFov = camara.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camara.aspect);
    distanciaBase = Math.max(MARGEN / Math.tan(vFov / 2), MARGEN / Math.tan(hFov / 2));
    aplicarCamara();

    for (const m of materialesLinea) m.resolution.set(ancho * dpr, alto * dpr);
  }
  const observador = new ResizeObserver(medir);
  observador.observe(contenedor);
  medir();

  // ─────────────────────────────────────────────── interacción
  let girX = 0, girY = 0, velX = 0, velY = 0;
  let arrastrando = false, ultX = 0, ultY = 0;
  const punteros = new Map();
  let pellizcoPrevio = 0;

  const lienzo = renderer.domElement;

  lienzo.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.buttons !== 1) return;
    punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (punteros.size === 1) { arrastrando = true; ultX = ev.clientX; ultY = ev.clientY; }
    else { arrastrando = false; pellizcoPrevio = 0; }
    try { lienzo.setPointerCapture(ev.pointerId); } catch {}
  });

  lienzo.addEventListener('pointermove', ev => {
    if (!punteros.has(ev.pointerId)) return;
    // Sin botón pulsado no hay gesto: sobrevolar no debe mover nada.
    if (!ev.buttons) { punteros.delete(ev.pointerId); arrastrando = false; return; }
    punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (punteros.size >= 2) {
      // Pellizco: la distancia entre los dos primeros dedos manda el zoom.
      const [a, b] = [...punteros.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pellizcoPrevio > 0 && dist > 0) {
        zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * (dist / pellizcoPrevio)));
        aplicarCamara();
      }
      pellizcoPrevio = dist;
      return;
    }

    if (arrastrando) {
      velY += (ev.clientX - ultX) * 0.00042;
      velX += (ev.clientY - ultY) * 0.00042;
      ultX = ev.clientX; ultY = ev.clientY;
    }
  });

  const soltar = ev => {
    punteros.delete(ev.pointerId);
    if (punteros.size < 2) pellizcoPrevio = 0;
    if (punteros.size === 0) arrastrando = false;
    try { lienzo.releasePointerCapture(ev.pointerId); } catch {}
  };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);

  lienzo.addEventListener('wheel', ev => {
    ev.preventDefault();
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(-ev.deltaY * 0.0012)));
    aplicarCamara();
  }, { passive: false });

  // ─────────────────────────────────────────────── estado de la app
  let energiaObjetivo = 0.5, frescuraObjetivo = 1;

  function actualizar(estado) {
    if (!estado) return;
    const lista = estado.nodos || [];
    intensidades = lista.map(v => Math.max(0, Math.min(1, v.intensidad ?? 0.5)));
    if (lista.length !== nNodos) construirNodos(lista.length);
    else if (mallaNodos) {
      const att = mallaNodos.geometry.getAttribute('aInt');
      for (let i = 0; i < intensidades.length; i++) att.array[i] = intensidades[i];
      att.needsUpdate = true;
    }
    if (estado.energia  != null) energiaObjetivo  = Math.max(0, Math.min(1, estado.energia));
    if (estado.frescura != null) frescuraObjetivo = Math.max(0, Math.min(1, estado.frescura));
  }

  // ─────────────────────────────────────────────── bucle
  const vigilante = new Vigilante(() => {
    // Lo único barato que queda es bajar resolución. La geometría no se toca:
    // rehacerla a mitad de sesión daría un tirón y cambiaría el dibujo delante
    // del usuario.
    if (cfg.dprMax > 1.0) { cfg.dprMax = Math.max(1.0, cfg.dprMax - 0.25); medir(); return true; }
    return false;
  });

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
    uEnergia.value  += (energiaObjetivo  - uEnergia.value)  * k * 0.5;
    uFrescura.value += (frescuraObjetivo - uFrescura.value) * k * 0.5;

    renderer.render(escena, camara);
  }

  const alVer = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
  alVer.observe(contenedor);
  const alCambiarPestana = () => { visible = !document.hidden; ultimo = performance.now(); };
  document.addEventListener('visibilitychange', alCambiarPestana);

  raf = requestAnimationFrame(bucle);

  return {
    actualizar,
    /** Provisional: para comparar las dos mallas mirándolas. */
    setGeometria(t) {
      const nuevo = (t === 'geodesica') ? 'geodesica' : 'voronoi';
      if (nuevo === tipo) return tipo;
      tipo = nuevo;
      aplicarTipo();
      return tipo;
    },
    getGeometria: () => tipo,
    info: () => {
      const m = MALLAS[tipo];
      return {
        escalon: nombreEscalon, geometria: tipo, fps, fotogramas,
        celdas: m.nCeldas, segmentos: m.nSegmentos, segmentosFinos: m.nSegmentosFinos,
        vertices: m.nPuntos, triangulos: m.nTriangulos,
        detalle: m.detalle ?? null,
        puntosInterior: campo.n,
        msGeometria: vor.ms + vorFina.ms + geo.ms + geoFina.ms,
        nodos: nNodos, dpr: renderer.getPixelRatio(), zoom: +zoom.toFixed(2),
        ancho, alto, visible, respiracion: uniformes.uRespiracion.value,
        llamadas: renderer.info.render.calls, reducido,
        antialias: renderer.getContext().getContextAttributes().antialias,
      };
    },
    destruir() {
      cancelAnimationFrame(raf);
      observador.disconnect(); alVer.disconnect();
      document.removeEventListener('visibilitychange', alCambiarPestana);
      if (atlas) atlas.tex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
