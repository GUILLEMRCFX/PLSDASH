/**
 * La esfera.
 *
 * Este módulo no sabe qué es un validador, ni un barrido, ni un APR. Recibe un
 * objeto plano con números ya normalizados y los pinta. Toda la lógica de
 * negocio vive fuera, y por eso se puede probar con datos inventados sin tocar
 * nada más.
 *
 *   actualizar({
 *     nodos:    [{ intensidad: 0..1, activo: bool }],   // el orden es el único
 *     energia:  0..1,                                    // dato que se usa
 *     frescura: 0..1,
 *   })
 *
 * Las POSICIONES DE LOS NODOS NO VIENEN DE LOS DATOS. Se reparten en espiral
 * de Fibonacci a partir del índice, y son deliberadamente arbitrarias: los
 * diez validadores corren en la misma máquina, así que cualquier posición que
 * pareciera significar algo estaría mintiendo. Lo que sí codifican es tamaño y
 * brillo, que sí salen de los datos.
 */

import * as THREE from '../vendor/three.module.js';
import { LineSegments2 } from '../vendor/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../vendor/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../vendor/jsm/lines/LineMaterial.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

import { construirCeldas } from './celdas.js';
import { ESCALONES, elegirEscalon, Vigilante } from './calidad.js';
import { crearUniformsDeformacion, inyectar, UNIFORMS_DEFORMACION, FUNCION_DEFORMACION } from './deformacion.js';

const CIAN    = new THREE.Color(0x2ad4f0);
const CIAN_OSC= new THREE.Color(0x0b4a68);
const NARANJA = new THREE.Color(0xff8a3d);
const FONDO   = 0x03070f;

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

