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
 * ## Por qué Voronoi y no una geodésica
 *
 * Hubo un conmutador provisional entre las dos, y se decidió mirándolas. La
 * geodésica se descartó por dos motivos:
 *
 *   · Sus triángulos son regulares, y a esta densidad las filas de aristas
 *     interfieren entre sí y con la rejilla de píxeles: hace muaré, con una
 *     costura visible donde se alinean las filas del icosaedro. En movimiento
 *     es peor que en una captura. El Voronoi no puede hacerlo porque no tiene
 *     dos aristas paralelas repitiéndose — la irregularidad, que se buscó por
 *     estética, además protege de eso.
 *   · Una malla regular dice «esfera»; una irregular dice «red». Esto es una
 *     red.
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

import { construirCeldas, campoInterior } from './celdas.js';
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

/* ─────────────────────────────────────────────── constelación
   Tamaño del quad de cada nodo, en unidades de `cfg.halo`. El rango es lo que
   separa visualmente al de un bloque del de siete: con 0,085..0,205 el mayor
   mide 2,4 veces el menor, que se distingue de un vistazo sin que el grande se
   coma la malla. El núcleo mide siempre 0,052, en las mismas unidades. */
const TAM_MIN = 0.070;
const TAM_RANGO = 0.170;
const NUCLEO = 0.050;

/* Cuánto crece el NÚCLEO con los bloques, además del halo.
   Primera versión: el núcleo era de tamaño fijo y solo crecía el halo. En
   captura no se leía — con el halo a 0,30 sobre negro, lo único que se ve es el
   punto, y todos los puntos medían igual. La codificación estaba, pero no se
   veía, que para el caso es no estar. Ahora el núcleo también crece, la mitad
   que el halo: el de siete bloques mide 1,55 veces el de uno. */
const NUCLEO_CRECE = 0.55;

/** Geometría instanciada a partir de una base, sin usar instanceMatrix. */
function instanciar(base, n) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  g.instanceCount = n;
  return g;
}

