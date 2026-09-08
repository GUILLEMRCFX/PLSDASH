/**
 * El panel «Si PLS valiera otra cosa», por sus funciones.
 *
 * Sin navegador a propósito: todo lo que importa aquí —la escala, la constante
 * del sacrificio, las cuatro cifras, dónde caen las marcas— son funciones puras
 * que se pueden llamar con números a mano. Levantar Chromium para esto sería
 * cambiar dos segundos de prueba por treinta sin comprobar nada más.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/precio-panel-test.mjs
 */
import {
  SACRIFICIO, MIN, MAX, PASOS,
  precioDesde, posicionDe, valorar, cifras, marcas, panelPrecioSimulado,
} from '/val/v2/paneles/precio-simulado.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

let fallos = 0, pruebas = 0;
const ok = (que, real, esperado) => {
  pruebas++;
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallos++;
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${que}`
    + (bien ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`));
};
const okQue = (que, cond, detalle = '') => {
  pruebas++;
  if (!cond) { fallos++; console.log(`  FALLA ${que}${detalle ? ' · ' + detalle : ''}`); }
  else console.log(`  OK   ${que}`);
};

const RAIZ = new URL('..', import.meta.url).pathname;
const texto = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Ficheros del cliente, fuera de `precio-simulado.js`, que declaren su propia
 *  copia del precio del sacrificio. Debería no haber ninguno. */
