/**
 * La esfera naciendo.
 *
 * Las partículas se ensamblan en la malla Voronoi y el panel aparece encima.
 * La carga no desaparece: se convierte en el panel.
 *
 * ## No es una imitación de la esfera: es la esfera
 *
 * Y no en sentido figurado. Esta pantalla llama a `crearEsfera()` —el mismo
 * módulo que dibuja la pestaña Esfera— y al terminar NO la destruye: se la
 * entrega a `index.html`, que la muda al hueco de la pestaña con `mudar()`. La
 * esfera que has visto ensamblarse es, literalmente, el mismo lienzo y el mismo
 * contexto de WebGL que se queda en el panel.
 *
 * Eso no es solo la idea bien contada: es la mitad del coste. Crear una segunda
 * esfera para la pestaña significaría un segundo contexto y una segunda
 * compilación de shaders, que es la parte cara. Con la mudanza se compila una
 * vez, igual que antes de que esta pantalla existiera.
 *
 * ## El ensamblaje
 *
 * Lo único que añade a la esfera es un uniforme —`uNacer`— que en reposo vale 1
 * y no hace nada; mientras sube de 0 a 1, cada vértice viene de más lejos,
 * girado y con su propio retardo, así que la malla se condensa como un enjambre.
 *
 * El nacimiento vive en `deformacion.js` y no aquí a propósito: `deformar()` la
 * comparten la cáscara, las aristas y los nodos, y si cada capa se ensamblara
 * por su cuenta se verían despegadas durante todo el trayecto. Puesto en el
 * sitio común, no pueden discrepar.
 *
 * ## Lo que cuesta, y qué se ve mientras
 *
 * Cero bytes de descarga: `three.module.js` ya se baja en todas las visitas,
 * porque `index.html` importa `crearEsfera` de forma estática.
 *
 * Lo que cuesta es tiempo hasta el primer fotograma de la esfera, y casi todo
 * es compilar shaders: 708 ms medidos con WebGL POR SOFTWARE, que es lo que hay
 * en la máquina de pruebas. Con GPU de verdad son bastante menos.
 *
 * Ese hueco no se puede quitar —hay que compilar—, pero sí se puede llenar, y
 * es lo que hace `montar()`: pinta la capa con el fondo del tema y la marca, y
 * CEDE DOS FOTOGRAMAS antes de llamar a `crearEsfera()`. Sin esa cesión, la
 * construcción bloquea el hilo principal antes de que el navegador llegue a
 * pintar nada y lo que se ve durante esos 700 ms es la página en blanco.
 */

import { crearEsfera } from '../escena/esfera.js';
import { suave } from './ritmo.js';

const T_NACER = 1250;      // lo que tarda el enjambre en cerrar la malla
const T_ASENTAR = 200;     // el respiro entre que cierra y se da por hecha

/** Dos fotogramas de verdad, no un `setTimeout(0)`: hace falta que PINTE. */
const cederDosFotogramas = () =>
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

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

/**
 * `opcionesEsfera` se le pasa tal cual a `crearEsfera()`: es cómo `index.html`
 * mete su `escalon` forzado y su `alSenalar`, para que la esfera que nace ya
 * sea la que va a quedarse y no haya que reconfigurarla al mudarla.
 */
