/**
 * El sellado del precio de cada barrido.
 *
 * `barridos.precio_pls` llevaba 1.218 filas vacías y era el único agujero del
 * proyecto que empeora cada día: el precio de una hora pasada no lo sirve
 * ninguna API. Desde el 21-sep-2026 cada barrido nuevo se sella con el precio
 * que `snapshots` registró en esa misma hora.
 *
 * ⚠ Esto NO prueba una copia de la lógica: importa `precioMasCercano` del
 *   propio endpoint. Una prueba que reimplementara la elección se quedaría
 *   vieja el día que alguien tocase la de producción, y seguiría verde.
 *
 * Y la sección 5 va contra un **SQLite de verdad** (`node:sqlite`), porque las
 * dos consultas que rodean a la función también pueden estar mal y una base de
 * mentira que solo devuelve lo que se le dice no las probaría.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/precio-barridos-test.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import {
  precioMasCercano, TOLERANCIA_PRECIO_S, VENTANA_SELLADO_S,
} from '../functions/api/val/ganancia.js';

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

const T = 1790000000;
const H = 3600;
const snap = (t, p) => ({ ts: t, precio_pls: p });

console.log('\n=== 1. SE COGE EL MÁS CERCANO, NO UNO CUALQUIERA ===');
{
  /* ⚠ LA COMPROBACIÓN QUE DESTAPÓ EL FALLO. La primera versión de esto era una
     subconsulta correlada en SQL; SQLite rechaza la forma cualificada, y la
     forma que sí compila resuelve `ts` a `snapshots.ts` —las dos tablas tienen
     esa columna— con lo que el rango era siempre cierto y la distancia siempre
     cero: devolvía un precio CUALQUIERA del tramo y parecía funcionar.

     El barrido cae 20 min después del snapshot de las 10 y 40 min antes del de
     las 11. Tiene que ganar el de las 10. Con dos precios distintos, coger
     «uno cualquiera» se ve. */
  const snaps = [snap(T, 0.00001), snap(T + H, 0.00002)];
  ok('gana el anterior si está más cerca', precioMasCercano(T + 20 * 60, snaps), 0.00001);
  ok('y el posterior si lo está él', precioMasCercano(T + 40 * 60, snaps), 0.00002);
  ok('justo encima, el suyo', precioMasCercano(T, snaps), 0.00001);
}
{
  // Con muchos alrededor sigue ganando el más cercano, no el primero del array.
  const snaps = [snap(T - 3 * H, 0.1), snap(T - 2 * H, 0.2), snap(T - H, 0.3), snap(T + H, 0.4)];
  ok('entre cuatro, el más cercano', precioMasCercano(T - 50 * 60, snaps), 0.3);
}

console.log('\n=== 2. FUERA DE LA TOLERANCIA, HUECO ===');
{
  /* ⚠ LO QUE IMPIDE INVENTARSE UN PRECIO. A seis horas de distancia, PLS se ha
     movido lo bastante como para que esa cifra ya no sea la de este barrido
     —hizo un 47 % en cinco días—. Vale más un hueco. */
  ok('a seis horas, nada', precioMasCercano(T, [snap(T - 6 * H, 0.00001)]), null);
  ok('justo en el borde, sí', precioMasCercano(T, [snap(T - TOLERANCIA_PRECIO_S, 0.00003)]), 0.00003);
  ok('un segundo más allá, no',
     precioMasCercano(T, [snap(T - TOLERANCIA_PRECIO_S - 1, 0.00003)]), null);
}
{
  // Uno lejano no puede tapar a uno cercano ni al revés.
  ok('el lejano no gana por estar antes en la lista',
     precioMasCercano(T, [snap(T - 5 * H, 0.9), snap(T + 10 * 60, 0.00007)]), 0.00007);
}

console.log('\n=== 3. BASURA DENTRO, HUECO FUERA ===');
ok('sin snapshots', precioMasCercano(T, []), null);
ok('un snapshot sin precio se salta',
   precioMasCercano(T, [snap(T, null), snap(T + 20 * 60, 0.00004)]), 0.00004);
ok('un precio cero no es un precio', precioMasCercano(T, [snap(T, 0)]), null);
ok('ni un precio negativo', precioMasCercano(T, [snap(T, -1)]), null);
ok('ni un ts que no es número', precioMasCercano(T, [snap('x', 0.5)]), null);
okQue('nunca devuelve NaN',
  [[], [snap(T, NaN)], [snap(NaN, 0.5)]].every(s => {
    const r = precioMasCercano(T, s);
    return r === null || Number.isFinite(r);
  }));

