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

/** Semillas en espiral de Fibonacci, con jitter para desordenar el patrón. */
function sembrar(THREE, n, aleatorio) {
  const puntos = [];
  const phi = Math.PI * (1 + Math.sqrt(5));
  // El empujón es una fracción del espaciado típico: lo justo para que no se
  // vea la espiral, no tanto como para dejar celdas degeneradas.
  const sacudida = 0.62 / Math.sqrt(n);
  for (let i = 0; i < n; i++) {
    const t = Math.acos(1 - 2 * (i + 0.5) / n);
    const a = phi * i;
    puntos.push(new THREE.Vector3(
      Math.sin(t) * Math.cos(a) + (aleatorio() - 0.5) * sacudida,
      Math.sin(t) * Math.sin(a) + (aleatorio() - 0.5) * sacudida,
      Math.cos(t) + (aleatorio() - 0.5) * sacudida,
    ).normalize());
  }
  return puntos;
}

export function construirCeldas(THREE, { nCeldas = 300, semilla = 20260815 } = {}) {
  const t0 = performance.now();

  const aleatorio = generador(semilla);
  const semillas = sembrar(THREE, nCeldas, aleatorio);

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

  return {
    cascara,
    aristas: new Float32Array(aristas),
    nCeldas,
    nSegmentos: aristas.length / 6,
    nTriangulos: vertsCascara.length / 9,
    ms: Math.round(performance.now() - t0),
  };
}