export function montar(caja, { reducido = false, manual = false, opcionesEsfera = {} } = {}) {
  const capa = document.createElement('div');
  capa.className = 'cg cg-naciendo';
  capa.innerHTML = '<div class="cg-escena"></div>'
    + '<p class="cg-marca">PLSDASH</p><p class="cg-pie">Ensamblando la red</p>';
  caja.appendChild(capa);

  const hueco = capa.querySelector('.cg-escena');
  const marca = capa.querySelector('.cg-marca');
  const pie = capa.querySelector('.cg-pie');

  let esfera = null, raf = 0, t0 = 0, esperando = false, entregada = false;
  let resolverEntrada = null;
  const laEntrada = new Promise(r => { resolverEntrada = r; });
  let laSalida = null;

  const pintarEstado = p => esfera?.actualizar({
    nodos: nodosA(p), energia: 0.35 + 0.5 * p, frescura: 1,
  });

  /* La nube entra fundida. Sin esto, el primer fotograma es la maraña a plena
     luz: cientos de aristas largas cruzando la pantalla a la vez suman mucho
     más brillo que la esfera hecha, y lo que se ve es un fogonazo blanco. Con
     la opacidad subiendo con el ensamblaje, lo que entra es una nube. */
  const fundir = p => { hueco.style.opacity = String(0.30 + 0.70 * Math.min(1, p * 1.4)); };

  function bucle(ahora) {
    if (!t0) t0 = ahora;
    const t = ahora - t0;
    if (!esperando) {
      const p = Math.min(1, t / T_NACER);
      esfera.nacer(suave(p));
      pintarEstado(p); fundir(p);
      if (t >= T_NACER + T_ASENTAR) { esperando = true; resolverEntrada(); }
    }
    /* En la espera no se toca nada: la esfera ya está hecha y su propio bucle
       la mantiene girando y respirando. Es sostenible sin fin por construcción,
       porque es exactamente lo que hace en la pestaña Esfera. */
    raf = requestAnimationFrame(bucle);
  }

  /* La marca primero y la esfera después, con dos fotogramas de por medio: es
     lo que llena los ~700 ms de compilación con el fondo del tema en vez de con
     un blanco. Ver la nota de arriba. */
  const listo = (async () => {
    /* ⚠ La marca se enciende AQUÍ y con CSS, no en el bucle de la animación.
       Estaba dentro del bucle, y el bucle no arranca hasta que `crearEsfera()`
       ha vuelto: medido, la marca no se veía hasta los 1219 ms del arranque, o
       sea que lo único que tenía que tapar el hueco de la compilación llegaba
       cuando el hueco ya había pasado. Ahora se ve a los dos fotogramas. */
    requestAnimationFrame(() => { marca.style.opacity = '1'; pie.dataset.ver = '1'; });
    await cederDosFotogramas();
    esfera = crearEsfera(hueco, opcionesEsfera);
    if (reducido) {
      /* Sin coreografía: la esfera hecha y quieta —`nacer(1)` es su estado
         normal— y la marca fundida. Se ve lo mismo, sin que nada se ensamble. */
      capa.dataset.quieto = '1';
      esfera.nacer(1);
      pintarEstado(1); fundir(1);
      resolverEntrada();
      return;
    }
    esfera.nacer(0);
    pintarEstado(0); fundir(0);
    /* `manual` no arranca el bucle: lo mueve quien llama, con `_instante(ms)`.
       Existe porque una captura con Playwright tarda ~1,2 s en salir cuando hay
       WebGL por software, así que pedir «enséñame el fotograma de los 300 ms»
       por reloj de pared devuelve el de los 1.500. Medido. */
    if (!manual) raf = requestAnimationFrame(bucle);
  })();

  /* ⚠ `entrada()` y `salida()` devuelven SIEMPRE la misma promesa.
     No es una optimización: con `entrada: () => new Promise(r => resolver = r)`
     la segunda llamada pisaba `resolver` y la promesa de la PRIMERA no se
     resolvía nunca — el controlador se quedaba esperando para siempre y la
     pantalla no se iba. Lo cazó la prueba al mirar la entrada por su cuenta. */
  return {
    entrada: () => laEntrada,

    /**
     * La esfera, para quien la quiera después. `index.html` la recoge y la muda
     * al hueco de la pestaña. Es una promesa porque no existe hasta que pasan
     * los dos fotogramas cedidos.
     */
    esfera: () => listo.then(() => esfera),

    /**
     * A partir de aquí la esfera es de quien la reciba: `destruir()` ya no la
     * toca. Si nadie la reclama, se destruye igual — de eso se encarga la
     * bandera, no la buena fe de quien llama.
     */
    entregar() { entregada = true; return esfera; },

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

    destruir() {
      cancelAnimationFrame(raf);
      if (!entregada) esfera?.destruir();
      capa.remove();
    },

    /* Para las pruebas: poder mirar un instante concreto sin esperar. */
    async _instante(t) {
      await listo;
      const p = Math.min(1, t / T_NACER);
      esfera.nacer(suave(p));
      pintarEstado(p); fundir(p);
    },
  };
}
