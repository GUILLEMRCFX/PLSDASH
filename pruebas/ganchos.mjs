/**
 * El gancho en sí. Se carga desde `resolver.mjs`, que es lo que se pasa a
 * `--import`. Va en un fichero aparte porque los ganchos corren en su propio
 * hilo y no pueden compartir estado con el programa principal.
 */
const RAIZ = new URL('..', import.meta.url).href.replace(/\/$/, '');

export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith('/val/')) {
    return { url: RAIZ + especificador, shortCircuit: true };
  }
  return siguiente(especificador, contexto);
}
