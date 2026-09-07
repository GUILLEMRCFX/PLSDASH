/**
 * Gancho de resolución para los módulos del panel.
 *
 * Los módulos del v2 se importan entre ellos con rutas ABSOLUTAS de web
 * —`import { ritmoDiario } from '/val/compartido/ganancias.js'`— porque en el
 * navegador eso es la raíz del sitio. En Node, `/val/...` es la raíz del disco
 * y no existe, así que una prueba que importe un panel se cae antes de empezar.
 *
 * Esto lo traduce: cualquier especificador que empiece por `/val/` se resuelve
 * contra la raíz del repositorio. Nada más. No se toca ningún otro
 * especificador, para que un error de importación de verdad siga saliendo.
 *
 * Uso:  node --import ./pruebas/resolver.mjs pruebas/loquesea-test.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ganchos.mjs', import.meta.url);

export const RAIZ = new URL('..', import.meta.url).pathname;
export const raizUrl = pathToFileURL(RAIZ);
