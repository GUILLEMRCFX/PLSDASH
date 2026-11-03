/**
 * El gancho en sí. Se carga desde `resolver.mjs`, que es lo que se pasa a
 * `--import`. Va en un fichero aparte porque los ganchos corren en su propio
 * hilo y no pueden compartir estado con el programa principal.
 */
const RAIZ = new URL('..', import.meta.url).href.replace(/\/$/, '');

export async function resolve(especificador, contexto, siguiente) {
  // `/i18n/` desde el 3-nov-2026: el motor de idiomas, que el panel importa.
  if (especificador.startsWith('/val/') || especificador.startsWith('/i18n/')) {
    // La web vive en `public/` desde el 25-sep-2026: es lo único que publica Pages.
    return { url: RAIZ + '/public' + especificador, shortCircuit: true };
  }
  return siguiente(especificador, contexto);
}
