/**
 * La calibración del tamaño de los nodos de la esfera.
 *
 * Aquí no se prueban píxeles: se prueba la LEY que convierte bloques
 * propuestos en tamaño. Los píxeles se miden aparte, capturando la esfera
 * (ver la cabecera de las constantes en `escena/esfera.js`, que lleva la
 * medida con su pasada de control).
 *
 * Lo que de verdad vigila este fichero es UNA propiedad:
 *
 *   ⚠ QUE LA ESCALA NO ENCOJA SOLA CUANDO CREZCAN LOS BLOQUES.
 *
 * La ley anterior dividía por el máximo del grupo, y eso la condenaba a
 * degradarse sin que nadie tocara nada: con un rango de 1 a 7 un bloque de
 * diferencia movía 1/7 de la escala; con 0 a 13 movía 1/13; con 5 a 30 movería
 * 1/30. Cuanto más tiempo lleva el nodo funcionando, menos se distingue —lo
 * contrario de lo que hace falta— y había que recalibrar cada pocos meses.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/esfera-calibracion-test.mjs
 */
import { intensidadesDesde, nodosDesde } from '/val/v2/escena/estado-escena.js';

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
/** Redondeo a tres decimales para comparar sin pelearse con el coma flotante. */
const r3 = v => v.map(x => Math.round(x * 1000) / 1000);

console.log('\n=== 1. LA ESCALA NO DEPENDE DE LO GRANDES QUE SEAN LOS NÚMEROS ===');
{
  /* Los mismos validadores con todo multiplicado por diez se dibujan IGUAL:
     lo que se cuenta es quién destaca dentro del grupo, no cuántos bloques
     lleva el grupo en total.

     ⚠ Esto SOLO es una comprobación de cordura: la ley vieja también lo
       cumplía, porque dividir por el máximo también es invariante de escala.
       Las que de verdad discriminan son la de 5..30 de aquí abajo —donde el
       suelo del 0,28 aplasta el extremo bajo— y la del afortunado del bloque
       2, donde la referencia importa. Comprobado: con la ley vieja puesta,
       este fichero se pone rojo en ocho asertos. */
  const hoy = [0, 3, 4, 5, 5, 6, 6, 7, 7, 8, 9, 13];
  const dentroDeUnAño = hoy.map(n => n * 10);
  ok('multiplicar por diez no cambia nada',
    r3(intensidadesDesde(dentroDeUnAño)), r3(intensidadesDesde(hoy)));
  ok('ni por cien', r3(intensidadesDesde(hoy.map(n => n * 100))), r3(intensidadesDesde(hoy)));

  /* Y el caso que de verdad va a pasar dentro de tres meses: nadie a cero,
     todos más altos. El grupo sigue repartido por toda la escala. */
  const enTresMeses = [5, 9, 11, 13, 14, 15, 16, 17, 19, 22, 26, 30];
  const v = intensidadesDesde(enTresMeses);
  // Mediana 15,5: el 5 cae en 0,16 y el 30 en 0,97. Ocupan el 81 % de la
  // escala sin tocar los topes, que es justo lo que se quiere — el tope está
  // reservado para el que de verdad dobla al grupo.
  okQue('con 5..30 se sigue usando casi toda la escala',
    Math.max(...v) - Math.min(...v) > 0.8, `${Math.min(...v)} … ${Math.max(...v)}`);
  okQue('el menor sigue abajo', Math.min(...v) < 0.2, String(Math.min(...v)));
  okQue('y el mayor arriba', Math.max(...v) > 0.9, String(Math.max(...v)));
}