console.log('\n=== 4. EL DESEMPATE ES ESTABLE ===');
{
  /* Dos snapshots a la misma distancia exacta. Da igual cuál gane, pero tiene
     que ganar SIEMPRE el mismo: si no, dos pasadas del repaso escribirían
     precios distintos en la misma fila histórica. */
  const snaps = [snap(T - 30 * 60, 0.11), snap(T + 30 * 60, 0.22)];
  const a = precioMasCercano(T, snaps);
  const b = precioMasCercano(T, snaps);
  ok('el empate se resuelve igual las dos veces', a, b);
  ok('y gana el más antiguo', a, 0.11);
}

console.log('\n=== 5. LAS CONSULTAS, CONTRA SQLITE DE VERDAD ===');
{
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE barridos (
             indice_retirada INTEGER PRIMARY KEY, ts INTEGER, validador INTEGER,
             cantidad REAL, bloque INTEGER, es_bloque INTEGER, precio_pls REAL)`);
  db.exec('CREATE TABLE snapshots (ts INTEGER PRIMARY KEY, precio_pls REAL)');

  const viejo = T - VENTANA_SELLADO_S - H;       // fuera de la ventana
  const filas = [
    [1, viejo, null],                             // antiguo, sin precio
    [2, T - 2 * H, null],                         // reciente, sin precio
    [3, T - H, 0.00009],                          // reciente, ya sellado
    // ⚠ A CINCO HORAS, y no a tres: la tolerancia son 90 min, así que con
    //   tres horas el snapshot de T-2H habría caído dentro y este caso no
    //   probaría nada. Lo pillé porque la prueba salió en rojo con un 3.
    [4, T - 5 * H, null],                         // reciente, sin snapshot cerca
  ];
  const ins = db.prepare('INSERT INTO barridos (indice_retirada, ts, cantidad, precio_pls) VALUES (?,?,1000,?)');
  for (const f of filas) ins.run(...f);
  const is = db.prepare('INSERT INTO snapshots (ts, precio_pls) VALUES (?,?)');
  is.run(viejo, 0.00001);                         // hay precio, pero es viejo
  is.run(T - 2 * H, 0.00002);
  is.run(T - H, 0.00003);

  const desde = T - VENTANA_SELLADO_S;
  const pendientes = db.prepare(
    'SELECT indice_retirada, ts FROM barridos WHERE precio_pls IS NULL AND ts >= ? ORDER BY ts'
  ).all(desde);

  /* ⚠ EL PASADO NO SE TOCA. Los 1.218 barridos anteriores se quedan sin precio
     POR DECISIÓN, no por falta de datos: `snapshots.precio_pls` existe desde el
     16-ago y podría sellar muchos. Rellenar el pasado es del propietario, no de
     este código. Si alguien quitara la ventana, esto se pone rojo. */
  ok('solo los recientes sin precio', pendientes.map(p => p.indice_retirada), [4, 2]);
  okQue('el antiguo queda fuera', !pendientes.some(p => p.indice_retirada === 1));
  okQue('el ya sellado queda fuera', !pendientes.some(p => p.indice_retirada === 3));

  const min = pendientes[0].ts - TOLERANCIA_PRECIO_S;
  const max = pendientes[pendientes.length - 1].ts + TOLERANCIA_PRECIO_S;
  const snaps = db.prepare(
    'SELECT ts, precio_pls FROM snapshots WHERE precio_pls IS NOT NULL AND ts BETWEEN ? AND ? ORDER BY ts'
  ).all(min, max);
  okQue('la franja de snapshots no arrastra el histórico entero',
    snaps.length === 2 && !snaps.some(s => s.ts === viejo), JSON.stringify(snaps));

  const upd = db.prepare('UPDATE barridos SET precio_pls = ? WHERE indice_retirada = ?');
  let sellados = 0;
  for (const b of pendientes) {
    const p = precioMasCercano(Number(b.ts), snaps);
    if (p != null) { upd.run(p, b.indice_retirada); sellados++; }
  }
  ok('se sella uno solo', sellados, 1);

  const fin = db.prepare('SELECT indice_retirada, precio_pls FROM barridos ORDER BY indice_retirada').all();
  ok('el antiguo sigue sin precio', fin[0].precio_pls, null);
  ok('el reciente se sella con el de su hora', fin[1].precio_pls, 0.00002);
  ok('el ya sellado conserva el suyo', fin[2].precio_pls, 0.00009);
  ok('y el que no tenía snapshot cerca se queda vacío', fin[3].precio_pls, null);

  // Segunda pasada: idempotente. Si reescribiera, una cifra histórica podría
  // moverse sola en cada refresco del panel.
  const otra = db.prepare(
    'SELECT indice_retirada, ts FROM barridos WHERE precio_pls IS NULL AND ts >= ? ORDER BY ts'
  ).all(desde);
  ok('la segunda pasada solo ve al que no se pudo sellar',
     otra.map(p => p.indice_retirada), [4]);
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
