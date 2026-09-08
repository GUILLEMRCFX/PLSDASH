/**
 * El sitio, servido en local para las pruebas de navegador.
 *
 * Imita a Cloudflare Pages en lo único que importa aquí: sirve los ficheros tal
 * cual desde la raíz del repositorio y devuelve `404.html` para lo que no
 * existe, que es lo que hace que la redirección de rutas del proyecto se pueda
 * probar. Las Functions NO corren: las pruebas que las tocan importan el módulo
 * directamente y le pasan una D1 de mentira, que es más rápido y más exacto que
 * levantar `wrangler`.
 *
 *   node pruebas/servidor.js        → http://127.0.0.1:8899
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PUERTO = Number(process.env.PUERTO || 8899);

const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.ico': 'image/x-icon',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};

const servidor = http.createServer((req, res) => {
  let ruta = decodeURIComponent(req.url.split('?')[0]);
  if (ruta.endsWith('/')) ruta += 'index.html';

  /* ⚠ Sin esto, un `..` en la URL saca al servidor del repositorio. Es una
     herramienta local, pero una que lee ficheros arbitrarios del disco no
     debería existir ni en local. */
  const destino = path.join(RAIZ, path.normalize(ruta));
  if (!destino.startsWith(RAIZ)) { res.writeHead(403).end('fuera'); return; }

  fs.readFile(destino, (err, cuerpo) => {
    if (err) {
      // Como Pages: lo que no existe se sirve con el 404 del sitio, que es el
      // que guarda la ruta y redirige. Sin esto no se puede probar.
      fs.readFile(path.join(RAIZ, '404.html'), (e2, c2) => {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end(e2 ? 'no encontrado' : c2);
      });
      return;
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(destino)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(cuerpo);
  });
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`sirviendo ${RAIZ} en http://127.0.0.1:${PUERTO}`);
});
