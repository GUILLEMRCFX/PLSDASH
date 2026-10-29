/**
 * Lo que cambió en el panel el 29-oct-2026, por sus funciones: el mapa de
 * validadores, el anillo del ciclo y el peso de las filas del Resumen, la línea
 * de tiempo del registro y el «NaN %» del disco.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/panel-revision-test.mjs
 */
import { panelValidadores, _reiniciarValidadores } from '/val/v2/paneles/validadores.js';
import { panelRegistro, describirCiclo, agruparEventos, fmtDia } from '/val/v2/paneles/registro.js';
import { panelSaludNodo } from '/val/v2/paneles/salud-nodo.js';
import { panelResumen, _reiniciar } from '/val/v2/paneles/resumen.js';

let fallos = 0, pruebas = 0;
const ok = (que, real, esperado) => {
  pruebas++;
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallos++;
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${que}`
    + (bien ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`));
};
const texto = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const AHORA = 1_793_260_000;

console.log('── registro: cada línea dice qué ha pasado');
{
  const uno = ev => describirCiclo(agruparEventos(ev)[0]);
  ok('un bloque suelto ya no sale como «—»',
    uno([{ ts: 1, tipo: 'bloque', validador: 109553, pls: 5800 }]),
    { tipo: 'bloque', titulo: 'Bloque propuesto por 109553', sub: '', pls: 5800 });
  ok('un aviso sale con su texto, no como «aviso»',
    uno([{ ts: 1, tipo: 'aviso', titulo: 'Validador nuevo esperando a entrar en la cadena' }]).titulo,
    'Validador nuevo esperando a entrar en la cadena');
  ok('la recuperación, con su título y su icono',
    (({ tipo, titulo }) => ({ tipo, titulo }))(uno([{ ts: 1, tipo: 'recuperacion', titulo: 'Validadores recuperados' }])),
    { tipo: 'recuperacion', titulo: 'Validadores recuperados' });
  ok('tres activaciones a la vez son una línea, con los índices en orden',
    uno([112237, 112235, 112236].map(v => ({ ts: 1, tipo: 'activacion', validador: v, titulo: `Validador ${v} activado` }))),
    { tipo: 'activacion', titulo: '3 validadores activados', sub: '112235, 112236, 112237', pls: null });
  ok('el barrido con sus bloques del mismo instante',
    uno([{ ts: 1, tipo: 'barrido', pls: 18400 }, { ts: 1, tipo: 'bloque', validador: 109556, pls: 10 },
         { ts: 1, tipo: 'bloque', validador: 109550, pls: 5 }]),
    { tipo: 'barrido', titulo: 'Barrido a la wallet', sub: 'con 2 bloques de 109550, 109556 · 15 PLS', pls: 18400 });
  ok('un tipo desconocido enseña su título con el icono genérico',
    (({ tipo, titulo }) => ({ tipo, titulo }))(uno([{ ts: 1, tipo: 'nuevo', titulo: 'Algo nuevo' }])),
    { tipo: 'otro', titulo: 'Algo nuevo' });
  ok('días: hoy, ayer y fecha', [fmtDia(AHORA - 60, AHORA), fmtDia(AHORA - 86400, AHORA), fmtDia(AHORA - 5 * 86400, AHORA)],
    ['Hoy', 'Ayer', `${new Date((AHORA - 5 * 86400) * 1000).getUTCDate()} oct`]);
  const html = panelRegistro({ ahoraS: AHORA, eventos: [
    { ts: AHORA - 3600, tipo: 'barrido', pls: 1 }, { ts: AHORA - 7200, tipo: 'bloque', validador: 7 },
    { ts: AHORA - 90000, tipo: 'aviso', titulo: 'Ojo' }] });
  ok('una cabecera por día', [...html.matchAll(/class="e-dia">([^<]+)/g)].map(m => m[1]), ['Hoy', 'Ayer']);
  ok('ningún «—» en el registro', /—/.test(texto(html)), false);
}

