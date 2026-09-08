/**
 * Qué endpoints se piden de verdad, reconstruyendo las URL como el navegador.
 *
 * ## Por qué existe
 *
 * El 23-ago se borraron `/api/val/validadores` y `/api/val/logout` por muertos.
 * No lo estaban. El panel los pedía así:
 *
 *     const API = '/api/val';
 *     fetch(API + '/validadores')
 *
 * El literal «api/val/validadores» NO APARECE en ningún fichero del
 * repositorio, así que un grep del literal no los encuentra jamás. Y el fallo
 * del logout era peor todavía: la llamada va dentro de un `try/catch`, así que
 * sin endpoint el botón seguía navegando y la cookie no se borraba — parecía
 * que cerrabas sesión.
 *
 * Esto reconstruye las URL: busca la constante base de cada fichero y le pega
 * los sufijos que se le concatenan, igual que hace el navegador en tiempo de
 * ejecución. Después cruza lo que se pide contra lo que existe y dice qué sobra
 * y qué falta.
 *
 *   node pruebas/rutas-test.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
let fallos = 0, pruebas = 0;
const ok = (que, cond, detalle = '') => {
  pruebas++;
  if (!cond) { fallos++; console.log(`  FALLA ${que}${detalle ? '\n        ' + detalle : ''}`); }
  else console.log(`  OK   ${que}`);
};

function buscar(dir, exts, saltar = []) {
  const salida = [];
  for (const n of readdirSync(dir)) {
    if (saltar.includes(n)) continue;
    const r = join(dir, n);
    if (statSync(r).isDirectory()) salida.push(...buscar(r, exts, saltar));
    else if (exts.includes(extname(r))) salida.push(r);
  }
  return salida;
}

/**
 * Las URL que un fichero pide, resueltas.
 *
 * Tres formas, que son las tres que usa este proyecto:
 *   fetch('/api/val/estado')          literal
 *   fetch(API + '/estado')            concatenación
 *   fetch(`${API}/estado?rango=x`)    plantilla
 *
 * De la base se toma la ÚLTIMA declaración `const X = '/...'` del fichero, que
 * es como se declaran aquí: una sola, arriba.
 */
/**
 * Los ayudantes del fichero que pegan un sufijo a una base.
 *
 * ⚠ NO vale con «una llamada de un argumento que parece un camino». Probado:
 *   `includes('/p/')` y `split('/p/')` de la portada casaban con esa forma y
 *   salía un `/api/precio/p` inventado. Aquí se exige que la función esté
 *   DEFINIDA en el fichero y que su cuerpo concatene la base — que es lo que
 *   hace de verdad un ayudante de API.
 */
