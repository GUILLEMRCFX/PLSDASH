/**
 * Malla irregular de celdas sobre una esfera — Voronoi esférico de verdad.
 *
 * No es un poliedro de Goldberg: eso sale demasiado regular, con sus hexágonos
 * ordenados, y se lee como una pelota de fútbol.
 *
 * ## Por qué por el casco convexo
 *
 * El primer intento repartía los triángulos de un icosaedro muy subdividido
 * entre las semillas y tomaba como arista la frontera entre triángulos de
 * celdas distintas. Funciona, pero el borde queda **serrado**: se ve la
 * escalera de los triángulos, y la referencia tiene lados rectos y limpios.
 *
 * Este método da la teselación exacta, y de paso sale mucho más barata:
 *
 *   Para puntos sobre una esfera, la triangulación de Delaunay es exactamente
 *   el casco convexo. Y el Voronoi es su dual: cada cara del casco aporta un
 *   vértice de Voronoi —el punto de la esfera equidistante de sus tres
 *   semillas, que es justo por donde la normal del plano corta la esfera— y
 *   cada arista compartida por dos caras aporta una arista de Voronoi entre
 *   sus dos vértices.
 *
 * Con 300 celdas son ~900 aristas rectas y ~1.800 triángulos de cáscara,
 * frente a los 3.754 segmentos escalonados y 19.220 triángulos de antes.
 */

import { ConvexHull } from '../vendor/jsm/math/ConvexHull.js';

/** Generador reproducible: la misma esfera en cada carga y en cada captura. */
function generador(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Densidad de siembra: una función suave de la posición, entre 0 y 1.
 *
 * Es lo que hace que las celdas tengan tamaños DISTINTOS. Repartiendo las
 * semillas de forma uniforme salen todas parecidas y la esfera se lee como un
 * balón de fútbol. Sembrando más en unas zonas que en otras, unas celdas
 * quedan apretadas y otras anchas, que es lo que da aspecto orgánico.
 *
 * Suma de senos en vez de ruido de librería: suave, reproducible y sin
 * dependencias.
 */
function densidad(x, y, z) {
  const a = Math.sin(x * 2.3 + y * 1.7) * Math.cos(z * 2.9 - x * 1.1);
  const b = Math.sin(y * 3.7 - z * 2.1) * Math.cos(x * 1.9 + y * 2.6);
  return 0.20 + 0.80 * Math.min(1, Math.max(0, 0.5 + 0.32 * a + 0.24 * b));
}

/**
 * Semillas por muestreo con rechazo sobre esa densidad. Se parte de puntos
 * uniformes de verdad (no de una espiral) porque la espiral impone su propio
 * orden y se acaba viendo por debajo de todo lo demás.
 */
function sembrar(THREE, n, aleatorio, variacion = 1) {
  const puntos = [];
  let intentos = 0;
  while (puntos.length < n && intentos < n * 200) {
    intentos++;
    // Punto uniforme sobre la esfera: z uniforme y ángulo uniforme.
    const z = aleatorio() * 2 - 1;
    const ang = aleatorio() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const x = r * Math.cos(ang), y = r * Math.sin(ang);
    const p = 1 - variacion + variacion * densidad(x, y, z);
    if (aleatorio() > p) continue;
    puntos.push(new THREE.Vector3(x, y, z));
  }
  // Red de seguridad: si la densidad fuese muy restrictiva, se completa
  // uniforme antes que devolver menos celdas de las pedidas.
  while (puntos.length < n) {
    const z = aleatorio() * 2 - 1;
    const ang = aleatorio() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    puntos.push(new THREE.Vector3(r * Math.cos(ang), r * Math.sin(ang), z));
  }
  return puntos;
}

/**
 * Campo de puntos DENTRO del volumen, no solo en la superficie.
 *
 * Es lo que quita la sensación de cáscara hueca: se ven cientos de puntos por
 * detrás y por dentro de la malla, con brillos distintos, y eso es lo que da
 * profundidad. Se sesga hacia fuera —la mayoría cerca de la superficie— para
 * que el centro no se convierta en una mancha.
 */
export function campoInterior(n, semillaNum = 991) {
  const aleatorio = generador(semillaNum);
  const pos = new Float32Array(n * 3);
  const brillo = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = aleatorio() * 2 - 1;
    const ang = aleatorio() * Math.PI * 2;
    const rr = Math.sqrt(Math.max(0, 1 - z * z));
    const radio = 0.30 + 0.68 * Math.pow(aleatorio(), 0.55);
    pos[i * 3]     = rr * Math.cos(ang) * radio;
    pos[i * 3 + 1] = rr * Math.sin(ang) * radio;
    pos[i * 3 + 2] = z * radio;
    // Brillos muy repartidos: unos pocos destacan y la mayoría son polvo.
    const t = aleatorio();
    brillo[i] = 0.06 + Math.pow(t, 2.6) * 0.94;
  }
  return { pos, brillo, n };
}