console.log('── nodo: un dato que falta no es «NaN»');
{
  const html = texto(panelSaludNodo({ estado: { nodo: { temp_cpu: 50, ram_total_gb: 32, ram_libre_gb: 16, peers: 50 } } }));
  ok('sin NaN en ningún sitio', /NaN/.test(html), false);
  ok('el disco dice que no hay lectura', /– Disco sin lectura/.test(html), true);
  const bien = texto(panelSaludNodo({ estado: { nodo: { temp_cpu: 50, disco_usado_pct: 63.4, disco_libre_gb: 700, peers: 50 } } }));
  ok('con dato, el disco sale como siempre', /63,4 % Disco 700 GB libres/.test(bien), true);
}

console.log('── validadores: el mapa');
{
  const det = [
    { indice: 109549, estado: 'active_ongoing', ganado: 800, balance: 32e6 + 800 },
    { indice: 109550, estado: 'active_ongoing', ganado: 790, balance: 32e6 + 790 },
    { indice: 109551, estado: 'active_ongoing', ganado: 100, balance: 32e6 + 100 },   // rezagado
    { indice: null, pubkey_corta: '0xab…cd', estado: 'esperando', esperando: true },
  ];
  const datos = { estado: { validadores: { total: 3, stake_total: 96e6, detalle: det } },
                  ganancia: { por_validador: { 109550: 6 }, ciclos: [] }, ahoraS: AHORA };
  _reiniciarValidadores('mapa');
  let html = panelValidadores(datos);
  const celdas = [...html.matchAll(/class="vcelda (\w+)" data-v="([^"]+)"/g)].map(m => [m[2], m[1]]);
  ok('una celda por validador, con su estado', celdas,
    [['109549', 'ok'], ['109550', 'ok'], ['109551', 'mal'], ['pk:0xab…cd', 'espera']]);
  ok('seis bloques: cuatro puntos y un «+»', /data-v="109550"[\s\S]*?<span class="vc-pips"[^>]*>(<i><\/i>){4}<b>\+<\/b>/.test(html), true);
  ok('la lista sigue en el HTML, escondida', /<div class="vlista" hidden>/.test(html), true);
  _reiniciarValidadores('mapa', '109551');
  html = panelValidadores(datos);
  ok('la hoja del elegido, con la palabra y no solo el color',
    /class="vhoja"[\s\S]*Validador 109551[\s\S]*vh-est mal">rezagado/.test(html), true);
  _reiniciarValidadores('mapa', 'pk:0xab…cd');
  html = panelValidadores(datos);
  ok('el que espera no lleva enlace al explorador', /class="vhoja"[\s\S]*vh-ir/.test(html), false);
  _reiniciarValidadores('lista');
  html = panelValidadores(datos);
  ok('en lista, el mapa escondido', /<div class="vmapa-caja" hidden>/.test(html), true);
  _reiniciarValidadores('mapa');
}

console.log('── resumen: el ciclo y el peso de las filas');
{
  _reiniciar();
  const ciclos = Array.from({ length: 6 }, (_, i) => ({ ts: Math.floor(Date.now() / 1000) - (6 - i) * 8 * 3600 - 2 * 3600, pls: 100 }));
  const datos = { estado: { validadores: { total: 2, stake_total: 64e6, ganado_total: 1000, detalle: [] }, generado_ts: Math.floor(Date.now() / 1000) },
                  ganancia: { saldo_wallet: 36e6 - 1000, ciclos }, serie: [], precio: { disponible: true, precio: 0.00001 }, ahoraS: Math.floor(Date.now() / 1000) };
  const html = panelResumen(datos);
  ok('el anillo, con su avance', /class="r-ciclo"[\s\S]*stroke-dasharray="\d+ 100"/.test(html), true);
  const pesos = [...html.matchAll(/class="r-fila (\w+)[^"]*"[^>]*style="--peso:([\d.]+)%"/g)].map(m => [m[1], Number(m[2])]);
  ok('las tres filas pesan lo que suman (64 + 36 − 0,001 de 100)', pesos.map(([k, v]) => [k, Math.round(v)]),
    [['staking', 64], ['wallet', 36], ['sinBarrer', 1]]);
  const sin = panelResumen({ ...datos, ganancia: { ...datos.ganancia, ciclos: [] } });
  ok('sin ritmo de barrido, no hay anillo', /r-ciclo/.test(sin), false);
}

console.log(`\n${pruebas - fallos}/${pruebas} bien`);
process.exit(fallos ? 1 : 0);
