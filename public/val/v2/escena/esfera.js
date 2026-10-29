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
 *   núcleo           plasma dentro; crece con el ciclo     → lo generado sin barrer
 *   pulsos           luz que viaja por las aristas         → vida, no dato
 *
 * Y por encima, desde el 29-oct-2026, un resplandor (bloom) en los tres
 * escalones. Ver `calidad.js` para por qué vuelve y con qué regla.
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
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

import { construirCeldas, campoInterior } from './celdas.js';
import { ESCALONES, elegirEscalon, Vigilante } from './calidad.js';
import { crearUniformsDeformacion, inyectar, UNIFORMS_DEFORMACION, FUNCION_DEFORMACION } from './deformacion.js';

/* ─────────────────────────────────────────────── el color, del tema

   La esfera lee EXACTAMENTE DOS tokens del CSS: `--dato` y `--acento`. Ni uno
   más, y eso fue una decisión: meter el tema entero en el shader habría
   significado seis uniformes nuevos, seis rutas de actualización y una
   comprobación por tema. Con dos, la escena sigue el tema sin saber que existen
   los temas.

   El tercer color —la cáscara— se DERIVA del primero bajándole el brillo, en
   vez de ser un token propio: es el mismo cian oscurecido que había antes, solo
   que ahora el «cian» lo pone el tema.

   ⚠ Los valores de aquí son solo el respaldo para cuando el CSS todavía no ha
     cargado. En cuanto hay hoja de estilo mandan los tokens. */
const CIAN     = new THREE.Color(0x2ad4f0);
const CIAN_OSC = new THREE.Color(0x0b4a68);
const NARANJA  = new THREE.Color(0xff8a3d);

/** Lee un token de color del CSS. Devuelve null si no hay o no se entiende. */
function tokenColor(nombre) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    if (!v) return null;
    const c = new THREE.Color();
    c.setStyle(v);            // acepta #rgb, #rrggbb, rgb(), hsl()
    return c;
  } catch {
    return null;
  }
}
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
   Tamaño del quad de cada nodo, en unidades de `cfg.halo`. El quad marca hasta
   dónde llega el HALO; el núcleo es el punto brillante de dentro y su radio en
   pantalla es `NUCLEO · (1 + intensidad · NUCLEO_CRECE)`, independiente del
   quad (el fragmento lo divide por el mismo factor que escaló el quad).

   ── Recalibrado el 12-sep-2026, y esta vez MEDIDO EN PÍXELES ──────────────

   Lo de antes (TAM_MIN 0,070 · TAM_RANGO 0,170 · NUCLEO 0,050 · CRECE 0,55)
   se calibró con un rango de 1 a 7 bloques, y el comentario afirmaba «el de
   siete mide 1,55 veces el de uno». Esa cuenta estaba mal: salía de comparar
   contra intensidad 0, y el de un bloque no valía 0 sino 0,38 por el suelo del
   mapeo. El ratio real era 1,28 entonces y 1,34 con el rango de hoy (0..13).

   Medido de verdad —capturando la esfera y midiendo el diámetro de cada
   núcleo, catorce fotogramas, con una pasada de control en la que TODOS los
   validadores tienen los mismos bloques para saber cuánto ensucia la
   perspectiva— salía esto:

     ruido de la perspectiva (control):  1,61×
     dispersión medida (0..13):          1,88×
     señal neta:                         1,17×

   O sea: la diferencia entre el que tiene 0 bloques y el que tiene 13 era de
   un 17 %, enterrada bajo un 61 % que solo dependía de a qué lado de la esfera
   hubiera caído el nodo. Por eso no se distinguía: el ruido era tres veces y
   media la señal.

   Se arreglan las dos cosas. El rango, aquí. El ruido, con `COMPENSA_PROF`. */
const TAM_MIN = 0.092;
const TAM_RANGO = 0.148;      // el máximo sigue en 0,240: el halo NO crece más
const NUCLEO = 0.052;

/* Cuánto crece el NÚCLEO con la intensidad, además del halo.
   El núcleo es lo que de verdad se ve —con el halo bajo y sobre negro, el ojo
   lee el punto—, así que es donde tiene que estar el rango. De 0,55 a 1,30:
   el radio del núcleo va de 0,052 a 0,120, o sea 2,30× en radio y 5,3× en
   área. El halo va de 0,092 a 0,240 (2,61×) SIN subir el tope de antes, que
   era la condición para que no aplaste la malla. */
const NUCLEO_CRECE = 1.30;

/* Cuánto se corrige el encogimiento por distancia.
   La cámara está a 3,05 del centro y la esfera tiene radio 1, así que un nodo
   de la cara de atrás se proyecta 1,98 veces más pequeño que uno de delante
   sin que eso signifique NADA: es el mismo validador. Medido, ese ruido era
   1,61× y se comía la codificación entera.

   A 1 el tamaño en pantalla no dependería de la profundidad en absoluto. Se
   deja en 0,80 y no en 1: los nodos no se tapan entre sí —van en mezcla
   aditiva y sin prueba de profundidad—, así que el tamaño es la única pista de
   que la esfera es una esfera, y quitarla del todo la aplana. Con 0,80 el
   ruido residual baja a ~1,15×, muy por debajo de la señal. */
