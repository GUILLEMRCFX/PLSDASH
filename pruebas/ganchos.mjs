/**
 * El gancho en sí. Se carga desde `resolver.mjs`, que es lo que se pasa a
 * `--import`. Va en un fichero aparte porque los ganchos corren en su propio
 * hilo y no pueden compartir estado con el programa principal.
 */
const RAIZ = new URL('..', import.meta.url).href.replace(/\/$/, '');

export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith('/val/')) {
    // La web vive en `public/` desde el 25-sep-2026: es lo único que publica Pages.
    return { url: RAIZ + '/public' + especificador, shortCircuit: true };
  }
  return siguiente(especificador, contexto);
}