function buscarConstante(raiz) {
  const salida = [];
  const mirar = dir => {
    for (const n of readdirSync(dir)) {
      if (n === 'vendor' || n === 'node_modules') continue;
      const r = join(dir, n);
      if (statSync(r).isDirectory()) { mirar(r); continue; }
      if (!['.js', '.html'].includes(extname(r))) continue;
      if (r.endsWith('precio-simulado.js')) continue;
      const src = readFileSync(r, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');
      if (/(PRECIO_)?SACRIFICIO\s*=/.test(src)) salida.push(relative(raiz, r));
    }
  };
  mirar(join(raiz, 'val'));
  mirar(join(raiz, 'index.html').replace(/\/index\.html$/, '')); // la raíz, solo sus ficheros
  return [...new Set(salida)];
}

/* El precio real de PLS con el que se ha ido comprobando todo. Es el mismo con
   el que se compararon el v1 y el v2, así que las cifras de abajo se pueden
   contrastar contra lo que enseña el panel viejo. */
const PRECIO = 0.00001426;

console.log('\n=== 1. EL PRECIO DEL SACRIFICIO ===');
/* ⚠ ESTA ES LA COMPROBACIÓN QUE MÁS FALTA HACÍA, y la que nació de una
   equivocación real: en la tabla de ajustes había guardado un 0,001 —un cero de
   menos— y el panel daba −98,6 % y ×70 donde el v1 da −85,7 % y ×7,0. Un factor
   de diez en la cifra de cabecera que nadie vio porque un campo de texto acepta
   lo que le pongas. Ahora es constante y aquí se fija. */
ok('vale 0,0001', SACRIFICIO, 0.0001);
{
  /* ⚠ AQUÍ HABÍA UNA COMPROBACIÓN CRUZADA CONTRA EL V1, y se retira a
     sabiendas. Leía el `PRECIO_SACRIFICIO = 0.0001` de `val/index.html` y
     exigía que coincidiera con la constante de aquí: existía porque el mismo
     número vivía en dos paneles y ya se habían separado una vez —0,001 contra
     0,0001, un factor de diez en la cifra de cabecera—.
     
     El v1 se retiró el 8-sep-2026, así que ya no hay dos sitios que puedan
     divergir. Lo que queda es asegurarse de que no vuelve a haberlos: si algún
     día reaparece un segundo panel con su propia copia del número, esto lo
     dice antes de que las dos cifras se separen otra vez. */
  const otro = buscarConstante(RAIZ);
  okQue('el número vive en UN solo sitio', otro.length === 0,
    'también aparece en: ' + otro.join(', '));
}
{
  const fuente = readFileSync(RAIZ + 'val/v2/paneles/precio-simulado.js', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // El ajuste editable se retiró entero. Que no vuelva por la puerta de atrás.
  ok('no queda lectura de ajustes', /ajustes\?\.precio_entrada/.test(fuente), false);
  ok('ni petición al endpoint', /api\/val\/ajustes/.test(fuente), false);
  ok('ni formulario', /psForm|ps-guardar/.test(fuente), false);
  const datos = readFileSync(RAIZ + 'val/v2/datos.js', 'utf8');
  ok('y el cargador ya no lo pide', /ajustes/.test(datos), false);
}

console.log('\n=== 2. LA ESCALA, LOGARÍTMICA ===');
ok('va de 1e-6 a 1e-2', [precioDesde(0), precioDesde(PASOS)], [MIN, MAX]);
/* A mitad de recorrido, la media GEOMÉTRICA y no la aritmética. Con lineal
   saldría 0,005 y el precio de hoy viviría aplastado contra el cero. */
ok('a mitad de recorrido, la media geométrica', +precioDesde(PASOS / 2).toPrecision(4), 1e-4);
/* Ida y vuelta. Si no cuadra, las marcas se desplazan respecto al tirador.
   ⚠ Con 1000 pasos, 1,426e-5 volvía como 1,432e-5 y el panel arrancaba
     marcándose «simulado» sin que nadie tocara nada. Por eso son 4000. */
ok('ir y volver devuelve el mismo precio',
  [1e-6, 1e-5, PRECIO, 1e-4, 1e-2].map(v => +precioDesde(posicionDe(v)).toPrecision(4)),
  [1e-6, 1e-5, 1.426e-5, 1e-4, 1e-2]);

console.log('\n=== 3. LAS CIFRAS, CONTRA EL PRECIO REAL ===');
{
  const r = valorar({ precio: PRECIO, stakePls: 320e6, ganadoPls: 792082, plsDia: 8000 });
  ok('el stake, a este precio', +r.stake.toFixed(2), 4563.20);
  okQue('la distancia al sacrificio es −85,7 %', Math.abs(r.vsEntrada + 85.740) < 0.01, String(r.vsEntrada));
  okQue('y hace falta ×7,0 para volver', Math.abs(r.paraVolver - 7.013) < 0.01, String(r.paraVolver));
  const t = texto(cifras(r));
  okQue('la cifra sale rotulada', /-85,7 % Frente a tu entrada/.test(t), t);
  /* El subtítulo NOMBRA la referencia. Siendo una constante, sin nombrarla es
     un porcentaje sin origen: el usuario no puede saber contra qué se compara. */
  okQue('y el subtítulo dice contra qué', /para volver a 0,000100 \$/.test(t), t);
}
{
  // Por encima del sacrificio cambia el sentido de la frase, no solo el signo.
  const r = valorar({ precio: 0.01, stakePls: 320e6, ganadoPls: 0, plsDia: 0 });
  okQue('por encima, se dice al revés',
    /por encima del sacrificio, 0,000100 \$/.test(texto(cifras(r))), texto(cifras(r)));
}

console.log('\n=== 4. LAS DOS MARCAS DEL CARRIL ===');
{
  const html = marcas(PRECIO);
  const p = [...html.matchAll(/--p:([\d.]+)/g)].map(m => Number(m[1]));
  ok('son dos', p.length, 2);
  okQue('una es la de ahora', /ps-marca-ahora/.test(html), html);
  okQue('y otra la del sacrificio', /ps-marca-sac/.test(html), html);
  /* ⚠ Que estén las dos NO BASTA: tienen que caer en sitios distintos. Con la
     misma posición se ven como una sola rayita, que es exactamente el fallo que
     había —el tirador tapaba la de «ahora»— y lo que se pidió arreglar. */
  okQue('caen en sitios distintos', p[0] !== p[1], JSON.stringify(p));
  // 0,0001 es el centro geométrico del rango, así que cae justo en la mitad.
  ok('la del sacrificio, en la mitad del carril', +p[1].toFixed(3), 0.5);
  ok('la de ahora, donde toca', +p[0].toFixed(3), +(posicionDe(PRECIO) / PASOS).toFixed(3));
}
{
  // Sin precio no hay marca de «ahora», pero la del sacrificio no depende de nada.
  const p = [...marcas(null).matchAll(/--p:/g)];
  ok('sin precio queda solo la del sacrificio', p.length, 1);
}

console.log('\n=== 5. EL PANEL, ENTERO ===');
{
  const html = panelPrecioSimulado({
    estado: { validadores: { total: 10, stake_total: 320e6, pls_dia: 8000 } },
    serie: [], snapshots24h: [], ganancia: { saldo_wallet: 0 },
    precio: { disponible: true, precio: PRECIO },
  });
  ok('los dos atajos, en este orden',
    [...html.matchAll(/class="p-marca ps-ir" id="ps(\w+)"/g)].map(m => m[1]),
    ['Ahora', 'Sacrificio']);
  ok('sin plegable de ajustes', /ps-desp|ps-abrir/.test(html), false);
  okQue('y el título del botón dice el precio',
    /del sacrificio: 0,000100 \$/.test(html), 'no está');
}
{
  // Sin precio de PLS el panel calla, en vez de partir de un cero inventado.
  const html = panelPrecioSimulado({ estado: {}, precio: { disponible: false } });
  okQue('sin precio, se dice', /no hay desde dónde partir/.test(html), html.slice(0, 120));
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