const COMPENSA_PROF = 0.80;

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
    // Siempre activo. Con el resplandor puesto no se dibuja al framebuffer por
    // defecto sino a un objetivo propio, que lleva su propio MSAA (ver
    // `objetivo` más abajo); este cubre el camino directo, cuando el vigilante
    // apaga el resplandor en una máquina que no puede.
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

  /* ── el resplandor ──────────────────────────────────────────────────────
     ⚠ EL MSAA SE PIERDE SI NO SE PIDE. Al dibujar a un objetivo intermedio el
       `antialias` del renderer ya no aplica, y las siluetas salen en escalera:
       justo lo que el antialias quitaba. El objetivo se crea con `samples: 4`,
       que es MSAA en WebGL2. Media precisión para que el bloom tenga brillo
       por encima de 1 con el que trabajar.

     `escalaBloom` reduce la resolución a la que se calcula el resplandor, no
     la de la escena: el bloom es borroso por definición y a mitad de
     resolución no se nota, pero cuesta la cuarta parte. */
  const objetivo = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, objetivo);
  composer.addPass(new RenderPass(escena, camara));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), cfg.bloom.fuerza, cfg.bloom.radio, cfg.bloom.umbral);
  let escalaBloom = cfg.bloom.escala;
  const tamBloomOriginal = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => tamBloomOriginal(Math.max(1, Math.round(w * escalaBloom)), Math.max(1, Math.round(h * escalaBloom)));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let conBloom = true;

  const uniformes = crearUniformsDeformacion();
  uniformes.uRespiracion.value = reducido ? 0 : 1;
  const uFrescura = { value: 1 };
  const uEnergia  = { value: 0.5 };
  /* La onda del destello. `uDestDir` es la dirección del nodo que propuso el
     bloque —o sea, DÓNDE pasó— y `uDestT` los segundos desde entonces. La malla
     los usa para encender un anillo que sale de ahí y recorre la esfera. */
  const uDestDir = { value: new THREE.Vector3(0, 1, 0) };
  const uDestTM  = { value: -1 };
  /* El barrido: 0..1 mientras dura el golpe, 0 el resto. Lo leen las líneas,
     los puntos y los nodos. Y el foco: 0..1 mientras hay un validador
     acercado; apaga un poco el resto para que el elegido se lea solo. */
  const uBarrido = { value: 0 };
  const uFoco = { value: 0 };
  const materialesLinea = [];

  // ─────────────────────────────────────────────── materiales
  function materialCascara() {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniformes, uFrescura, uEnergia, uDestDir, uDestT: uDestTM,
                  uColor: { value: CIAN_OSC.clone() } },
      vertexShader: /* glsl */`
        #include <common>
        ${UNIFORMS_DEFORMACION}
        ${FUNCION_DEFORMACION}
        attribute float aTono;
        uniform vec3 uDestDir;
        varying float vTono; varying float vBorde; varying float vAng; varying float vToque;
        varying float vNace;
        void main(){
          vTono = aTono;
          vToque = ondaToque(normalize(position));
          // Apelotonada en el punto inicial de la ignición, no se dibuja.
          vNace = smoothstep(0.11, 0.17, uNacer);
          // Distancia ANGULAR al punto donde cayó el bloque, de 0 a 1. Sobre
          // una esfera es la distancia de verdad: la onda recorre la superficie
          // igual en todas direcciones en vez de deformarse con la proyección.
          vAng = acos(clamp(dot(normalize(position), normalize(uDestDir)), -1.0, 1.0)) / 3.14159265;
          vec3 p = deformar(position);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec3 nVista = normalize(normalMatrix * normalize(p));
          vBorde = 1.0 - abs(dot(nVista, normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uFrescura; uniform float uEnergia;
        uniform float uDestT;
        varying float vTono; varying float vBorde; varying float vAng; varying float vToque;
        varying float vNace;
        void main(){
          float borde = pow(vBorde, 3.0);
          float matiz = 0.55 + vTono * 0.45;

          /* La onda: un anillo estrecho que sale del nodo y llega al otro polo
             en 1,6 s, apagándose por el camino. Codifica dos cosas —DÓNDE cayó
             el bloque y CUÁNDO— y no se repite: pasa una vez por bloque.
             Se suma al brillo; no cambia la geometría. */
          float onda = 0.0;
          if (uDestT >= 0.0) {
            float frente = uDestT / 1.6;
            onda = smoothstep(0.09, 0.0, abs(vAng - frente))
                 * exp(-uDestT * 1.5) * (1.0 - smoothstep(0.85, 1.05, frente));
          }
          // Muy tenue: la cáscara insinúa volumen y enciende la silueta. Si
          // aporta de más, el negro entre celdas deja de ser negro y toda la
          // nitidez se va con él.
          vec3 col = uColor * matiz * (0.004 + borde * 0.20) * (0.5 + uEnergia * 0.7);
          col += uColor * onda * 0.75;
          col += uColor * vToque * 1.1;
          col *= vNace;
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
      uniforms: { ...uniformes, uFrescura, uEnergia, uBarrido,
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
        uniform float uBarrido; uniform float uNacer;
        varying vec2 vP; varying float vB;
        void main(){
          float d = length(vP) * 2.0;
          if (d > 1.0) discard;
          // Disco sólido con caída corta: núcleo, no mancha.
          float nucleo = 1.0 - smoothstep(0.30, 0.46, d);
          float halo   = exp(-d * 3.6) * 0.20;
          float i = nucleo + halo;
          vec3 col = mix(uColor, vec3(1.0), nucleo * 0.45) * vB * uGan * (0.75 + uEnergia * 0.75)
                   * (1.0 + uBarrido * 0.8);
          col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
          /* ⚠ Novecientos puntos apilados en el mismo píxel al empezar la
             ignición suman un brillo enorme, y el resplandor lo convierte en un
             CUADRADO borroso: así es como sale un punto saturado de las
             reducciones del bloom. Visto en tira a 390. */
          gl_FragColor = vec4(col, i * vB * uGan * smoothstep(0.11, 0.17, uNacer));
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  function materialLinea(color, grosor, ganancia) {
    const m = new LineMaterial({
      color: 0xffffff, linewidth: grosor,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    Object.assign(m.uniforms, uniformes, { uFrescura, uEnergia, uBarrido, uFoco,
      uCian: { value: color.clone() },
      uIntensidad: { value: cfg.intensidad * ganancia } });

    m.vertexShader = inyectar(m.vertexShader)
      .replace('uniform float linewidth;', 'uniform float linewidth;\n varying float vToque; varying float vCara;')
      .replace('vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
               'vec3 dirL = normalize(position.y < 0.5 ? instanceStart : instanceEnd);\n'
               + 'vToque = ondaToque(dirL);\n'
               + 'vCara = dot(normalize(normalMatrix * dirL), vec3(0.0, 0.0, 1.0));\n'
               + 'vec4 start = modelViewMatrix * vec4( deformar(instanceStart), 1.0 );')
      .replace('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
               'vec4 end = modelViewMatrix * vec4( deformar(instanceEnd), 1.0 );');

    m.fragmentShader = m.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFrescura; uniform float uEnergia; uniform float uIntensidad;
        uniform float uBarrido; uniform float uFoco; uniform float uNacer;
        uniform vec3 uCian;
        varying float vToque; varying float vCara;`)
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
         // La onda del toque y el golpe del barrido suben el brillo; el foco
         // lo baja, para que el validador acercado se lea solo.
         col *= (1.0 + vToque * 2.2 + uBarrido * 0.9) * (1.0 - uFoco * 0.4);
         /* ⚠ LA CARA DE ATRÁS, APAGADA. Sin esto las aristas de las dos caras
            se veían a la vez con el mismo brillo, cruzándose, y la red se
            leía como una maraña de palitos en vez de como celdas: era lo que
            hacía la esfera de antes tan densa a la vista, más que el número
            de celdas. Con la de atrás a un octavo, la de delante manda y la
            de atrás da profundidad. */
         col *= mix(0.12, 1.0, smoothstep(-0.15, 0.6, vCara));
         // En la ignición, mientras todo está en un punto, las líneas no se
         // dibujan: con su grosor, cada una apelotonada es un cuadrado.
         col *= smoothstep(0.11, 0.17, uNacer);
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
  const matCadena   = materialLinea(NARANJA, cfg.grosor * 1.1, 1.05);

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

  // Dos pasadas de Lloyd y media variación de densidad: celdas de tamaños
  // distintos pero sin las alargadas. Ver `relajar()` en celdas.js.
  const vor = construirCeldas(THREE, { nCeldas: cfg.celdas, semilla, variacion: 0.6, pasadas: 2 });
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
  // Fuera del bloque para que el nacimiento los pueda encender al final: no
  // usan `deformar()` y sin esto estarían puestos desde el primer fotograma,
  // flotando alrededor de un punto.
  const anillos = new THREE.Group();
  {
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
  let intensidades = [], activos = [], pendientes = [], metaNodos = [], dirNodos = [];

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
      uSenalado: { value: -1 },
      // Distancia cámara→centro. La pone `aplicarCamara()`, que es quien la
      // mueve con el zoom. Sin esto la compensación de profundidad se
      // descalibraría al hacer pellizco.
      uProf: { value: 3.05 },
      /* Destello de bloque. `uDestIdx` es el índice del validador que acaba de
         proponer uno; `uDestT`, los segundos transcurridos desde entonces, o
         -1 cuando no hay ninguno vivo. Ver `destello()` más abajo. */
      uDestIdx: { value: -1 }, uDestT: { value: -1 },
      /* El validador acercado (-1 = ninguno) y cuánto foco hay, 0..1. */
      uFocoIdx: { value: -1 }, uFoco,
      /* La ola del barrido: recorre los nodos en orden, segundos desde que
         empezó o -1. `uNumNodos` para que tarde lo mismo con 21 que con 40. */
      uBarT: { value: -1 }, uNumNodos: { value: 1 } },
    vertexShader: /* glsl */`
      #include <common>
      ${UNIFORMS_DEFORMACION}
      ${FUNCION_DEFORMACION}
      attribute vec3 aDir;
      attribute float aInt;
      attribute float aAct;
      attribute float aPend;
      attribute float aIndice;
      uniform float uTam;
      uniform float uProf;
      uniform float uSenalado;
      uniform float uDestIdx; uniform float uDestT;
      uniform float uFocoIdx; uniform float uBarT; uniform float uNumNodos;
      varying vec2 vP; varying float vI; varying float vAct; varying float vSen;
      varying float vDest; varying float vPul; varying float vFoc; varying float vOla;
      void main(){
        vP = position.xy; vI = aInt; vAct = aAct;
        vFoc = abs(aIndice - uFocoIdx) < 0.5 ? 1.0 : 0.0;
        // La ola del barrido pasa por cada nodo una vez, en 1,4 s para todos.
        vOla = uBarT < 0.0 ? 0.0 : exp(-pow((uBarT / 1.4 * uNumNodos - aIndice) * 0.55, 2.0));
        vOla += ondaToque(normalize(aDir)) * 0.8;
        /* EL LATIDO DEL QUE ESPERA TURNO.
           Un validador en cola no ha ganado nada y no tiene bloques: con los
           dos estados de antes se dibujaba igual que uno muerto. Late a ~0,42 Hz
           —lento, como una respiración— entre 0 y 1. No es una rueda de carga:
           es el mismo lenguaje que ya usa la esfera, brillo que sube y baja. */
        // Con movimiento reducido no late: se queda encendido y fijo. Sigue
        // distinguiéndose de un nodo muerto, que es lo que importa.
        vPul = aPend > 0.5 ? mix(0.62, 0.5 + 0.5 * sin(uTiempo * 2.6), uRespiracion) : 0.0;
        vSen = abs(aIndice - uSenalado) < 0.5 ? 1.0 : 0.0;
        // Envolvente del destello: sube en 120 ms y cae en ~1,4 s. Corta, para
        // que se lea como un golpe y no como una animación en bucle.
        float mio = abs(aIndice - uDestIdx) < 0.5 && uDestT >= 0.0 ? 1.0 : 0.0;
        vDest = mio * smoothstep(0.0, 0.12, uDestT) * exp(-uDestT * 2.1);
        // El quad crece con la intensidad para que quepa el halo. El núcleo se
        // compensa en el fragmento para no crecer con él.
        float s = TAM_MIN + aInt * TAM_RANGO;
        vec4 mv = modelViewMatrix * vec4(deformar(aDir), 1.0);
        /* ⚠ COMPENSACIÓN DE PROFUNDIDAD. El desplazamiento va en espacio de
           vista y luego pasa por la proyección, así que un nodo de la cara de
           atrás se dibuja ~2 veces más pequeño que uno de delante. Eso no
           significa nada —es el mismo validador— y medido se comía la
           codificación: 1,61× de ruido contra 1,17× de señal.

           Multiplicando por profundidad/uProf el tamaño en pantalla deja de
           depender del lado. COMPENSA_PROF gradúa cuánto se corrige; ver su
           constante para por qué no va a 1. */
        float comp = mix(1.0, max(-mv.z, 0.35) / uProf, COMPENSA_PROF);
        mv.xy += position.xy * s * uTam * comp
                 * (1.0 + vSen * 0.18 + vDest * 1.10 + vPul * 0.30 + vOla * 0.55 + vFoc * 0.25)
                 // En la ignición los nodos no existen hasta que la red ha caído.
                 * smoothstep(0.25, 0.45, uNacer);
        gl_Position = projectionMatrix * mv;
      }`
      .replace(/TAM_MIN/g, TAM_MIN.toFixed(3))
      .replace(/TAM_RANGO/g, TAM_RANGO.toFixed(3))
      .replace(/COMPENSA_PROF/g, COMPENSA_PROF.toFixed(3)),
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uFrescura; uniform float uEnergia;
      uniform float uFoco;
      varying vec2 vP; varying float vI; varying float vAct; varying float vSen;
      varying float vDest; varying float vPul; varying float vFoc; varying float vOla;
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
        // El que espera turno SÍ conserva el halo: no está fuera de juego, está
        // a punto de entrar, y es el halo el que respira.
        halo *= max(vAct, vPul);
        /* ⚠ EL SUELO DEL BRILLO SUBE porque el del dato ha bajado a cero.
           Antes la intensidad mínima era 0,28 —el suelo vivía en el mapeo— y
           el nodo más pequeño llegaba aquí con 0,85 + 0,28·0,55 = 1,00. Ahora
           llega con 0,00, así que el término base absorbe ese suelo: 0,92 en
           vez de 0,85, y el tope se queda exactamente donde estaba (1,40). Un
           validador con cero bloques sigue viéndose; lo que cambia es que ya
           no se le regala un trozo de la escala de tamaños. */
        float i = nucleo * (0.92 + vI * 0.48) + halo * (0.70 + vI * 0.75);
        i *= (0.45 + max(vAct, vPul * 0.85) * 0.55);
        i *= (1.0 + vSen * 0.85);
        // El destello suma un halo ancho además de subir el brillo: el punto
        // no solo se pone más fuerte, se HINCHA. Eso es lo que se ve de reojo.
        i += vDest * (exp(-pow(r / 1.15, 2.0)) * 0.9 + nucleo * 1.6);
        // Y un halo ancho propio, para que el latido se vea de reojo sin tener
        // que estar mirando ese punto.
        i += vPul * exp(-pow(r / 1.05, 2.0)) * 0.30;
        // La ola del barrido y la onda del toque: un golpe de luz al pasar.
        i += vOla * (exp(-pow(r / 0.9, 2.0)) * 0.7 + nucleo * 0.9);
        // Con un validador acercado, los demás se apagan a la mitad.
        i *= mix(1.0, vFoc > 0.5 ? 1.25 : 0.45, uFoco);
        if (i < 0.004) discard;

        // El núcleo tira a blanco y el halo se queda naranja: es lo que lo hace
        // leerse como una estrella y no como un borrón de color.
        vec3 c = mix(uColor, vec3(1.0), nucleo * 0.80);
        c = mix(c, vec3(1.0), clamp(vDest, 0.0, 1.0) * 0.55);   // el golpe va a blanco
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
    matNodo.uniforms.uNumNodos.value = Math.max(1, n);
    if (n === 0) return;

    // Direcciones de Fibonacci: reparto uniforme sobre la esfera, sin clavar
    // los nodos en vértices de la malla. Son decoración, no topología.
    const dirs = direccionesFibonacci(n);

    const aDir = new Float32Array(n * 3);
    const aInt = new Float32Array(n);
    const aAct = new Float32Array(n);
    const aPend = new Float32Array(n);
    const aIdx = new Float32Array(n);
    dirs.forEach((d, i) => {
      aDir[i * 3] = d.x; aDir[i * 3 + 1] = d.y; aDir[i * 3 + 2] = d.z;
      aInt[i] = intensidades[i] ?? 0.5;
      aAct[i] = activos[i] === false ? 0 : 1;
      aPend[i] = pendientes[i] === true ? 1 : 0;
      aIdx[i] = i;
    });
    // Las direcciones se guardan para poder saber qué nodo hay bajo el dedo.
    dirNodos = dirs;

    const g = instanciar(planoUnidad, n);
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(aDir, 3));
    g.setAttribute('aInt', new THREE.InstancedBufferAttribute(aInt, 1));
    g.setAttribute('aAct', new THREE.InstancedBufferAttribute(aAct, 1));
    g.setAttribute('aPend', new THREE.InstancedBufferAttribute(aPend, 1));
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


  // ─────────────────────────────────────────────── el núcleo
  //
  // Plasma dentro de la red. Su tamaño y su brillo son el AVANCE DEL CICLO DE
  // BARRIDO, el mismo dato que ya llevaba `uEnergia`: crece durante las ~8 h que
  // tarda en acumularse el excedente y se vacía cuando el protocolo lo retira.
  // A simple vista casi no se le ve crecer —son horas—; la descarga sí, porque
  // la dispara un hecho puntual: `barrido()`.
  //
  // Colores del tema: el centro caliente es `--acento`, el borde `--dato`.
  const RUIDO = /* glsl */`
    vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;}
    vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
    vec4 perm(vec4 x){return m289(((x*34.)+1.)*x);}
    vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
    float snoise(vec3 v){
      const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
      vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
      vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
      vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=m289(i);
      vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
      float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.*floor(p*ns.z*ns.z);
      vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_); vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
      vec4 h=1.-abs(x)-abs(y); vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
      vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
      vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
      vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
      vec4 norm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
      vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
      return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }`;
  const uCarga = { value: 0.5 };
  const uDescarga = { value: 0 };
  const matNucleo = new THREE.ShaderMaterial({
    uniforms: { uTiempo: uniformes.uTiempo, uRespiracion: uniformes.uRespiracion, uNacer: uniformes.uNacer,
      uCarga, uDescarga, uFrescura,
      uCaliente: { value: NARANJA.clone() }, uBorde: { value: CIAN.clone() } },
    vertexShader: RUIDO + /* glsl */`
      uniform float uTiempo; uniform float uRespiracion; uniform float uCarga;
      uniform float uDescarga; uniform float uNacer;
      varying vec3 vN; varying vec3 vV; varying float vR;
      void main(){
        // Con movimiento reducido el plasma casi no se mueve, pero no se congela:
        // un núcleo quieto del todo se lee como una bola, no como energía.
        float t = uTiempo * (0.2 + 0.8 * uRespiracion);
        float n = snoise(normal * 2.2 + t * 0.45);
        float n2 = snoise(normal * 5.0 - t * 0.8) * 0.4;
        vR = n;
        // En la ignición el núcleo ES el punto que estalla: empieza pequeño.
        float aparece = mix(0.25, 1.0, smoothstep(0.0, 0.45, uNacer));
        float r = (0.10 + uCarga * 0.20) * (1.0 + (n + n2) * 0.15) * (1.0 - uDescarga * 0.7) * aparece;
        vec4 mv = modelViewMatrix * vec4(normal * r, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uCarga; uniform float uDescarga; uniform float uFrescura; uniform float uNacer;
      uniform vec3 uCaliente; uniform vec3 uBorde;
      varying vec3 vN; varying vec3 vV; varying float vR;
      void main(){
        float nv = clamp(dot(vN, vV), 0.0, 1.0);
        /* Sin silueta dura: el borde se funde a negro y el centro arde. Con el
           borde del mismo brillo que el centro se leía como una piedra, no
           como plasma. */
        vec3 c = mix(uBorde * 0.6, uCaliente, smoothstep(0.2, 0.9, nv));
        c = mix(c, vec3(1.0), pow(nv, 6.0) * 0.35);
        c *= smoothstep(0.0, 0.55, nv);
        c *= (0.55 + vR * 0.35) * (0.25 + uCarga * 0.5 + uDescarga * 2.0);
        c *= 1.0 + (1.0 - smoothstep(0.05, 0.35, uNacer)) * 3.0;
        c = mix(vec3(dot(c, vec3(0.33))), c, uFrescura);
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const nucleo = new THREE.Mesh(new THREE.IcosahedronGeometry(1, cfg.nucleoDetalle), matNucleo);
  nucleo.frustumCulled = false;
  grupo.add(nucleo);

  // El halo del núcleo: un cuadro de cara a la cámara, como la atmósfera.
  const matAura = new THREE.ShaderMaterial({
    uniforms: { uCarga, uDescarga, uFrescura, uColor: { value: NARANJA.clone() } },
    vertexShader: /* glsl */`
      varying vec2 vP;
      void main(){
        vP = position.xy;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * 0.9;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uCarga; uniform float uDescarga; uniform float uFrescura; uniform vec3 uColor;
      varying vec2 vP;
      void main(){
        float r = length(vP);
        float g = exp(-pow(r / (0.28 + uCarga * 0.22), 2.0)) * (0.16 + uCarga * 0.26 + uDescarga * 0.8);
        vec3 c = uColor * g;
        c = mix(vec3(dot(c, vec3(0.33))), c, uFrescura);
        gl_FragColor = vec4(c, g);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matAura);
  aura.frustumCulled = false;
  grupo.add(aura);

  // La onda de choque del barrido: una cáscara que sale del núcleo.
  const uChoque = { value: -1 };
  const matChoque = new THREE.ShaderMaterial({
    uniforms: { uK: uChoque, uColor: { value: NARANJA.clone() } },
    vertexShader: /* glsl */`
      uniform float uK; varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position * (0.2 + max(uK, 0.0) * 1.15), 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uK; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
      void main(){
        if (uK < 0.0) discard;
        float f = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 2.5);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35) * f * (1.0 - uK) * 1.3, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const choque = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), matChoque);
  choque.frustumCulled = false;
  choque.visible = false;
  grupo.add(choque);

  // ─────────────────────────────────────────────── pulsos por la red
  //
  // Puntos de luz que recorren las aristas de la malla principal, de vértice en
  // vértice. NO SON UN DATO: no hay nada viajando entre celdas de verdad. Son
  // vida, como la respiración, y por eso con movimiento reducido no existen.
  // En un barrido se ponen en naranja y corren el triple durante un momento.
  const grafo = vor.grafo;
  const vecinos = grafo.vertices.map(() => []);
  for (let k = 0; k < grafo.pares.length; k += 2) {
    const a = grafo.pares[k], b = grafo.pares[k + 1];
    vecinos[a].push(b); vecinos[b].push(a);
  }
  const NPUL = reducido ? 0 : cfg.pulsos;
  const pulsos = Array.from({ length: NPUL }, () => {
    const a = Math.floor(Math.random() * grafo.vertices.length);
    return { a, b: vecinos[a][0] ?? a, s: Math.random(), vel: 0.45 + Math.random() * 0.6, naranja: 0 };
  });
  const pulDir = new Float32Array(NPUL * 2 * 3);
  const pulCola = new Float32Array(NPUL * 2);
  const pulNar = new Float32Array(NPUL * 2);
  for (let i = 0; i < NPUL; i++) pulCola[i * 2 + 1] = 1;
  const matPulso = new THREE.ShaderMaterial({
    uniforms: { ...uniformes, uFrescura, uFoco, uTam: { value: cfg.punto },
      uColor: { value: CIAN.clone() }, uNaranja: { value: NARANJA.clone() } },
    vertexShader: /* glsl */`
      #include <common>
      ${UNIFORMS_DEFORMACION}
      ${FUNCION_DEFORMACION}
      attribute vec3 aDir; attribute float aCola; attribute float aNar;
      uniform float uTam;
      varying vec2 vP; varying float vCola; varying float vNar;
      void main(){
        vP = position.xy; vCola = aCola; vNar = aNar;
        vec4 mv = modelViewMatrix * vec4(deformar(aDir) * 1.004, 1.0);
        mv.xy += position.xy * (aCola > 0.5 ? 0.012 : 0.02) * uTam;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform vec3 uNaranja; uniform float uFrescura; uniform float uFoco;
      uniform float uNacer;
      varying vec2 vP; varying float vCola; varying float vNar;
      void main(){
        float d = length(vP) * 2.0;
        if (d > 1.0) discard;
        float k = exp(-d * d * 4.0);
        vec3 c = mix(mix(uColor, vec3(1.0), 0.55), uNaranja, vNar);
        float a = k * (vCola > 0.5 ? 0.35 : 1.0) * (1.0 - uFoco * 0.6) * smoothstep(0.85, 1.0, uNacer);
        c = mix(vec3(dot(c, vec3(0.33))), c, uFrescura);
        gl_FragColor = vec4(c * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  let mallaPulsos = null;
  if (NPUL) {
    const g = instanciar(planoUnidad, NPUL * 2);
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(pulDir, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCola', new THREE.InstancedBufferAttribute(pulCola, 1));
    g.setAttribute('aNar', new THREE.InstancedBufferAttribute(pulNar, 1).setUsage(THREE.DynamicDrawUsage));
    mallaPulsos = new THREE.Mesh(g, matPulso);
    mallaPulsos.frustumCulled = false;
    grupo.add(mallaPulsos);
  }
  const vPul = new THREE.Vector3();
  function moverPulsos(dt) {
    if (!mallaPulsos) return;
    const V = grafo.vertices;
    for (let i = 0; i < NPUL; i++) {
      const p = pulsos[i];
      p.s += dt * p.vel * 1.4;
      while (p.s >= 1) {
        const antes = p.a; p.a = p.b;
        const vs = vecinos[p.a];
        const otros = vs.length > 1 ? vs.filter(x => x !== antes) : vs;
        p.b = otros[Math.floor(Math.random() * otros.length)] ?? antes;
        p.s -= 1;
      }
      p.naranja = Math.max(0, p.naranja - dt * 0.45);
      for (let k = 0; k < 2; k++) {
        const t = Math.max(0, p.s - k * 0.18);
        vPul.copy(V[p.a]).lerp(V[p.b], t).normalize();
        vPul.toArray(pulDir, (i * 2 + k) * 3);
        pulNar[i * 2 + k] = p.naranja;
      }
    }
    mallaPulsos.geometry.getAttribute('aDir').needsUpdate = true;
    mallaPulsos.geometry.getAttribute('aNar').needsUpdate = true;
  }

  // ─────────────────────────────────────────────── tamaño y zoom
  let ancho = 1, alto = 1, distanciaBase = 3.05, zoom = 1;
  const ZOOM_MIN = 0.72, ZOOM_MAX = 2.2;

  function aplicarCamara() {
    camara.position.z = distanciaBase / zoom;
    camara.updateProjectionMatrix();
    const d = camara.position.z;
    // La compensación de profundidad de los nodos se mide contra ESTA
    // distancia. Si no se actualizara, un pellizco descalibraría los tamaños.
    matNodo.uniforms.uProf.value = d;
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
    composer.setPixelRatio(dpr);
    composer.setSize(ancho, alto);
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

  /* El TOQUE: un pulsar y soltar casi sin moverse. Es lo que lanza la onda y
     lo que acerca un validador. Se distingue del arrastre por distancia y por
     tiempo, y un pellizco lo anula: dos dedos nunca son un toque. */
  let toque = null;

  lienzo.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.buttons !== 1) return;
    toque = punteros.size === 0 ? { x: ev.clientX, y: ev.clientY, t: performance.now() } : null;
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
        zoomObjetivo = null;
        aplicarCamara();
      }
      pellizcoPrevio = dist;
      return;
    }

    if (arrastrando) {
      velY += (ev.clientX - ultX) * 0.00042;
      velX += (ev.clientY - ultY) * 0.00042;
      ultX = ev.clientX; ultY = ev.clientY;
      // Girarla a mano suelta el validador acercado: la mano manda.
      if (toque && Math.hypot(ev.clientX - toque.x, ev.clientY - toque.y) > 7) {
        toque = null;
        if (focoIdx >= 0) soltarFoco();
      }
    }
  });

  const soltar = ev => {
    punteros.delete(ev.pointerId);
    if (punteros.size < 2) pellizcoPrevio = 0;
    if (punteros.size >= 1) toque = null;          // era un pellizco
    if (punteros.size === 0) {
      arrastrando = false;
      if (toque && ev.type === 'pointerup'
          && Math.hypot(ev.clientX - toque.x, ev.clientY - toque.y) < 7
          && performance.now() - toque.t < 400) tocar(ev);
      toque = null;
    }
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
    // Con un validador acercado, el rótulo es el suyo y no se mueve.
    if (focoIdx >= 0) return;
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
  const limpiarSenal = () => { if (focoIdx < 0) fijar(-1); };
  lienzo.addEventListener('pointermove', alSenalarRef);
  lienzo.addEventListener('pointerleave', limpiarSenal);
  // En táctil no hay «pasar por encima»: se señala al tocar.
  lienzo.addEventListener('pointerdown', ev => {
    if (ev.pointerType !== 'mouse') alSenalarPuntero(ev);
  });

  /* ─────────────────────────────────────────────── tocar: onda y foco

     La onda sale de donde cae el dedo sobre la esfera, no de la pantalla: se
     corta el rayo de la cámara con la esfera de radio 1 y el punto se pasa a
     coordenadas de la esfera, que es donde vive la onda. Así la onda se queda
     pegada a la superficie aunque la esfera siga girando.

     Y si el toque cae sobre un validador, la esfera gira hasta ponerlo de
     frente y se acerca. Tocar fuera lo suelta. */
  const rayo = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const esferaUnidad = new THREE.Sphere(new THREE.Vector3(), 1);
  const golpe = new THREE.Vector3(), invGrupo = new THREE.Matrix4();
  let ondaSig = 0;
  let focoIdx = -1, focoGiro = null, zoomObjetivo = null, zoomAntesFoco = 1;

  function tocar(ev) {
    const caja = lienzo.getBoundingClientRect();
    const x = ev.clientX - caja.left, y = ev.clientY - caja.top;
    ndc.set(x / caja.width * 2 - 1, -(y / caja.height) * 2 + 1);
    rayo.setFromCamera(ndc, camara);
    if (!reducido && rayo.ray.intersectSphere(esferaUnidad, golpe)) {
      invGrupo.copy(grupo.matrixWorld).invert();
      golpe.applyMatrix4(invGrupo).normalize();
      uniformes.uOndaP.value[ondaSig].copy(golpe);
      uniformes.uOndaT.value[ondaSig] = uniformes.uReloj.value;
      ondaSig = (ondaSig + 1) % 4;
    }
    let mejor = -1, mejorD = RADIO_ACIERTO;
    for (let i = 0; i < nNodos; i++) {
      const p = enPantalla(i);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < mejorD) { mejorD = d; mejor = i; }
    }
    if (mejor >= 0) enfocar(mejor); else soltarFoco();
  }

  /** Gira la esfera para poner el validador `i` de frente y se acerca. */
  function enfocar(i) {
    const d = dirNodos[i];
    if (!d) return;
    if (focoIdx < 0) zoomAntesFoco = zoom;
    focoIdx = i;
    matNodo.uniforms.uFocoIdx.value = i;
    /* Con el giro en orden XYZ —`grupo.rotation.set(girX, girY, 0)`— el nodo
       queda de frente si primero el giro en Y lo lleva al plano YZ y luego el
       giro en X lo sube o baja al eje de la cámara. */
    const rho = Math.hypot(d.x, d.z);
    focoGiro = { y: Math.atan2(-d.x, d.z), x: Math.max(-1.15, Math.min(1.15, Math.atan2(d.y, rho))) };
    zoomObjetivo = Math.min(ZOOM_MAX, Math.max(zoom, 1.45));
    velX = velY = 0;
    senalado = -2;                 // fuerza el aviso aunque ya estuviera señalado
    fijar(i);
  }
  function soltarFoco() {
    if (focoIdx < 0) return;
    focoIdx = -1; focoGiro = null;
    matNodo.uniforms.uFocoIdx.value = -1;
    zoomObjetivo = zoomAntesFoco;
    fijar(-1);
  }

  lienzo.addEventListener('wheel', ev => {
    ev.preventDefault();
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(-ev.deltaY * 0.0012)));
    zoomObjetivo = null;
    aplicarCamara();
  }, { passive: false });

  /**
   * Vuelca los dos tokens del tema sobre los materiales ya creados.
   *
   * No se reconstruye nada: son `uColor` de materiales que ya existen, así que
   * cambiar de tema con la esfera a la vista no da ni un tirón.
   */
  function aplicarTema() {
    const dato = tokenColor('--dato');
    const acento = tokenColor('--acento');
    if (!dato && !acento) return false;

    /* ⚠ Cada familia de material llama al uniforme de otra manera, y darlo por
       hecho no cuesta un error visible: cuesta que el color no cambie y no se
       sepa por qué. Comprobados uno a uno:
         · cáscara y atmósfera → `uColor`
         · líneas (LineMaterial) → `uCian`
         · puntos y nodos → `uColor`                                          */
    const poner = (mat, nombre, color) => {
      const u = mat && mat.uniforms && mat.uniforms[nombre];
      if (u && u.value && u.value.copy) u.value.copy(color);
    };

    if (dato) {
      /* La cáscara es el mismo color, muy oscurecido. Antes era una constante
         aparte —`CIAN_OSC`, #0b4a68—; derivarla evita que un tema nuevo se
         olvide de darle valor.

         ⚠ El factor es 0,12 y no un número redondo porque `multiplyScalar` va
           en espacio LINEAL, no en sRGB. Con 0,20 la cáscara del tema Núcleo
           salía #0f6674, bastante más clara que el #0b4a68 que tuvo siempre, y
           Núcleo tiene que verse exactamente como se veía. Medido: el #0b4a68
           original equivale a un factor lineal de 0,10–0,16 según el canal;
           0,12 da #094f5b, que es el mismo peso. */
      poner(matCascara, 'uColor', dato.clone().multiplyScalar(0.12));
      poner(matAtmosfera, 'uColor', dato);
      for (const m of materialesLinea) {
        // La cadena entre nodos va en acento; el resto de líneas, en dato.
        if (m !== matCadena) poner(m, 'uCian', dato);
      }
      for (const m of [matVertices, matCampo]) poner(m, 'uColor', dato);
    }
    if (acento) {
      poner(matNodo, 'uColor', acento);
      poner(matCadena, 'uCian', acento);
      poner(matNucleo, 'uCaliente', acento);
      poner(matAura, 'uColor', acento);
      poner(matChoque, 'uColor', acento);
      poner(matPulso, 'uNaranja', acento);
    }
    if (dato) {
      poner(matNucleo, 'uBorde', dato);
      poner(matPulso, 'uColor', dato);
    }
    return true;
  }

  aplicarTema();
  // El selector avisa por aquí. Ver `paneles/tema.js`.
  const alCambiarTema = () => aplicarTema();
  window.addEventListener('plsdash:tema', alCambiarTema);

  // ─────────────────────────────────────────────── estado de la app
  let energiaObjetivo = 0.5, frescuraObjetivo = 1;

  function actualizar(estado) {
    if (!estado) return;
    const lista = estado.nodos || [];
    intensidades = lista.map(v => Math.max(0, Math.min(1, v.intensidad ?? 0.5)));
    activos = lista.map(v => v.activo !== false);
    pendientes = lista.map(v => v.pendiente === true);
    // Lo que la esfera NO interpreta pero sí devuelve al señalar un nodo. Se
    // guarda tal cual: aquí no se sabe qué es un índice de validador.
    metaNodos = lista.map(v => ({ ...v }));
    if (lista.length !== nNodos) construirNodos(lista.length);
    else if (mallaNodos) {
      const aI = mallaNodos.geometry.getAttribute('aInt');
      const aA = mallaNodos.geometry.getAttribute('aAct');
      const aP = mallaNodos.geometry.getAttribute('aPend');
      for (let i = 0; i < intensidades.length; i++) {
        aI.array[i] = intensidades[i];
        aA.array[i] = activos[i] === false ? 0 : 1;
        aP.array[i] = pendientes[i] === true ? 1 : 0;
      }
      aI.needsUpdate = true; aA.needsUpdate = true; aP.needsUpdate = true;
    }
    if (estado.energia  != null) energiaObjetivo  = Math.max(0, Math.min(1, estado.energia));
    if (estado.frescura != null) frescuraObjetivo = Math.max(0, Math.min(1, estado.frescura));
  }

  /**
   * Un bloque propuesto: el nodo de ese validador da un golpe de luz y una onda
   * sale de él y recorre la esfera.
   *
   * Es el único movimiento de la escena que responde a un HECHO PUNTUAL y no a
   * una magnitud continua, y por eso se ve: pasa una vez, dura segundo y medio
   * y no vuelve hasta el siguiente bloque —hoy, uno de cada catorce barridos—.
   *
   * @param {number} indiceValidador  el índice REAL del validador, no su
   *   posición en el array. La traducción se hace aquí porque fuera nadie sabe
   *   —ni tiene por qué— en qué orden se repartieron los nodos por la esfera.
   * @returns {boolean} false si ese validador no está en la escena.
   */
  function destello(indiceValidador) {
    // `m.indice` es null en el que aún espera a entrar en la cadena, y
    // `Number(null)` es 0 — no NaN. Sin exigir que sea finito, un destello
    // del validador 0 iluminaría al que espera.
    const buscado = Number(indiceValidador);
    if (!Number.isFinite(buscado)) return false;
    const i = metaNodos.findIndex(m => m.indice != null && Number(m.indice) === buscado);
    if (i < 0 || !dirNodos[i]) return false;
    matNodo.uniforms.uDestIdx.value = i;
    uDestDir.value.copy(dirNodos[i]);
    destelloT0 = performance.now();
    matNodo.uniforms.uDestT.value = 0;
    uDestTM.value = 0;
    return true;
  }

  /**
   * Un barrido: el núcleo se vacía, sale una onda de choque, la luz recorre
   * los validadores en orden y los pulsos se ponen en naranja.
   *
   * Como `destello()`, responde a un HECHO PUNTUAL —lo llama `index.html`
   * cuando el registro trae un barrido nuevo— y no a una magnitud. El vaciado
   * de verdad del núcleo lo hace el dato: cuando el ciclo vuelve a empezar,
   * `energia` baja y el núcleo encoge solo. Esto es el golpe que lo anuncia.
   */
  let barridoT0 = -1;
  function barrido() {
    barridoT0 = performance.now();
    for (const p of pulsos) { p.naranja = 1; p.vel = 2.2 + Math.random(); }
    return true;
  }

  // ─────────────────────────────────────────────── bucle
  const vigilante = new Vigilante(() => {
    // Lo barato primero: la resolución. Luego la del resplandor, y solo al
    // final, sin nada más que bajar, el resplandor entero. La geometría no se
    // toca: rehacerla a mitad de sesión daría un tirón y cambiaría el dibujo
    // delante del usuario.
    if (cfg.dprMax > 1.0) { cfg.dprMax = Math.max(1.0, cfg.dprMax - 0.25); medir(); return true; }
    if (conBloom && escalaBloom > 0.5) { escalaBloom = 0.5; medir(); return true; }
    if (conBloom) { conBloom = false; return true; }
    return false;
  });
  const t0Reloj = performance.now();

  let raf = null, ultimo = performance.now(), visible = true, reloj = 0;
  let destelloT0 = -1;   // instante del último bloque, en ms de `performance.now()`
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
    uniformes.uReloj.value = (ahora - t0Reloj) / 1000;

    const kf = 1 - Math.exp(-dt * 5);
    if (focoGiro) {
      // El camino corto: girar 350° para llegar a -10° marea.
      let dy = focoGiro.y - girY;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      girY += dy * kf; girX += (focoGiro.x - girX) * kf;
    } else if (!reducido) girY += dt * 0.055;
    girY += velY; girX += velX;
    velX *= 0.92; velY *= 0.92;
    girX = Math.max(-1.15, Math.min(1.15, girX));
    grupo.rotation.set(girX, girY, 0);

    if (zoomObjetivo != null) {
      zoom += (zoomObjetivo - zoom) * kf;
      if (Math.abs(zoomObjetivo - zoom) < 0.002) { zoom = zoomObjetivo; zoomObjetivo = null; }
      aplicarCamara();
    }
    uFoco.value += ((focoIdx >= 0 ? 1 : 0) - uFoco.value) * kf;

    // El núcleo lee el avance del ciclo, que ya viene suavizado en uEnergia.
    uCarga.value = Math.max(0, Math.min(1, (uEnergia.value - 0.35) / 0.5));
    if (barridoT0 >= 0) {
      const t = (ahora - barridoT0) / 1000;
      if (t < 2.6) {
        uBarrido.value = Math.exp(-Math.pow((t - 0.25) * 3, 2));
        matNodo.uniforms.uBarT.value = t;
        uDescarga.value = Math.exp(-Math.pow((t - 0.12) * 5, 2));
        const k = t / 1.1;
        choque.visible = !reducido && k < 1;
        uChoque.value = k < 1 ? k : -1;
      } else {
        barridoT0 = -1;
        uBarrido.value = 0; uDescarga.value = 0; uChoque.value = -1; choque.visible = false;
        matNodo.uniforms.uBarT.value = -1;
        for (const p of pulsos) p.vel = 0.45 + Math.random() * 0.6;
      }
    }
    moverPulsos(dt);

    const k = 1 - Math.exp(-dt * 7);
    uEnergia.value  += (energiaObjetivo  - uEnergia.value)  * k * 0.5;
    uFrescura.value += (frescuraObjetivo - uFrescura.value) * k * 0.5;

    /* El destello corre contra el RELOJ, no acumulando `dt`.
       ⚠ Acumular `dt` parecía equivalente y no lo es: `dt` está acotado a 50 ms
         por fotograma para que un tirón no dé un salto, así que en una máquina
         lenta el destello duraba muchísimo más de segundo y medio. Medido: con
         rasterizado por software, 3,2 s de reloj daban 0,75 s de destello. Un
         golpe de luz que dura cuatro veces más en el móvil malo que en el bueno
         no es el mismo dato.
       A -1 los shaders se lo saltan entero: sin bloque no cuesta nada. */
    if (destelloT0 >= 0) {
      const t = (ahora - destelloT0) / 1000;
      const vivo = t < 2.6;               // más allá, la envolvente ya es cero
      if (!vivo) destelloT0 = -1;
      matNodo.uniforms.uDestT.value = vivo ? t : -1;
      uDestTM.value = vivo ? t : -1;
    }

    if (conBloom) composer.render(dt); else renderer.render(escena, camara);

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
    destello,
    barrido,
    /* El nacimiento, para la pantalla de carga. 0 = un punto en el centro,
       1 = esfera. Lo lee `deformar()`, que comparten todos los materiales.
       Los anillos de ambiente no deforman: entran al final, cuando la esfera
       ya ha caído sobre su superficie. */
    nacer(v) {
      const n = Math.max(0, Math.min(1, v));
      uniformes.uNacer.value = n;
      const k = Math.max(0, Math.min(1, (n - 0.7) / 0.3));
      anillos.visible = k > 0;
      anillos.scale.setScalar(0.85 + 0.15 * k);
    },

    /**
     * Cambia de contenedor sin perder el contexto de WebGL.
     *
     * Existe por la pantalla de carga: la esfera nace a pantalla completa y al
     * acabar SE MUDA al hueco de la pestaña Esfera. Es la misma instancia, el
     * mismo lienzo y el mismo contexto — la que has visto ensamblarse es
     * literalmente la que se queda.
     *
     * Y no es solo poética: crear una segunda esfera para la pestaña
     * significaría un segundo contexto de WebGL y una segunda compilación de
     * shaders, que es la parte cara (708 ms medidos por software). Mudando el
     * lienzo se compila una sola vez.
     *
     * Mover un `<canvas>` de sitio en el DOM conserva su contexto; lo que hay
     * que rehacer son los dos observadores, que apuntaban al contenedor viejo,
     * y la medida, porque el hueco nuevo tiene otro tamaño.
     */
    mudar(nuevo) {
      if (!nuevo || nuevo === contenedor) return;
      observador.unobserve(contenedor);
      alVer.unobserve(contenedor);
      nuevo.appendChild(renderer.domElement);
      contenedor = nuevo;
      observador.observe(contenedor);
      alVer.observe(contenedor);
      medir();
    },
    // Para poder forzarlo desde una prueba sin depender del evento.
    aplicarTema,
    /* Para las pruebas: dónde cae en pantalla el validador `i` (o null si mira
       hacia atrás), y un toque sintético en coordenadas del lienzo. */
    _enPantalla: i => enPantalla(i),
    /* Para calibrar el resplandor mirando, sin recompilar: desde la consola o
       desde una prueba. No lo usa el panel. */
    _bloom({ fuerza, radio, umbral, activo } = {}) {
      if (fuerza != null) bloom.strength = fuerza;
      if (radio != null) bloom.radius = radio;
      if (umbral != null) bloom.threshold = umbral;
      if (activo != null) conBloom = !!activo;
      return { fuerza: bloom.strength, radio: bloom.radius, umbral: bloom.threshold, activo: conBloom };
    },
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
        nacer: uniformes.uNacer.value,
        llamadas: renderer.info.render.calls, reducido,
        destello: matNodo.uniforms.uDestT.value,
        bloom: conBloom, escalaBloom, pulsos: NPUL,
        nucleo: +uCarga.value.toFixed(3), barrido: barridoT0 >= 0, foco: focoIdx,
        /* Los colores tal como los tiene CADA FAMILIA de material ahora mismo,
           no como los tiene el CSS. Es la única forma de comprobar desde fuera
           que el tema llegó al shader y no se quedó en la hoja de estilo.

           ⚠ Van las CUATRO familias, y no por completismo: `poner()` no protesta
             cuando el uniforme no existe —tiene que no protestar, porque no
             todos los materiales tienen todos los uniformes—, así que escribir
             el nombre equivocado no rompe nada: deja el color viejo y calla. Ya
             pasó con las líneas, que usan `uCian` y no `uColor`. Con solo dos
             familias aquí, ese fallo volvía a colarse: comprobado sabotéandolo
             a propósito y viendo que la prueba pasaba igual. */
        colorDato: '#' + matAtmosfera.uniforms.uColor.value.getHexString(),
        colorAcento: '#' + matNodo.uniforms.uColor.value.getHexString(),
        colorLinea: '#' + matPrincipal.uniforms.uCian.value.getHexString(),
        colorCadena: '#' + matCadena.uniforms.uCian.value.getHexString(),
        colorVertices: '#' + matVertices.uniforms.uColor.value.getHexString(),
        colorCascara: '#' + matCascara.uniforms.uColor.value.getHexString(),
        antialias: renderer.getContext().getContextAttributes().antialias,
      };
    },
    destruir() {
      cancelAnimationFrame(raf);
      observador.disconnect(); alVer.disconnect();
      document.removeEventListener('visibilitychange', alCambiarPestana);
      window.removeEventListener('plsdash:tema', alCambiarTema);
      lienzo.removeEventListener('pointermove', alSenalarRef);
      lienzo.removeEventListener('pointerleave', limpiarSenal);
      composer.dispose(); objetivo.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
