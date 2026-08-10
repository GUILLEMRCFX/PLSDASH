/**
 * PLSDASH — enrutado por hostname.
 *
 * Un solo proyecto de Pages sirve dos sitios:
 *
 *   plsdash.com      → el portfolio público (index.html)
 *   val.plsdash.com  → el Validator Dashboard, servido en la raíz
 *
 * El panel no se enlaza desde ninguna parte y el dominio principal lo niega,
 * así que `plsdash.com/val/` deja de ser una puerta adivinable al mismo sitio.
 *
 * ⚠ EL VAULT DEPENDE DE QUE `VAL_HOST` SIGA SIN DEFINIR.
 *
 * El Easter egg de la portada (`/vault.js`) manda el PIN a `/api/val/auth`
 * desde `plsdash.com`. En cuanto se define `VAL_HOST`, esa llamada empieza a
 * recibir 404 y el candado se limita a rechazar cualquier combinación, sin
 * decir por qué — que es justo lo que hace ante un PIN incorrecto, así que el
 * fallo es indistinguible del funcionamiento normal.
 *
 * Para mover el panel a `val.plsdash.com` conservando el Vault hacen falta dos
 * cambios: dejar pasar `/api/val/auth` desde el dominio principal, y emitir la
 * cookie con `Domain=.plsdash.com` — sin eso no viaja entre hostnames y el
 * panel volvería a pedir el PIN nada más llegar.
 *
 * ACTIVACIÓN: mientras no exista la variable de entorno `VAL_HOST` este
 * middleware no cambia nada. Así el panel sigue accesible en
 * `plsdash.com/val/` hasta que el subdominio esté configurado y probado, y
 * no hay una ventana en la que no se pueda entrar por ningún sitio. Cuando
 * `val.plsdash.com` funcione, se define VAL_HOST=val.plsdash.com y el
 * enrutado y el bloqueo entran en vigor a la vez.
 *
 * Solo las rutas de `_routes.json` pasan por aquí; si se añaden rutas nuevas
 * al panel hay que incluirlas también allí o se servirán sin pasar el filtro.
 */

const RUTA_PANEL = '/val/index.html';

const noEncontrado = () =>
  new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

export async function onRequest({ request, env, next }) {
  const valHost = (env.VAL_HOST || '').trim().toLowerCase();

  // Sin VAL_HOST configurado el middleware se aparta: comportamiento de hoy.
  if (!valHost) return next();

  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const esVal = host === valHost;

  // Los despliegues de previsualización llevan su propio hostname y son la
  // única forma de probar un cambio antes de que llegue al dominio real.
  const esPreview = host.endsWith('.pages.dev');

  // La API del panel solo tiene sentido desde el panel. El PIN sigue siendo
  // quien protege los datos; esto solo reduce la superficie expuesta.
  if (url.pathname.startsWith('/api/val/')) {
    return (esVal || esPreview) ? next() : noEncontrado();
  }

  if (esVal) {
    // El subdominio sirve el panel en la raíz. Se pide al servidor de
    // estáticos directamente en lugar de a next(): `/val/*` también pasa por
    // este middleware, y reescribir la URL hacia next() podría reentrar aquí.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return env.ASSETS.fetch(new Request(new URL(RUTA_PANEL, url), request));
    }
    // `/val/` en el subdominio sería la misma página con dos URLs distintas.
    if (url.pathname === '/val' || url.pathname.startsWith('/val/')) {
      return Response.redirect(new URL('/', url).toString(), 301);
    }
    // El subdominio no sirve el portfolio.
    return noEncontrado();
  }

  // Dominio principal (y cualquier otro): el panel no existe.
  if (url.pathname === '/val' || url.pathname.startsWith('/val/')) {
    return esPreview ? next() : noEncontrado();
  }

  return next();
}