console.log('\n=== 2. LOS PUNTOS FIJOS DE LA LEY ===');
{
  const v = intensidadesDesde([0, 6, 12]);      // mediana 6
  ok('cero bloques va al mínimo', r3([v[0]]), [0]);
  ok('la mediana, al medio', r3([v[1]]), [0.5]);
  ok('el doble de la mediana, al máximo', r3([v[2]]), [1]);
}
{
  // Más allá del doble no se sigue creciendo: a partir de ahí la diferencia ya
  // está dicha y lo único que se conseguiría es aplastar a los demás.
  const v = intensidadesDesde([6, 6, 6, 12, 40]);      // mediana 6
  ok('por encima del doble se topa', r3([v[3], v[4]]), [1, 1]);
}
{
  /* ⚠ UN SOLO VALIDADOR CON SUERTE NO PUEDE ENCOGER A LOS DEMÁS. Con el
     máximo como referencia —la ley vieja— cuatro validadores iguales a 5 con
     uno a 50 al lado se iban todos al suelo de la escala y parecían muertos.
     La mediana no se mueve por un caso extremo. */
  const v = intensidadesDesde([5, 5, 5, 5, 50]);
  ok('los cuatro normales se quedan en el medio', r3(v.slice(0, 4)), [0.5, 0.5, 0.5, 0.5]);
  ok('y el afortunado, arriba', r3([v[4]]), [1]);
}

console.log('\n=== 3. LOS CASOS ABURRIDOS SE DIBUJAN ABURRIDOS ===');
{
  // Doce casi iguales SON casi iguales, y la esfera tiene que decir eso. Con el
  // máximo como referencia, el que llevara un bloque más saltaba al tope.
  const v = intensidadesDesde([6, 6, 6, 7, 6, 6, 7, 6, 6, 6, 7, 6]);
  okQue('nadie destaca de verdad', Math.max(...v) - Math.min(...v) < 0.12,
    `${Math.min(...v)} … ${Math.max(...v)}`);
}
ok('todos exactamente iguales, todos al medio',
  r3(intensidadesDesde([4, 4, 4])), [0.5, 0.5, 0.5]);
ok('nadie ha propuesto nada: nadie destaca',
  r3(intensidadesDesde([0, 0, 0, 0])), [0.5, 0.5, 0.5, 0.5]);
{
  // Más de la mitad a cero: la mediana vale 0 y no sirve de referencia. Se cae
  // a la media en vez de dividir por cero y sacar NaN al shader, que pinta
  // basura sin avisar.
  const v = intensidadesDesde([0, 0, 0, 4, 8]);
  okQue('con la mediana a cero no salen NaN', v.every(Number.isFinite), JSON.stringify(v));
  okQue('y los que tienen bloques destacan igual', v[4] > v[3] && v[3] > v[0],
    JSON.stringify(v));
}
ok('sin validadores, sin intensidades', intensidadesDesde([]), []);

console.log('\n=== 4. NADA SE SALE DE [0,1] ===');
{
  const casos = [[0], [0, 1], [1, 2, 3], [0, 0, 100], [7, 7, 0, 21],
                 [-3, 5, 'x', null, undefined, 9]];
  let bien = true, cual = '';
  for (const c of casos) {
    const v = intensidadesDesde(c);
    if (!v.every(x => Number.isFinite(x) && x >= 0 && x <= 1)) { bien = false; cual = JSON.stringify([c, v]); }
  }
  // Basura incluida: el endpoint de bloques es externo y puede traer cualquier
  // cosa. Un NaN aquí llega al atributo del shader y no da error, pinta mal.
  okQue('con cualquier entrada, incluida basura', bien, cual);
}

console.log('\n=== 5. ENGANCHADO A LOS NODOS DE VERDAD ===');
{
  const detalle = [0, 3, 6, 13].map((b, i) => ({
    indice: 100 + i, estado: 'active_ongoing', pendiente: false, slashed: false,
  }));
  const bloques = { 100: 0, 101: 3, 102: 6, 103: 13 };
  const n = nodosDesde(detalle, bloques);
  ok('cuatro nodos', n.length, 4);
  ok('el de cero bloques va al mínimo', r3([n[0].intensidad]), [0]);
  okQue('y el de trece, al máximo', n[3].intensidad === 1, String(n[3].intensidad));
  okQue('van de menos a más', n[0].intensidad < n[1].intensidad
    && n[1].intensidad < n[2].intensidad && n[2].intensidad < n[3].intensidad, '');
}
{
  // Sin datos del explorador no se finge un reparto: todos iguales.
  const detalle = [1, 2, 3].map(i => ({ indice: i, estado: 'active_ongoing' }));
  ok('sin bloques, todos al medio',
    r3(nodosDesde(detalle, {}).map(n => n.intensidad)), [0.5, 0.5, 0.5]);
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