function envoltorios(src, bases) {
  const salida = [];
  for (const m of src.matchAll(/(?:function\s+([a-z]\w*)\s*\(|const\s+([a-z]\w*)\s*=\s*(?:async\s*)?\()/g)) {
    const nombre = m[1] || m[2];
    const cuerpo = src.slice(m.index, m.index + 500);
    for (const [nom, base] of Object.entries(bases)) {
      if (cuerpo.includes(nom + ' +') || cuerpo.includes('${' + nom + '}')) {
        salida.push([nombre, base]);
        break;
      }
    }
  }
  return salida;
}

function rutasDe(bruto) {
  /* ⚠ FUERA LOS COMENTARIOS ANTES DE MIRAR NADA. Este proyecto documenta los
     endpoints en los comentarios —«antes se guardaba en `/api/val/ajustes`»— y
     sin quitarlos el análisis daba por pedido un endpoint retirado hace dos
     commits. Un comentario que NOMBRA una ruta no la está pidiendo. */
  const src = bruto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  const bases = {};
  for (const m of src.matchAll(/const\s+([A-Z_]\w*)\s*=\s*['"](\/[^'"]*)['"]/g)) bases[m[1]] = m[2];

  const encontradas = new Set();

  // Literales que empiezan por /api/
  for (const m of src.matchAll(/['"`](\/api\/[^'"`\s)]*)['"`]/g)) encontradas.add(m[1]);

  /* Plantillas que EMPIEZAN por /api/ y llevan la consulta interpolada:
       fetch(`/api/inversiones?w=${sig.w}&tz=${tz}`)
     El literal nunca se cierra antes del `${`, así que la regla de arriba no lo
     ve y el endpoint salía como que no lo pide nadie. Se toma el trozo fijo
     hasta el primer `?` o `${`, que es lo que decide qué Function corre. */
  for (const m of src.matchAll(/`(\/api\/[^`]*)/g)) {
    encontradas.add(m[1].split(/[?]|\$\{/)[0]);
  }

  /* Las bases a las que SÍ se les pega algo. Se anotan para poder distinguir
     `const API = '/api/val'` —una base, nunca se pide a secas— de
     `const PRECIO_API = '/api/precio'`, que es el endpoint entero y se pide tal
     cual. Filtrar toda base por igual dejaba `/api/precio` como no pedido por
     la portada, o sea justo el tipo de falso negativo que hace borrar algo
     vivo. */
  const conSufijo = new Set();

  // BASE + '/sufijo'
  for (const m of src.matchAll(/([A-Z_]\w*)\s*\+\s*['"`](\/[^'"`]*)['"`]/g)) {
    if (bases[m[1]]) { encontradas.add(bases[m[1]] + m[2]); conSufijo.add(bases[m[1]]); }
  }

  // `${BASE}/sufijo`
  for (const m of src.matchAll(/\$\{([A-Z_]\w*)\}(\/[^`'"$\s)]*)/g)) {
    if (bases[m[1]]) { encontradas.add(bases[m[1]] + m[2]); conSufijo.add(bases[m[1]]); }
  }

  /* ⚠ LAS LLAMADAS ENVUELTAS, que son las que costaron la restauración.
     El v1 no escribe `fetch(API + '/validadores')`: escribe `api('/validadores')`,
     con un ayudante que por dentro hace la concatenación. Sin esta regla el
     endpoint sale como que no lo pide nadie —que es literalmente el análisis
     que llevó a borrarlo— y encima con la prueba en verde, que es peor.

     La regla: una llamada de un argumento cuyo argumento es un camino, en un
     fichero que declara UNA sola base, se resuelve contra esa base. Es una
     heurística; por eso se marca aparte al informar, para que se vea que aquí
     hubo una suposición y no una lectura. */
  for (const [nombre, base] of envoltorios(src, bases)) {
    const re = new RegExp(`\\b${nombre}\\s*\\(\\s*['"\`](/[^'"\`]*)['"\`]`, 'g');
    for (const m of src.matchAll(re)) encontradas.add(base + m[1]);
  }

  return new Set([...encontradas]
    .map(u => u.split('?')[0].replace(/\/$/, ''))
    .filter(u => !conSufijo.has(u)));
}

console.log('\n=== LO QUE EXISTE ===');
/* Cloudflare Pages enruta por fichero: `functions/api/val/estado.js` atiende
   `/api/val/estado`. Los `_lib`, `_middleware` y `[param]` no son endpoints. */
const existen = buscar(join(RAIZ, 'functions/api'), ['.js'])
  .map(r => '/' + relative(RAIZ, r).replace(/\.js$/, ''))
  .filter(u => !u.includes('/_'))
  .map(u => u.replace(/^\/functions/, ''));
const dinamicos = existen.filter(u => u.includes('['));
const fijos = existen.filter(u => !u.includes('['));
console.log('  ' + fijos.join('\n  '));
if (dinamicos.length) console.log('  (con parámetro, no se cruzan): ' + dinamicos.join(', '));

console.log('\n=== LO QUE SE PIDE ===');
/* El cliente entero: la portada, el panel y todo lo que cuelgue de `val/`. Las
   Functions se excluyen a propósito — una Function que menciona `/api/val/x` en
   un comentario no lo está PIDIENDO, y contarlo mantendría vivo un endpoint
   muerto solo porque otro fichero habla de él. */
const clientes = [
  join(RAIZ, 'index.html'),
  join(RAIZ, 'vault.js'),
  ...buscar(join(RAIZ, 'val'), ['.js', '.html'], ['vendor']),
];
const piden = new Map();
for (const f of clientes) {
  for (const u of rutasDe(readFileSync(f, 'utf8'))) {
    if (!u.startsWith('/api/')) continue;
    if (!piden.has(u)) piden.set(u, []);
    piden.get(u).push(relative(RAIZ, f));
  }
}
for (const [u, quien] of [...piden].sort()) console.log(`  ${u}  ←  ${quien.join(', ')}`);

console.log('\n=== SE PIDE ALGO QUE NO EXISTE ===');
/* ⚠ Éste es el fallo que rompe el panel en producción sin dar ningún error en
   local: se borra un endpoint y la llamada se queda. */
/* Una ruta con parámetro cubre todo lo que cuelga de ella:
   `functions/api/portfolio/[code].js` atiende `/api/portfolio/<lo que sea>`, y
   la llamada se compone como `/api/portfolio/${code}` — o sea que lo fijo que
   se puede reconstruir es el prefijo. */
const prefijos = dinamicos.map(u => u.slice(0, u.indexOf('/[')));
const existe = u => fijos.includes(u) || prefijos.some(p => u === p || u.startsWith(p + '/'));

const fantasmas = [...piden.keys()].filter(u => !existe(u));
ok('todo lo que se pide existe', fantasmas.length === 0,
  fantasmas.map(u => `${u}  ←  ${piden.get(u).join(', ')}`).join('\n        '));

console.log('\n=== EXISTE ALGO QUE NO PIDE NADIE ===');
/* Esto NO es un fallo: puede haber endpoints que sirvan a otra cosa. Es un
   aviso, y sale con nombres para poder decidir uno por uno en vez de borrar a
   ciegas, que es exactamente como se rompió esto la primera vez. */
const huerfanos = fijos.filter(u => !piden.has(u));
if (huerfanos.length) {
  console.log('  ⚠ ' + huerfanos.join('\n  ⚠ '));
  console.log('    (no es un fallo: decídelo uno por uno antes de borrar nada)');
} else {
  console.log('  ninguno');
}

console.log('\n=== LOS DOS QUE YA SE BORRARON POR ERROR ===');
// Se comprueban por nombre porque son los que ya costaron una restauración.
for (const u of ['/api/val/logout', '/api/val/auth']) {
  ok(`${u} lo pide alguien`, piden.has(u),
    'nadie lo pide: si es de verdad, quítalo; si no, algo se ha roto');
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
