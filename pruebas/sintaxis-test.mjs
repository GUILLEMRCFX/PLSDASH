/**
 * Que todo parsee. Suena a poco y es la prueba que más veces ha saltado.
 *
 * ## Por qué existe
 *
 * En este proyecto hay un fallo que se ha repetido NUEVE veces: una comilla
 * inversa dentro de un comentario que vive dentro de una plantilla. La comilla
 * cierra la plantilla, el resto del fichero se lee como código y el módulo
 * revienta al cargarse con un error que no señala al comentario. Como los
 * módulos del panel se cargan en el navegador y sin build, nadie se entera
 * hasta abrir la página.
 *
 * Y su equivalente en CSS: un `}` de más o de menos. No da error en ninguna
 * parte —el navegador cierra el bloque por su cuenta y sigue— así que lo que se
 * ve es que una regla deja de aplicarse en un sitio y aparece en otro. Ya pasó:
 * al quitar un `@media` obsoleto se quedó una llave suelta y una línea del
 * panel encogió de 475 a 392px sin que nada se quejara.
 *
 * Se comprueba SIN EJECUTAR, con `node --check` sobre una copia `.mjs`: aquí
 * interesa la sintaxis, y ejecutar exigiría un DOM que no hay.
 *
 *   node pruebas/sintaxis-test.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';

const RAIZ = new URL('..', import.meta.url).pathname;
let fallos = 0, pruebas = 0;
const ok = (que, cond, detalle = '') => {
  pruebas++;
  if (!cond) { fallos++; console.log(`  FALLA ${que}${detalle ? '\n        ' + detalle : ''}`); }
  else console.log(`  OK   ${que}`);
};

/** Todos los ficheros con esa extensión bajo `dir`, menos lo que no es nuestro. */
function buscar(dir, ext, saltar = []) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    if (saltar.includes(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...buscar(ruta, ext, saltar));
    else if (extname(ruta) === ext) salida.push(ruta);
  }
  return salida;
}

const tmp = mkdtempSync(join(tmpdir(), 'plsdash-sintaxis-'));

try {
  console.log('\n=== MÓDULOS ===');
  // `vendor` fuera: three.js no es nuestro y tarda un segundo largo en parsear.
  const modulos = [
    ...buscar(join(RAIZ, 'val/v2'), '.js', ['vendor']),
    ...buscar(join(RAIZ, 'val/compartido'), '.js'),
    ...buscar(join(RAIZ, 'functions'), '.js'),
    join(RAIZ, 'vault.js'),
  ];
  for (const ruta of modulos) {
    const copia = join(tmp, 'x.mjs');
    writeFileSync(copia, readFileSync(ruta, 'utf8'));
    let error = null;
    try { execFileSync(process.execPath, ['--check', copia], { stdio: 'pipe' }); }
    catch (e) { error = String(e.stderr || e.message).split('\n').slice(0, 4).join('\n        '); }
    ok(relative(RAIZ, ruta), !error, error);
  }
  console.log(`  (${modulos.length} módulos)`);

  console.log('\n=== HOJAS DE ESTILO ===');
  /* Contar llaves ignorando las que van dentro de una cadena o de un
     comentario. Sin eso, un `content: "}"` cuenta como cierre y la prueba
     avisa de un desequilibrio que no existe. */
  const cuentaLlaves = css => {
    let abre = 0, cierra = 0, i = 0;
    while (i < css.length) {
      const c = css[i];
      if (c === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
      if (c === '"' || c === "'") {
        const fin = c; i++;
        while (i < css.length && css[i] !== fin) i += css[i] === '\\' ? 2 : 1;
        i++; continue;
      }
      if (c === '{') abre++;
      if (c === '}') cierra++;
      i++;
    }
    return { abre, cierra };
  };

  const hojas = buscar(join(RAIZ, 'val'), '.css', ['vendor']);
  for (const ruta of hojas) {
    const { abre, cierra } = cuentaLlaves(readFileSync(ruta, 'utf8'));
    ok(`${relative(RAIZ, ruta)} cuadra de llaves`, abre === cierra, `${abre} abren, ${cierra} cierran`);
  }

  console.log('\n=== COMILLAS INVERSAS EN COMENTARIOS HTML ===');
  /* El fallo de las nueve veces, buscado por su forma exacta.
   *
   * ⚠ NO vale con «una comilla inversa dentro de un comentario». Los JSDoc de
   *   este proyecto están llenos de `referencias` entre comillas inversas y son
   *   correctas: viven en código, no dentro de una plantilla. Una primera
   *   versión de esta comprobación buscaba eso y señalaba 38 ficheros sanos —
   *   una prueba que grita en todo lo que mira no la mira nadie.
   *
   * Lo que sí rompe es la comilla inversa en un comentario HTML, porque ése
   * solo puede estar DENTRO de una plantilla: ahí la comilla no es texto, es el
   * cierre de la plantilla. `--check` caza el caso en que además rompe el
   * parseo; esto caza también el caso en que casa con otra comilla y el fichero
   * sigue parseando, que es peor porque entonces lo que sale mal es el HTML que
   * escribe la plantilla y no lo dice nadie. */
  for (const ruta of modulos) {
    const src = readFileSync(ruta, 'utf8');
    const malos = [...src.matchAll(/<!--[\s\S]*?-->/g)]
      .filter(m => m[0].includes('`'))
      .map(m => m[0].slice(0, 70).replace(/\s+/g, ' '));
    if (!src.includes('<!--')) continue;
    ok(`${relative(RAIZ, ruta)} sin comillas inversas en comentarios HTML`,
      malos.length === 0, malos.join(' … '));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
