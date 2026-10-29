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
 * ## La ignición (desde el 29-oct-2026; antes, un enjambre que se condensaba)
 *
 * Lo único que añade a la esfera es un uniforme —`uNacer`— que en reposo vale 1
 * y no hace nada. Mientras sube de 0 a 1: todo está en un punto, que es el
 * núcleo; estalla con un fogonazo; la red sale despedida más allá de la
 * superficie y cae sobre ella, cada vértice a su ritmo. Después se encienden
 * los validadores, UNO A UNO Y LOS DE VERDAD, con un contador debajo.
 *
 * ## Los validadores, de verdad
 *
 * Hasta el 29-oct-2026 aquí había diez nodos de mentira escritos a mano —ya
 * con veintiún validadores—. Ahora `index.html` pasa la promesa de los datos y
 * se encienden los que hay. Si los datos tardan, el pie lo dice y los nodos
 * entran cuando llegan: no se inventa ningún recuento mientras.
 *
 * ## Tres segundos
 *
 * La entrada dura 2,5 s y la salida medio: unos tres en total, se tarde lo que
 * se tarde en tener los datos. Decidido por el propietario: la animación se ve
 * entera aunque los datos lleguen antes.
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

const T_NACER = 2300;      // del punto a la esfera con todos los validadores
const T_ASENTAR = 180;     // el respiro entre que cierra y se da por hecha

/* Dónde cae cada cosa, en fracción de T_NACER. El estallido lo marca
   `deformar()` (0,12-0,42); los nodos se encienden cuando la red ya ha caído. */
const P_FOGONAZO = 0.13;
const P_NODOS = [0.60, 0.94];

/** Dos fotogramas de verdad, no un `setTimeout(0)`: hace falta que PINTE. */
const cederDosFotogramas = () =>
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * Los validadores reales, encendiéndose uno a uno entre `P_NODOS[0]` y
 * `P_NODOS[1]`. Los que aún no tocan van apagados —`activo: false`—, no
 * ausentes: la esfera reparte las posiciones según cuántos hay, y si la lista
 * creciera fotograma a fotograma los nodos cambiarían de sitio.
 */
export function nodosA(p, reales) {
  if (!reales || !reales.length) return { nodos: [], encendidos: 0 };
  const [a, b] = P_NODOS;
  const n = reales.length;
  let encendidos = 0;
  const nodos = reales.map((nodo, i) => {
    const pi = a + (b - a) * (n > 1 ? i / (n - 1) : 0);
    const v = Math.max(0, Math.min(1, (p - pi) / 0.05));
    if (v > 0.5) encendidos++;
    return { ...nodo, intensidad: (nodo.intensidad ?? 0.5) * v, activo: v > 0.5 && nodo.activo !== false,
             pendiente: v > 0.5 && nodo.pendiente === true };
  });
  return { nodos, encendidos };
}

/**
 * `opcionesEsfera` se le pasa tal cual a `crearEsfera()`: es cómo `index.html`
 * mete su `escalon` forzado y su `alSenalar`, para que la esfera que nace ya
 * sea la que va a quedarse y no haya que reconfigurarla al mudarla.
 */
export function montar(caja, { reducido = false, manual = false, opcionesEsfera = {}, datos = null } = {}) {
  const capa = document.createElement('div');
  capa.className = 'cg cg-naciendo';
  capa.innerHTML = '<div class="cg-escena"></div><div class="cg-fogonazo"></div>'
    + '<p class="cg-marca">PLSDASH</p><p class="cg-pie">Conectando con el nodo</p>';
  caja.appendChild(capa);

  const hueco = capa.querySelector('.cg-escena');
  const fogonazo = capa.querySelector('.cg-fogonazo');
  const marca = capa.querySelector('.cg-marca');
  const pie = capa.querySelector('.cg-pie');

  // La escena real —nodos, energía, frescura— en cuanto la haya.
  let escena = null;
  Promise.resolve(datos).then(e => { if (e && Array.isArray(e.nodos)) escena = e; }, () => {});

  let esfera = null, raf = 0, t0 = 0, esperando = false, entregada = false;
  let resolverEntrada = null;
  const laEntrada = new Promise(r => { resolverEntrada = r; });
  let laSalida = null;

  let ultimoPie = '';
  const ponerPie = t => { if (t !== ultimoPie) { pie.textContent = t; ultimoPie = t; } };

  const pintarEstado = p => {
    const { nodos, encendidos } = nodosA(p, escena?.nodos);
    esfera?.actualizar({ nodos, energia: escena?.energia ?? 0.6, frescura: escena?.frescura ?? 1 });
    if (!escena) ponerPie(p < 0.5 ? 'Encendiendo la red' : 'Esperando datos del nodo');
    else if (p < P_NODOS[0]) ponerPie('Encendiendo la red');
    else ponerPie(`Validadores · ${encendidos} de ${nodos.length}`);
  };

  /* ⚠ AL PRINCIPIO TODA LA RED ESTÁ EN UN PUNTO, y cientos de aristas sumadas
     en el mismo píxel con mezcla aditiva y resplandor dan un blanco que se
     come la pantalla. Se entra con la capa a media luz y se sube después del
     estallido: lo que se ve es el núcleo encendiéndose, no un fallo. */
  const fundir = p => { hueco.style.opacity = String(0.55 + 0.45 * Math.min(1, Math.max(0, (p - 0.1) / 0.3))); };
  const fogonear = p => { fogonazo.style.opacity = String(Math.exp(-Math.pow((p - P_FOGONAZO) * 13, 2)) * 0.8); };

  function bucle(ahora) {
    if (!t0) t0 = ahora;
    const t = ahora - t0;
    if (!esperando) {
      const p = Math.min(1, t / T_NACER);
      // Lineal y no `suave`: los tramos del estallido ya llevan sus propias
      // curvas dentro de `deformar()`, y otra curva encima los deformaba.
      esfera.nacer(p);
      pintarEstado(p); fundir(p); fogonear(p);
      if (t >= T_NACER + T_ASENTAR) { esperando = true; resolverEntrada(); }
    } else if (escena) {
      // En la espera, por si los datos llegan tarde: que entren sin saltos.
      pintarEstado(1);
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
    pintarEstado(0); fundir(0); fogonear(0);
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
      esfera.nacer(p);
      pintarEstado(p); fundir(p); fogonear(p);
    },
  };
}