export function crearEsfera(contenedor, { escalon = null, semilla, alSenalar = null } = {}) {
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

  const MALLA = { ...vor, aristasFinas: vorFina.aristas, nSegmentosFinos: vorFina.nSegmentos };
  montarMalla(MALLA);

  // Campo interior.
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
  let nNodos = 0, mallaNodos = null, mallaCadena = null;
  let intensidades = [], activos = [], metaNodos = [], dirNodos = [];

  /**
   * CONSTELACIÓN. Cada validador es un punto brillante con un halo.
   *
   * ⚠ Antes eran anillos naranjas con el número dentro, dibujado desde un atlas
   *   de canvas. Se fue entero: los números flotando sobre una esfera son un
   *   cliché, ensucian la malla y a 390px no se leen. El índice ahora aparece
   *   solo al señalar un nodo, y en HTML — texto de verdad, nítido a cualquier
   *   densidad, y sin una textura que subir a la GPU.
   *
   * ## Qué codifica el tamaño
   *
   * El HALO crece con `aInt`, que son los bloques propuestos. El NÚCLEO no: se
   * mantiene del mismo tamaño en pantalla para todos, porque todos son
   * validadores tuyos y todos están validando. Lo que varía es el premio que
   * les ha tocado, y eso es el halo.
   *
   *   Que el núcleo no escale con el quad hace falta forzarlo: el quad SÍ crece
   *   con `aInt` —si no, el halo del que más bloques lleva saldría recortado—,
   *   así que el radio del núcleo se divide por ese mismo factor. Sin esa
   *   división, el nodo de siete bloques tendría también el punto siete veces
   *   más gordo y la esfera se llenaría de manchas.
   *
   * ## Que no aplaste la malla
   *
   * El halo va en mezcla aditiva y se acumula, así que su pico se queda bajo
   * (0,30) y es el núcleo el que lleva el brillo. Comprobado en captura: la
   * retícula se sigue leyendo por debajo de los nodos, que era la condición.
   */
  const matNodo = new THREE.ShaderMaterial({
    uniforms: { ...uniformes, uFrescura, uEnergia,
      uTam: { value: cfg.halo }, uColor: { value: NARANJA.clone() },
      uSenalado: { value: -1 } },
    vertexShader: /* glsl */`
      #include <common>
      ${UNIFORMS_DEFORMACION}
      ${FUNCION_DEFORMACION}
      attribute vec3 aDir;
      attribute float aInt;
      attribute float aAct;
      attribute float aIndice;
      uniform float uTam;
      uniform float uSenalado;
      varying vec2 vP; varying float vI; varying float vAct; varying float vSen;
      void main(){
        vP = position.xy; vI = aInt; vAct = aAct;
        vSen = abs(aIndice - uSenalado) < 0.5 ? 1.0 : 0.0;
        // El quad crece con la intensidad para que quepa el halo. El núcleo se
        // compensa en el fragmento para no crecer con él.
        float s = TAM_MIN + aInt * TAM_RANGO;
        vec4 mv = modelViewMatrix * vec4(deformar(aDir), 1.0);
        mv.xy += position.xy * s * uTam * (1.0 + vSen * 0.18);
        gl_Position = projectionMatrix * mv;
      }`
      .replace(/TAM_MIN/g, TAM_MIN.toFixed(3))
      .replace(/TAM_RANGO/g, TAM_RANGO.toFixed(3)),
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uFrescura; uniform float uEnergia;
      varying vec2 vP; varying float vI; varying float vAct; varying float vSen;
      void main(){
        float r = length(vP) * 2.0;

        // Radio del núcleo en unidades del quad. Se divide por el mismo factor
        // que escaló el quad, así que en pantalla mide igual para todos.
        float s = TAM_MIN + vI * TAM_RANGO;
        float rn = NUCLEO * (1.0 + vI * NUCLEO_CRECE) / s;
        float nucleo = 1.0 - smoothstep(rn * 0.45, rn, r);

        // Halo gaussiano. Su ANCHO es fijo en unidades del quad, así que crece
        // en pantalla exactamente con el quad: ahí está el dato.
        float halo = exp(-pow(r / 0.58, 2.0)) * 0.42;

        // Un validador fuera de juego pierde el halo y se queda en un punto
        // apagado: sigue estando —es tuyo— pero deja de brillar.
        halo *= vAct;
        float i = nucleo * (0.85 + vI * 0.55) + halo * (0.55 + vI * 0.9);
        i *= (0.45 + vAct * 0.55);
        i *= (1.0 + vSen * 0.85);
        if (i < 0.004) discard;

        // El núcleo tira a blanco y el halo se queda naranja: es lo que lo hace
        // leerse como una estrella y no como un borrón de color.
        vec3 c = mix(uColor, vec3(1.0), nucleo * 0.80);
        c *= (0.75 + uEnergia * 0.5);
        c = mix(vec3(dot(c, vec3(0.33))), c, uFrescura);
        gl_FragColor = vec4(c * i, i);
      }`
      .replace(/TAM_MIN/g, TAM_MIN.toFixed(3))
      .replace(/TAM_RANGO/g, TAM_RANGO.toFixed(3))
      .replace(/NUCLEO_CRECE/g, NUCLEO_CRECE.toFixed(3))
      .replace(/NUCLEO/g, NUCLEO.toFixed(4)),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  function construirNodos(n) {
    for (const m of [mallaNodos, mallaCadena]) {
      if (m) { grupo.remove(m); m.geometry.dispose(); }
    }
    mallaNodos = mallaCadena = null;
    nNodos = n;
    if (n === 0) return;

    // Direcciones de Fibonacci: reparto uniforme sobre la esfera, sin clavar
    // los nodos en vértices de la malla. Son decoración, no topología.
    const dirs = direccionesFibonacci(n);

    const aDir = new Float32Array(n * 3);
    const aInt = new Float32Array(n);
    const aAct = new Float32Array(n);
    const aIdx = new Float32Array(n);
    dirs.forEach((d, i) => {
      aDir[i * 3] = d.x; aDir[i * 3 + 1] = d.y; aDir[i * 3 + 2] = d.z;
      aInt[i] = intensidades[i] ?? 0.5;
      aAct[i] = activos[i] === false ? 0 : 1;
      aIdx[i] = i;
    });
    // Las direcciones se guardan para poder saber qué nodo hay bajo el dedo.
    dirNodos = dirs;

    const g = instanciar(planoUnidad, n);
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(aDir, 3));
    g.setAttribute('aInt', new THREE.InstancedBufferAttribute(aInt, 1));
    g.setAttribute('aAct', new THREE.InstancedBufferAttribute(aAct, 1));
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

  /* ─────────────────────────────────────────────── señalar un nodo

     Sustituye a los números pegados sobre la esfera: el índice del validador
     aparece solo cuando se señala uno, y lo pinta el DOM en HTML.

     ⚠ Se proyecta la dirección SIN DEFORMAR. La deformación es una respiración
       de ±0,7% del radio (ver `deformacion.js`), que a este tamaño son menos de
       dos píxeles: muy por debajo del radio de acierto. Replicar el GLSL en JS
       para ganar eso no compensa, y sería un segundo sitio donde la
       deformación podría discrepar de la del shader.

     Solo se aceptan los nodos de la cara de delante. Sin ese filtro, señalar
     uno de la mitad visible activaría también el que tiene justo detrás, y el
     rótulo saltaría entre dos validadores sin que el dedo se moviera. */

  const RADIO_ACIERTO = 26;          // px; el dedo es gordo y los nodos pequeños
  let senalado = -1;
  const vAux = new THREE.Vector3();

  /** Posición en pantalla de un nodo, o null si mira hacia atrás. */
  function enPantalla(i) {
    if (!dirNodos[i]) return null;
    vAux.copy(dirNodos[i]).applyMatrix4(grupo.matrixWorld);
    // Delante de la esfera: el vector cámara→nodo apunta hacia la cámara.
    if (vAux.clone().sub(camara.position).dot(vAux) > 0) return null;
    vAux.project(camara);
    return { x: (vAux.x * 0.5 + 0.5) * ancho, y: (-vAux.y * 0.5 + 0.5) * alto };
  }

  function avisar() {
    if (!alSenalar) return;
    if (senalado < 0) return alSenalar(null);
    const p = enPantalla(senalado);
    if (!p) return alSenalar(null);
    alSenalar({ ...metaNodos[senalado], x: p.x, y: p.y });
  }

  function alSenalarPuntero(ev) {
    // Mientras se gira la esfera no se señala: el rótulo persiguiendo al dedo
    // durante un arrastre estorba y no se lee.
    if (arrastrando || punteros.size > 0) { fijar(-1); return; }
    const caja = lienzo.getBoundingClientRect();
    const x = ev.clientX - caja.left, y = ev.clientY - caja.top;
    let mejor = -1, mejorD = RADIO_ACIERTO;
    for (let i = 0; i < nNodos; i++) {
      const p = enPantalla(i);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < mejorD) { mejorD = d; mejor = i; }
    }
    fijar(mejor);
  }

  function fijar(i) {
    if (i === senalado) return;
    senalado = i;
    matNodo.uniforms.uSenalado.value = i;
    avisar();
  }

  const alSenalarRef = alSenalarPuntero;
  const limpiarSenal = () => fijar(-1);
  lienzo.addEventListener('pointermove', alSenalarRef);
  lienzo.addEventListener('pointerleave', limpiarSenal);
  // En táctil no hay «pasar por encima»: se señala al tocar.
  lienzo.addEventListener('pointerdown', ev => {
    if (ev.pointerType !== 'mouse') alSenalarPuntero(ev);
  });

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
    activos = lista.map(v => v.activo !== false);
    // Lo que la esfera NO interpreta pero sí devuelve al señalar un nodo. Se
    // guarda tal cual: aquí no se sabe qué es un índice de validador.
    metaNodos = lista.map(v => ({ ...v }));
    if (lista.length !== nNodos) construirNodos(lista.length);
    else if (mallaNodos) {
      const aI = mallaNodos.geometry.getAttribute('aInt');
      const aA = mallaNodos.geometry.getAttribute('aAct');
      for (let i = 0; i < intensidades.length; i++) {
        aI.array[i] = intensidades[i];
        aA.array[i] = activos[i] === false ? 0 : 1;
      }
      aI.needsUpdate = true; aA.needsUpdate = true;
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

    // El rótulo del nodo señalado tiene que seguirlo mientras la esfera gira.
    // Va DESPUÉS del render, que es cuando `matrixWorld` ya está al día.
    if (senalado >= 0) avisar();
  }

  const alVer = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
  alVer.observe(contenedor);
  const alCambiarPestana = () => { visible = !document.hidden; ultimo = performance.now(); };
  document.addEventListener('visibilitychange', alCambiarPestana);

  raf = requestAnimationFrame(bucle);

  return {
    actualizar,
    info: () => {
      const m = MALLA;
      return {
        escalon: nombreEscalon, fps, fotogramas,
        celdas: m.nCeldas, segmentos: m.nSegmentos, segmentosFinos: m.nSegmentosFinos,
        vertices: m.nPuntos, triangulos: m.nTriangulos,
        puntosInterior: campo.n,
        msGeometria: vor.ms + vorFina.ms,
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
      lienzo.removeEventListener('pointermove', alSenalarRef);
      lienzo.removeEventListener('pointerleave', limpiarSenal);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
