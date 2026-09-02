/**
 * La pantalla de carga: el contrato.
 *
 * Hay varias candidatas y todas hacen lo mismo por fuera. Este módulo es lo
 * único que sabe CUÁNDO pasa cada cosa; cada candidata solo sabe DIBUJAR.
 *
 * ## Las tres fases, y por qué son tres
 *
 * El encargo dice dos cosas que parecen reñidas: «aunque los datos ya estén
 * cargados, la animación se ve entera» y «si tardan más, se alarga hasta que
 * lleguen; nunca se corta». Con una sola animación de duración fija no se puede
 * cumplir: o la cortas cuando llegan los datos, o haces esperar de más cuando
 * ya están.
 *
 * Se resuelve partiéndola en tres:
 *
 *   entrada   duración fija. Se ve SIEMPRE entera, pasase lo que pasase con la
 *             red. Es la parte que cuenta algo.
 *   espera    sostenible indefinidamente. Si los datos no han llegado al acabar
 *             la entrada, esto es lo que se ve, y puede durar 200 ms o diez
 *             segundos sin que se note la costura. Si ya habían llegado, dura
 *             cero y no se ve.
 *   salida    duración fija. Entrega el panel. También entera.
 *
 * O sea: el suelo es `entrada + salida` y el techo lo pone la red. Ninguna de
 * las dos partes con coreografía se interrumpe nunca.
 *
 * ## El mínimo
 *
 * 1600 ms de suelo (1000 de entrada + 600 de salida). El motivo de que no sea
 * más corto: por debajo de ~1,2 s la animación se lee como un parpadeo y da la
 * sensación contraria a la que se busca —parece que algo ha fallado y se ha
 * repintado—. Y de que no sea más largo: esto se ve cada vez que abres el
 * panel, y el panel se abre a diario.
 *
 * Medido en local contra el servidor de pruebas, `cargarTodo()` resuelve sus
 * diez peticiones en 40-90 ms; contra Cloudflare desde el móvil serán unos
 * cientos. En los dos casos manda la animación, que es justo lo pedido.
 *
 * ## Movimiento reducido
 *
 * Con `prefers-reduced-motion: reduce` no se hace la coreografía: se enseña la
 * marca quieta y se funde. El mínimo baja a 400 ms, porque esperar por algo que
 * no se mueve es esperar por nada. La espera por datos se respeta igual.
 */

/** El suelo, en milisegundos. Un solo número: cambiarlo aquí lo cambia todo. */
export const MIN_MS = 1600;

/** El suelo cuando el sistema pide poco movimiento. */
export const MIN_MS_REDUCIDO = 400;

export const reducido = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const esperar = ms => new Promise(r => setTimeout(r, ms));

/**
 * Arranca la pantalla.
 *
 * `pieza` es el módulo de la candidata. Tiene que exportar `montar(caja, ctx)`
 * y devolver `{ entrada(), salida(), destruir() }`, donde `entrada` y `salida`
 * son promesas que se resuelven cuando su tramo ha terminado de verdad —no con
 * un `setTimeout` a ojo, sino cuando la animación acaba—.
 *
 * Se usa así:
 *
 *   const carga = iniciarCarga(caja, pieza);
 *   const datos = await cargarTodo();
 *   await carga.terminar();       // espera al suelo y hace la salida
 *
 * `terminar()` es idempotente y se puede llamar antes de que acabe la entrada:
 * la cola interna se encarga de que la salida no pise a la entrada.
 */
export function iniciarCarga(caja, pieza, opciones = {}) {
  const menos = opciones.reducido ?? reducido();
  const minMs = opciones.minMs ?? (menos ? MIN_MS_REDUCIDO : MIN_MS);
  const t0 = performance.now();

  const vista = pieza.montar(caja, { reducido: menos });
  const entrada = Promise.resolve(vista.entrada());

  let fin = null;
  return {
    /** Para las pruebas y para el previo. */
    vista,
    minMs,
    terminar() {
      if (fin) return fin;
      fin = (async () => {
        // 1. La entrada, entera. Pase lo que pase.
        await entrada;
        // 2. El suelo. Si la entrada ya se lo comió, esto es cero.
        const queda = minMs - (performance.now() - t0);
        if (queda > 0) await esperar(queda);
        // 3. La salida, entera.
        await vista.salida();
        vista.destruir();
      })();
      return fin;
    },
  };
}

/**
 * Las candidatas, por nombre. El `import()` es perezoso a propósito: en
 * producción solo se carga la elegida, y en el previo se cargan las cuatro
 * porque allí es lo que se quiere.
 */
export const CANDIDATAS = {
  naciendo: {
    titulo: 'La esfera naciendo',
    resumen: 'Las partículas se ensamblan en la malla Voronoi y el panel aparece encima. '
           + 'La carga no desaparece: se convierte en el panel.',
    cargar: () => import('./naciendo.js'),
  },
  constelacion: {
    titulo: 'La constelación',
    resumen: 'Los once nodos se confirman uno a uno y se van uniendo.',
    cargar: () => import('./constelacion.js'),
  },
  escaner: {
    titulo: 'Escáner de rayos X',
    resumen: 'Una línea barre la pantalla y va revelando la interfaz debajo.',
    cargar: () => import('./escaner.js'),
  },
  compuerta: {
    titulo: 'La compuerta',
    resumen: 'Un iris mecánico abriéndose, del mismo gesto que la cripta de la portada.',
    cargar: () => import('./compuerta.js'),
  },
};