export function crearEsfera(contenedor, { escalon = null, semilla } = {}) {
  const nombreEscalon = escalon || elegirEscalon();
  let cfg = { ...ESCALONES[nombreEscalon] };

  const reducido = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  // ─────────────────────────────────────────────── renderer y escena
  const renderer = new THREE.WebGLRenderer({
    antialias: nombreEscalon !== 'bajo',
    powerPreference: 'high-performance',
    // `alpha:false` deja que el navegador se salte la composición con la
    // página: un fondo opaco es más barato de presentar.
    alpha: false,
  });
  renderer.setClearColor(FONDO, 1);
  // ACES es la mitad del resplandor que no da el bloom: hace que lo muy
  // brillante caiga a blanco en vez de recortarse en cian plano.
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

  // ─────────────────────────────────────────────── geometría de celdas
  const celdas = construirCeldas(THREE, { nCeldas: cfg.celdas, semilla });

  // ── cáscara translúcida ──
  // Aditiva y sin escribir profundidad: las caras de atrás SUMAN luz a las de
  // delante en vez de quedar ocultas. Eso es lo que da la translucidez de la
  // referencia — no es transparencia real, que sería mucho más cara.
  const matCascara = new THREE.ShaderMaterial({
    uniforms: { ...uniformes, uFrescura, uEnergia,
      uColor: { value: CIAN_OSC.clone() } },
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
        vec3 n = normalize(p);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Fresnel: el borde de la silueta brilla más que el centro, que es
        // lo que hace que se lea como una cáscara y no como una bola.
        vec3 haciaCamara = normalize(-mv.xyz);
        vec3 nVista = normalize(normalMatrix * n);
        vBorde = 1.0 - abs(dot(nVista, haciaCamara));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uFrescura;
      uniform float uEnergia;
      varying float vTono;
      varying float vBorde;
      void main(){
        float borde = pow(vBorde, 2.6);
        // Cada celda con su matiz: rompe el plano sin dibujar nada encima.
        float matiz = 0.55 + vTono * 0.45;
        // Muy tenue a propósito. La cáscara está para insinuar volumen y
        // encender la silueta, no para rellenar: si aporta de más, el negro
        // del fondo se convierte en un azul lechoso y las aristas dejan de
        // leerse como luz.
        vec3 col = uColor * matiz * (0.010 + borde * 0.38) * (0.5 + uEnergia * 0.7);
        // Sin datos frescos la esfera se apaga hacia el gris.
        col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const cascara = new THREE.Mesh(celdas.cascara, matCascara);
  cascara.frustumCulled = false;
  grupo.add(cascara);

  const anillosMats = [];

  // ── puntos de la malla ──
  // Un cuadrilátero de cara a la cámara por punto, con degradado radial. Sin
  // esto la malla se ve desnuda: son los que le dan grano y hacen que la cara
  // de atrás se lea como profundidad y no como líneas sueltas. No codifican
  // nada, así que pueden ser todos los que hagan falta.
  const uTamPunto = { value: cfg.punto };
  const matPuntos = new THREE.ShaderMaterial({
    uniforms: { ...uniformes, uFrescura, uEnergia, uTam: uTamPunto,
      uColor: { value: CIAN.clone() } },
    vertexShader: /* glsl */`
      #include <common>
      ${UNIFORMS_DEFORMACION}
      ${FUNCION_DEFORMACION}
      attribute vec3 aDir;
      attribute float aBrillo;
      uniform float uTam;
      varying vec2 vP;
      varying float vB;
      void main(){
        vP = position.xy;
        vB = aBrillo;
        vec4 mv = modelViewMatrix * vec4(deformar(aDir), 1.0);
        mv.xy += position.xy * (0.010 + aBrillo * 0.020) * uTam;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uFrescura;
      uniform float uEnergia;
      varying vec2 vP;
      varying float vB;
      void main(){
        float d = length(vP) * 2.0;
        if (d > 1.0) discard;
        float a = pow(1.0 - d, 2.0);
        vec3 col = mix(uColor, vec3(1.0), a * a * 0.75) * a * vB * (0.9 + uEnergia * 1.1);
        col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
        gl_FragColor = vec4(col, a * vB * 1.5);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  {
    const g = new THREE.InstancedBufferGeometry();
    const plano = new THREE.PlaneGeometry(1, 1);
    g.index = plano.index;
    for (const k in plano.attributes) g.setAttribute(k, plano.attributes[k]);
    g.instanceCount = celdas.nPuntos;
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(celdas.puntos, 3));
    g.setAttribute('aBrillo', new THREE.InstancedBufferAttribute(celdas.brilloPunto, 1));
    const malla = new THREE.Mesh(g, matPuntos);
    malla.frustumCulled = false;
    grupo.add(malla);
  }

  // ── anillos de ambiente ──
  // Decorativos, y nada más. No orbitan nada ni miden nada: están para dar
  // escala y aire alrededor de la esfera, como en la referencia. Van fuera del
  // grupo para que no giren con la malla.
  {
    const anillos = new THREE.Group();
    for (const [radio, inclinacion, alfa] of [[1.14, 0.05, 0.22], [1.24, -0.09, 0.14], [1.36, 0.13, 0.08]]) {
      const pts = [];
      const N = 128;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, b = ((i + 1) / N) * Math.PI * 2;
        pts.push(Math.cos(a) * radio, 0, Math.sin(a) * radio,
                 Math.cos(b) * radio, 0, Math.sin(b) * radio);
      }
      const g = new LineSegmentsGeometry();
      g.setPositions(new Float32Array(pts));
      const m = new LineMaterial({
        color: 0x2ad4f0, linewidth: 1, transparent: true,
        opacity: alfa, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      anillosMats.push(m);
      const l = new LineSegments2(g, m);
      l.frustumCulled = false;
      l.rotation.set(inclinacion, 0, inclinacion * 1.6);
      anillos.add(l);
    }
    // Casi de canto: se leen como elipses finas alrededor, no como órbitas.
    anillos.rotation.x = 1.36;
    escena.add(anillos);
  }

  // ── atmósfera ──
  // El bloom no solo ilumina la geometría: derrama luz FUERA de ella, y ese
  // halo alrededor de la silueta es la mitad del aspecto. Sin postprocesado
  // desaparece por completo, así que aquí se pinta a mano: un cuadrilátero de
  // cara a la cámara con un degradado que arranca justo en el borde de la
  // esfera y se apaga hacia fuera. Una llamada de dibujo, y existe en los tres
  // escalones para que escritorio y móvil compartan el mismo halo.
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
      uniform float uAtmosfera;
      uniform float uFrescura;
      uniform float uEnergia;
      uniform float uSilueta;
      uniform vec3 uColor;
      varying vec2 vP;
      void main(){
        float r = length(vP);
        // Nada por dentro de la silueta: ahí ya está la esfera, y sumar la
        // dejaría lechosa. El halo empieza en el borde y muere hacia fuera.
        float dentro = smoothstep(uSilueta - 0.055, uSilueta - 0.005, r);
        float fuera  = exp(-pow(max(0.0, r - uSilueta) / 0.075, 2.0));
        float g = dentro * fuera * uAtmosfera * (0.45 + uEnergia * 0.75);
        vec3 col = uColor * g;
        col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
        gl_FragColor = vec4(col, g);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const atmosfera = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matAtmosfera);
  atmosfera.frustumCulled = false;
  atmosfera.renderOrder = -1;
  // Fuera del grupo: el halo no gira con la esfera, siempre mira a la cámara.
  escena.add(atmosfera);

  // ── aristas ──
  // LineBasicMaterial NO sirve: `linewidth` lo ignora WebGL en la práctica y
  // siempre sale 1 píxel de dispositivo, o sea medio píxel CSS con dpr 2. Un
  // pelo. LineSegments2 construye cada arista como un cuadrilátero instanciado
  // en espacio de pantalla, y eso además deja escribir el degradado a mano.
  const geoAristas = new LineSegmentsGeometry();
  geoAristas.setPositions(celdas.aristas);

  const matAristas = new LineMaterial({
    color: 0xffffff,
    linewidth: cfg.grosor,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  Object.assign(matAristas.uniforms, uniformes, { uFrescura, uEnergia,
    uCian: { value: CIAN.clone() },
    uIntensidad: { value: cfg.intensidad } });

  // La deformación entra en el vertex shader y se aplica a los DOS extremos
  // del segmento. Como `deformar` es función pura de la posición en reposo,
  // dos aristas que comparten vértice siguen unidas.
  matAristas.vertexShader = inyectar(matAristas.vertexShader)
    .replace(
      'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
      'vec4 start = modelViewMatrix * vec4( deformar(instanceStart), 1.0 );')
    .replace(
      'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
      'vec4 end = modelViewMatrix * vec4( deformar(instanceEnd), 1.0 );');

  // El degradado de la arista: núcleo brillante con caída exponencial hacia
  // los lados del cuadrilátero. Esto ES un bloom por primitiva, en la misma
  // pasada, y es lo que sostiene el aspecto en móvil sin postprocesado.
  matAristas.fragmentShader = matAristas.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uFrescura;
      uniform float uEnergia;
      uniform float uIntensidad;
      uniform vec3  uCian;`)
    .replace(
      'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
      `float d = abs(vUv.y);
       float nucleo = exp(-d * d * 6.0);
       float halo   = exp(-d * 2.1) * 0.30;
       float i = nucleo + halo;
       // El núcleo tira a blanco y los bordes se quedan en cian: así se lee
       // como luz y no como una línea de color plano. La intensidad va solo
       // en el alfa; meterla también en el color la elevaría al cuadrado.
       // Menos blanco que antes: sin bloom, lavar el núcleo a blanco se comía
       // el cian y las aristas quedaban en un gris fino.
       vec3 col = mix(uCian, vec3(1.0), nucleo * 0.32) * (0.6 + uEnergia * 0.7);
       col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
       gl_FragColor = vec4(col, alpha * i * 0.85 * uIntensidad);`)

  const aristas = new LineSegments2(geoAristas, matAristas);
  aristas.frustumCulled = false;
  grupo.add(aristas);

  // ─────────────────────────────────────────────── nodos
  // Se usa InstancedBufferGeometry con un atributo de dirección propio en vez
  // de InstancedMesh: así los nodos pasan por la MISMA `deformar()` que la
  // cáscara y las aristas, y montan sobre la superficie en lugar de flotar.
  let nodos = null, halos = null, nNodos = 0;
  const uTamHalo = { value: cfg.halo };

  function instanciar(base, n) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
    g.instanceCount = n;
    return g;
  }

  function construirNodos(n) {
    if (nodos) { grupo.remove(nodos); nodos.geometry.dispose(); }
    if (halos) { grupo.remove(halos); halos.geometry.dispose(); }
    nNodos = n;
    if (n === 0) { nodos = halos = null; return; }

    const dirs = direccionesNodos(n);
    const aDir = new Float32Array(n * 3);
    const aInt = new Float32Array(n);
    dirs.forEach((d, i) => { aDir[i * 3] = d.x; aDir[i * 3 + 1] = d.y; aDir[i * 3 + 2] = d.z; aInt[i] = 0.5; });

    const attDir = new THREE.InstancedBufferAttribute(aDir, 3);
    const attInt = new THREE.InstancedBufferAttribute(aInt, 1);

    // Núcleo sólido.
    const gNucleo = instanciar(new THREE.SphereGeometry(0.019, 10, 7), n);
    gNucleo.setAttribute('aDir', attDir);
    gNucleo.setAttribute('aInt', attInt);
    nodos = new THREE.Mesh(gNucleo, matNucleo);
    nodos.frustumCulled = false;
    grupo.add(nodos);

    // Halo: un cuadrilátero siempre de cara a la cámara con degradado radial.
    // Es el sustituto directo del bloom sobre los nodos.
    const gHalo = instanciar(new THREE.PlaneGeometry(1, 1), n);
    gHalo.setAttribute('aDir', attDir);
    gHalo.setAttribute('aInt', attInt);
    halos = new THREE.Mesh(gHalo, matHalo);
    halos.frustumCulled = false;
    halos.renderOrder = 2;
    grupo.add(halos);
  }

  const matNucleo = new THREE.ShaderMaterial({
    uniforms: { ...uniformes, uFrescura, uColor: { value: NARANJA.clone() } },
    vertexShader: /* glsl */`
      #include <common>
      ${UNIFORMS_DEFORMACION}
      ${FUNCION_DEFORMACION}
      attribute vec3 aDir;
      attribute float aInt;
      varying float vInt;
      void main(){
        vInt = aInt;
        vec3 centro = deformar(aDir);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(centro + position * (0.7 + aInt), 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uFrescura;
      varying float vInt;
      void main(){
        vec3 col = mix(uColor, vec3(1.0), 0.10 + vInt * 0.30) * (0.9 + vInt * 0.9);
        col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const matHalo = new THREE.ShaderMaterial({
    uniforms: { ...uniformes, uFrescura, uTam: uTamHalo, uColor: { value: NARANJA.clone() } },
    vertexShader: /* glsl */`
      #include <common>
      ${UNIFORMS_DEFORMACION}
      ${FUNCION_DEFORMACION}
      attribute vec3 aDir;
      attribute float aInt;
      uniform float uTam;
      varying vec2 vP;
      varying float vInt;
      void main(){
        vP = position.xy;
        vInt = aInt;
        vec4 mv = modelViewMatrix * vec4(deformar(aDir), 1.0);
        // Billboard: el desplazamiento se hace en espacio de cámara, así que
        // el cuadrilátero mira siempre de frente sin calcular ninguna matriz.
        mv.xy += position.xy * (0.13 + aInt * 0.10) * uTam;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uFrescura;
      varying vec2 vP;
      varying float vInt;
      void main(){
        float d = length(vP) * 2.0;
        if (d > 1.0) discard;
        float a = pow(1.0 - d, 2.6);
        vec3 col = mix(uColor, vec3(1.0), a * 0.35) * a * (0.65 + vInt * 0.95);
        col = mix(vec3(dot(col, vec3(0.33))), col, uFrescura);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // ─────────────────────────────────────────────── postprocesado
  let composer = null, bloom = null;
  function montarBloom() {
    if (composer) return;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(escena, camara));
    // Umbral alto a propósito: el bloom es una capa de más sobre lo que ya
    // brilla, no lo que crea el aspecto. Si baja, la cáscara entera florece y
    // móvil —que no lo tiene— pasa a parecer la versión rota.
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.55, 0.62);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  function desmontarBloom() {
    if (!composer) return;
    composer.dispose?.();
    composer = null; bloom = null;
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
    // en una pantalla estrecha y alta el ángulo horizontal es mucho menor y la
    // esfera se sale por los lados aunque quepa de sobra por arriba. Se toma
    // la distancia que la haga caber por el eje más apretado de los dos.
    const MARGEN = 1.18;                         // radio 1 con aire alrededor
    const vFov = camara.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camara.aspect);
    const d = Math.max(MARGEN / Math.tan(vFov / 2), MARGEN / Math.tan(hFov / 2));
    camara.position.z = d;
    camara.updateProjectionMatrix();

    // Radio aparente de la silueta: una esfera de radio 1 a distancia d se
    // proyecta algo más grande que 1 por la perspectiva. La atmósfera tiene
    // que engancharse justo ahí, y con la cámara moviéndose no puede ser una
    // constante escrita a mano.
    const silueta = 1 / Math.sqrt(Math.max(1e-4, 1 - 1 / (d * d)));
    matAtmosfera.uniforms.uSilueta.value = silueta / 2.0;   // el plano mide 2 de semilado

    matAristas.resolution.set(ancho * dpr, alto * dpr);
    for (const m of anillosMats) m.resolution.set(ancho * dpr, alto * dpr);
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
    // El puntero se guarda en el espacio del OBJETO: la esfera gira, y si se
    // guardase en espacio de mundo el bulto se quedaría clavado en la pantalla
    // en vez de viajar con la superficie.
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
    // Mismo filtro que en el Vault: sin botón pulsado no hay arrastre.
    if (arrastrando && !ev.buttons) { arrastrando = false; }
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
  let intensidades = [];

  function actualizar(estado) {
    if (!estado) return;
    const lista = estado.nodos || [];
    if (lista.length !== nNodos) construirNodos(lista.length);
    intensidades = lista.map(v => Math.max(0, Math.min(1, v.intensidad ?? 0.5)));
    if (nodos) {
      const att = nodos.geometry.getAttribute('aInt');
      for (let i = 0; i < intensidades.length; i++) att.array[i] = intensidades[i];
      att.needsUpdate = true;
      halos.geometry.getAttribute('aInt').needsUpdate = true;
    }
    if (estado.energia  != null) energiaObjetivo  = Math.max(0, Math.min(1, estado.energia));
    if (estado.frescura != null) frescuraObjetivo = Math.max(0, Math.min(1, estado.frescura));
  }

  // ─────────────────────────────────────────────── bucle
  const vigilante = new Vigilante(() => degradar());
  function degradar() {
    if (cfg.bloom) { cfg.bloom = false; desmontarBloom(); return true; }
    if (cfg.dprMax > 1.25) { cfg.dprMax = Math.max(1.25, cfg.dprMax - 0.5); medir(); return true; }
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
    acumFps += msFrame; if (++muestrasFps >= 15) { fps = Math.round(1000 / (acumFps / muestrasFps)); acumFps = 0; muestrasFps = 0; }

    reloj += dt;
    uniformes.uTiempo.value = reloj;

    // Giro: deriva lenta constante más lo que aporte el arrastre, con inercia.
    if (!reducido) girY += dt * 0.055;
    girY += velY; girX += velX;
    velX *= 0.92; velY *= 0.92;
    girX = Math.max(-1.15, Math.min(1.15, girX));
    grupo.rotation.set(girX, girY, 0);

    // Todo lo que cambia se interpola: nada salta de un valor a otro.
    const k = 1 - Math.exp(-dt * 7);
    uniformes.uFuerza.value += (objetivoFuerza - uniformes.uFuerza.value) * k;
    uniformes.uPuntero.value.lerp(objetivoPuntero, k);
    uEnergia.value  += (energiaObjetivo  - uEnergia.value)  * k * 0.5;
    uFrescura.value += (frescuraObjetivo - uFrescura.value) * k * 0.5;

    if (composer) composer.render(); else renderer.render(escena, camara);
  }

  // En reposo, cero trabajo: si la pestaña se oculta o la esfera sale de
  // pantalla, el bucle se para del todo.
  const alVer = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
  alVer.observe(contenedor);
  const alCambiarPestana = () => { visible = !document.hidden; ultimo = performance.now(); };
  document.addEventListener('visibilitychange', alCambiarPestana);

  raf = requestAnimationFrame(bucle);

  return {
    actualizar,
    info: () => ({
      escalon: nombreEscalon, bloom: !!composer, fps, fotogramas,
      celdas: celdas.nCeldas, segmentos: celdas.nSegmentos, triangulos: celdas.nTriangulos,
      msGeometria: celdas.ms, nodos: nNodos,
      dpr: renderer.getPixelRatio(), ancho, alto, visible,
      fuerza: uniformes.uFuerza.value, respiracion: uniformes.uRespiracion.value,
      llamadas: renderer.info.render.calls, reducido,
    }),
    destruir() {
      cancelAnimationFrame(raf);
      observador.disconnect(); alVer.disconnect();
      document.removeEventListener('visibilitychange', alCambiarPestana);
      desmontarBloom();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
