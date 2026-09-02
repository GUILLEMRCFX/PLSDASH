/**
 * La esfera naciendo.
 *
 * Las partículas se ensamblan en la malla Voronoi y el panel aparece encima.
 * La carga no desaparece: se convierte en el panel.
 *
 * ## No es una imitación de la esfera: es la esfera
 *
 * Esta candidata monta `crearEsfera()`, el mismo módulo que dibuja la pestaña
 * Esfera, con la misma geometría, los mismos materiales y el mismo tema. Lo
 * único que añade es un uniforme —`uNacer`— que en reposo vale 1 y no hace
 * nada; mientras sube de 0 a 1, cada vértice viene de más lejos, girado y con
 * su propio retardo, así que la malla se condensa como un enjambre.
 *
 * El nacimiento vive en `deformacion.js` y no aquí a propósito: `deformar()` la
 * comparten la cáscara, las aristas y los nodos, y si cada capa se ensamblara
 * por su cuenta se verían despegadas durante todo el trayecto. Puesto en el
 * sitio común, no pueden discrepar.
 *
 * ## Coste
 *
 * Cero bytes de más. `three.module.js` ya se descarga en todas las visitas
 * —`index.html` importa `crearEsfera` de forma estática, no perezosa— así que
 * esta pantalla no añade ni una petición.
 *
 * Lo que sí añade es tiempo hasta el primer fotograma, y no es poco. Medido con
 * página nueva y WebGL POR SOFTWARE, que es lo que hay en la máquina de pruebas:
 *
 *   candidata      import   montar   primer fotograma
 *   escáner          11 ms     4 ms      7 ms
 *   constelación     11 ms     5 ms      7 ms
 *   compuerta        10 ms     3 ms      5 ms
 *   naciendo         63 ms    95 ms    708 ms
 *
 * Los 708 ms son compilación de shaders, y con GPU de verdad son bastante
 * menos —el iPhone no rasteriza por software—, pero el orden se mantiene: esta
 * es la cara. Hasta ese primer fotograma se ve el fondo del tema con la marca,
 * no una pantalla en blanco, porque la capa se pinta antes que la escena.
 * Las otras tres pintan en el primer fotograma porque no dependen de nada.
 */

import { crearEsfera } from '../escena/esfera.js';
import { suave } from './ritmo.js';

const T_NACER = 1250;      // lo que tarda el enjambre en cerrar la malla
const T_ASENTAR = 200;     // el respiro entre que cierra y se da por hecha

/** Nodos de mentira para el nacimiento: los diez que hay, encendiéndose. */
function nodosA(p) {
  const n = [];
  for (let i = 0; i < 10; i++) {
    // Se encienden escalonados dentro del último tercio del ensamblaje.
    const v = Math.max(0, Math.min(1, (p - 0.55 - i * 0.035) / 0.3));
    n.push({ intensidad: 0.25 + 0.6 * v, activo: v > 0.15 });
  }
  return n;
}

export function montar(caja, { reducido = false, manual = false } = {}) {
  const capa = document.createElement('div');
  capa.className = 'cg cg-naciendo';
  capa.innerHTML = '<div class="cg-escena"></div>'
    + '<p class="cg-marca">PLSDASH</p><p class="cg-pie">Ensamblando la red</p>';
  caja.appendChild(capa);

  const hueco = capa.querySelector('.cg-escena');
  const marca = capa.querySelector('.cg-marca');
  const pie = capa.querySelector('.cg-pie');

  const esfera = crearEsfera(hueco, { semilla: 20260815 });
  let raf = 0, t0 = 0, resolverEntrada = null, esperando = false;
  const laEntrada = new Promise(r => { resolverEntrada = r; });
  let laSalida = null;

  const pintarEstado = p => esfera.actualizar({
    nodos: nodosA(p), energia: 0.35 + 0.5 * p, frescura: 1,
  });

  /* La nube entra fundida. Sin esto, el primer fotograma es la maraña a plena
     luz: cientos de aristas largas cruzando la pantalla a la vez suman mucho
     mas brillo que la esfera hecha, y lo que se ve es un fogonazo blanco. Con
     la opacidad subiendo con el ensamblaje, lo que entra es una nube. */
  const fundir = p => { hueco.style.opacity = String(0.30 + 0.70 * Math.min(1, p * 1.4)); };

  if (reducido) {
    /* Sin coreografía: la esfera hecha y quieta —`nacer(1)` es su estado
       normal— y la marca fundida. Se ve lo mismo, sin que nada se ensamble. */
    capa.dataset.quieto = '1';
    esfera.nacer(1);
    pintarEstado(1);
    return {
      entrada: () => Promise.resolve(),
      salida: () => { capa.dataset.fin = '1'; return new Promise(r => setTimeout(r, 240)); },
      destruir() { esfera.destruir(); capa.remove(); },
    };
  }

  esfera.nacer(0);
  pintarEstado(0); fundir(0);

  function bucle(ahora) {
    if (!t0) t0 = ahora;
    const t = ahora - t0;
    marca.style.opacity = String(Math.min(1, Math.max(0, (t - 120) / 480)));
    if (t > 300) pie.dataset.ver = '1';

    if (!esperando) {
      const p = Math.min(1, t / T_NACER);
      esfera.nacer(suave(p));
      pintarEstado(p); fundir(p);
      if (t >= T_NACER + T_ASENTAR) { esperando = true; resolverEntrada?.(); }
    }
    /* En la espera no se toca nada: la esfera ya está hecha y su propio bucle
       la mantiene girando y respirando. Es sostenible sin fin por construcción,
       porque es exactamente lo que hace en la pestaña Esfera. */
    raf = requestAnimationFrame(bucle);
  }
  /* `manual` no arranca el bucle: lo mueve quien llama, con `_instante(ms)`.
     Existe porque una captura con Playwright tarda ~1,2 s en salir cuando hay
     WebGL por software, así que pedir «enséñame el fotograma de los 300 ms» por
     reloj de pared devuelve el de los 1.500. Medido. */
  if (!manual) raf = requestAnimationFrame(bucle);

  /* ⚠ `entrada()` y `salida()` devuelven SIEMPRE la misma promesa.
     No es una optimización: con `entrada: () => new Promise(r => resolver = r)`
     la segunda llamada pisaba `resolver` y la promesa de la PRIMERA no se
     resolvía nunca — el controlador se quedaba esperando para siempre y la
     pantalla no se iba. Lo cazó la prueba al mirar la entrada por su cuenta. */
  return {
    entrada: () => laEntrada,
    salida() {
      if (laSalida) return laSalida;
      /* La entrega: la esfera se aleja y se apaga mientras el panel entra por
         debajo. No se corta en seco — que es lo que hacía la pantalla vieja al
         quitarse el `display`. */
      capa.dataset.fin = '1';
      capa.dataset.entregando = '1';
      laSalida = new Promise(r => setTimeout(r, 520));
      return laSalida;
    },
    destruir() { cancelAnimationFrame(raf); esfera.destruir(); capa.remove(); },
    /* Para las pruebas: poder mirar un instante concreto sin esperar. */
    _instante(t) {
      const p = Math.min(1, t / T_NACER);
      marca.style.opacity = String(Math.min(1, Math.max(0, (t - 120) / 480)));
      if (t > 300) pie.dataset.ver = '1';
      esfera.nacer(suave(p));
      pintarEstado(p); fundir(p);
    },
  };
}