export function construirCeldas(THREE, { nCeldas = 300, semilla = 20260815, variacion = 1 } = {}) {
  const t0 = performance.now();

  const aleatorio = generador(semilla);
  const semillas = sembrar(THREE, nCeldas, aleatorio, variacion);

  // Índice de cada semilla por identidad: ConvexHull conserva el mismo objeto
  // Vector3 que se le pasa, así que sirve como clave.
  const indiceDe = new Map();
  semillas.forEach((p, i) => indiceDe.set(p, i));

  const casco = new ConvexHull().setFromPoints(semillas);

  // Vértice de Voronoi de cada cara: donde la normal del plano corta la esfera.
  const centros = casco.faces.map(f => f.normal.clone().normalize());
  const idDeCara = new Map();
  casco.faces.forEach((f, i) => idDeCara.set(f, i));

  const brilloCelda = new Float32Array(nCeldas);
  for (let s = 0; s < nCeldas; s++) brilloCelda[s] = aleatorio();

  const aristas = [];
  const vertsCascara = [];
  const tonos = [];

  const empujar = (p, tono) => {
    vertsCascara.push(p.x, p.y, p.z);
    tonos.push(tono);
  };

  for (const cara of casco.faces) {
    const iCara = idDeCara.get(cara);
    const c1 = centros[iCara];

    // Recorrer las semiaristas de la cara. Se admite cualquier polígono:
    // ConvexHull funde caras coplanares, y aunque con semillas sacudidas casi
    // siempre salgan triángulos, no conviene darlo por hecho.
    let e = cara.edge;
    do {
      const vecina = e.twin.face;
      const iVecina = idDeCara.get(vecina);

      // Cada arista la ven dos caras; solo la emite la de índice menor.
      if (iVecina > iCara) {
        const c2 = centros[iVecina];
        aristas.push(c1.x, c1.y, c1.z, c2.x, c2.y, c2.z);

        // Las dos semillas separadas por esta arista de Voronoi son justamente
        // los extremos de la arista de Delaunay que la genera.
        const sa = indiceDe.get(e.tail().point);
        const sb = indiceDe.get(e.head().point);
        // Cada celda se teja como un abanico desde su semilla hacia el anillo
        // de vértices de Voronoi que la rodea. Emitiendo los dos lados de cada
        // arista se cubre la esfera entera sin huecos ni solapes.
        if (sa !== undefined) {
          empujar(semillas[sa], brilloCelda[sa]);
          empujar(c1, brilloCelda[sa]);
          empujar(c2, brilloCelda[sa]);
        }
        if (sb !== undefined) {
          empujar(semillas[sb], brilloCelda[sb]);
          empujar(c1, brilloCelda[sb]);
          empujar(c2, brilloCelda[sb]);
        }
      }
      e = e.next;
    } while (e !== cara.edge);
  }

  const cascara = new THREE.BufferGeometry();
  cascara.setAttribute('position', new THREE.Float32BufferAttribute(vertsCascara, 3));
  cascara.setAttribute('aTono', new THREE.Float32BufferAttribute(tonos, 1));

  // Puntos de la malla: las esquinas de las celdas (los vértices de Voronoi) y
  // los centros. Son textura, no dato — no representan nada y por eso pueden
  // ser tantos como haga falta. Es lo que separa una malla desnuda de algo que
  // parece tener grano.
  const puntos = new Float32Array((centros.length + nCeldas) * 3);
  const brilloPunto = new Float32Array(centros.length + nCeldas);
  centros.forEach((c, i) => {
    puntos[i * 3] = c.x; puntos[i * 3 + 1] = c.y; puntos[i * 3 + 2] = c.z;
    // Las esquinas brillan más que los centros: marcan la estructura.
    brilloPunto[i] = 0.55 + aleatorio() * 0.45;
  });
  for (let s = 0; s < nCeldas; s++) {
    const o = centros.length + s;
    puntos[o * 3] = semillas[s].x; puntos[o * 3 + 1] = semillas[s].y; puntos[o * 3 + 2] = semillas[s].z;
    brilloPunto[o] = 0.12 + aleatorio() * 0.30;
  }

  return {
    cascara,
    aristas: new Float32Array(aristas),
    puntos,
    brilloPunto,
    nPuntos: brilloPunto.length,
    nCeldas,
    nSegmentos: aristas.length / 6,
    nTriangulos: vertsCascara.length / 9,
    ms: Math.round(performance.now() - t0),
  };
}
