/**
 * El Resumen como patrimonio, sin navegador.
 *
 *   1. Las tres filas SUMAN la cifra de arriba. Siempre: también cuando falta
 *      una pieza, que entonces no cuenta y se dice.
 *   2. Lo generado NO suma al patrimonio.
 *   3. El staking es solo lo que la cadena confirma: un validador esperando no
 *      mete 32M.
 *   4. La franja de salud: tranquila cuando va bien, en aviso cuando no.
 *   5. El selector: tocar una fila la pone arriba, tocarla otra vez vuelve.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/resumen-test.mjs
 */
import { patrimonioDesde, panelResumen, engancharResumen, _reiniciar } from '/val/v2/paneles/resumen.js';

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

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const AHORA = Math.floor(Date.now() / 1000);
const datos = (o = {}) => ({
  ahoraS: AHORA, serie: [], snapshots24h: [], sesion: true,
  estado: { generado_ts: AHORA - 30, salud: 'ok', nodo: { sincronizado: true },
    validadores: { total: 12, activos: 12, pendientes: 0, esperando: 0, claves: 12,
      stake_total: 384e6, ganado_total: 27793, activacion_ts: 1786095955, detalle: [], ...o.v } },
  ganancia: o.ganancia === undefined ? { total: 4079066, saldo_wallet: 2050000, ciclos: [] } : o.ganancia,
  precio: o.precio === undefined ? { disponible: true, precio: 0.00001118, cambio24: -3.2 } : o.precio,
  aportaciones: { aportaciones: [], total_pls: 0 },
});
/** Los PLS de cada fila y de la cifra, leídos del HTML: lo que se VE. */
const leer = html => {
  const num = s => Number(s.replace(/\./g, '').replace(',', '.'));
  const filas = [...html.matchAll(/class="r-fila (\w+)[^"]*"[\s\S]*?<span class="r-val">([\s\S]*?)<\/span>\s*<\/button>/g)]
    .map(m => { const pls = m[2].match(/([\d.]+) PLS/); return pls ? num(pls[1]) : null; });
  const base = Number(html.match(/data-base="([^"]+)"/)?.[1]);
  return { filas, base };
};

console.log('\n=== 1. LAS FILAS SUMAN LA CIFRA DE ARRIBA ===');
{
  const p = patrimonioDesde(datos());
  ok('las tres piezas', [p.staking, p.wallet, p.sinBarrer], [384e6, 2050000, 27793]);
  ok('el total es su suma', p.total, 384e6 + 2050000 + 27793);
  _reiniciar();
  const { filas, base } = leer(panelResumen(datos()));
  ok('lo que se ve en las filas', filas, [384e6, 2050000, 27793]);
  ok('suma exactamente la cifra de arriba', filas.reduce((a, x) => a + x, 0), base);

  // Sin la wallet —el explorador no contesta—, no cuenta y se dice.
  const sin = datos({ ganancia: null });
  const ps = patrimonioDesde(sin);
  ok('sin wallet, falta la wallet', ps.faltan, ['wallet']);
  ok('y el total es lo que hay', ps.total, 384e6 + 27793);
  const h = panelResumen(sin);
  const l = leer(h);
  ok('la fila de la wallet sale vacía', l.filas, [384e6, null, 27793]);
  ok('y las que hay siguen sumando la cifra', 384e6 + 27793, l.base);
  okQue('y el pie lo dice', /Sin contar la wallet: no se ha podido leer/.test(h));
  ok('sin nada, no hay total', patrimonioDesde({}).total, null);
}

console.log('\n=== 2. LO GENERADO NO SUMA ===');
{
  const h = panelResumen(datos());
  okQue('lo generado está aparte', /class="r-generado/.test(h) && /no suma al patrimonio/.test(h));
  okQue('y la cifra de arriba no lo lleva', leer(h).base === 384e6 + 2050000 + 27793);
}

console.log('\n=== 3. EL STAKING ES LO QUE CONFIRMA LA CADENA ===');
{
  // El recolector no suma el que espera a `stake_total`; el panel no lo añade.
  const e = datos({ v: { esperando: 1, claves: 13 } });
  ok('un validador esperando no mete 32M', patrimonioDesde(e).staking, 384e6);
}

console.log('\n=== 4. LA FRANJA ===');
{
  const h = panelResumen(datos());
  okQue('tranquila cuando va bien', /class="franja ok"/.test(h));
  okQue('dice cuántos validan de cuántos', /12 de 12 validando/.test(h));
  const mal = panelResumen(datos({ v: { activos: 11 } }));
  okQue('en aviso si uno cae', /class="franja aviso"/.test(mal), mal.match(/class="franja \w+"/)?.[0]);
  okQue('y dice por qué', /Un validador fuera de servicio/.test(mal));
  const cola = panelResumen(datos({ v: { total: 13, activos: 12, pendientes: 1, claves: 13, stake_total: 416e6 } }));
  okQue('uno en cola NO es un aviso', /class="franja ok"/.test(cola) && /1 en cola/.test(cola));
  const viejo = datos(); viejo.estado.generado_ts = AHORA - 3600;
  okQue('el dato viejo, en aviso aunque todo lo demás vaya bien', !/class="franja ok"/.test(panelResumen(viejo)));
}

console.log('\n=== 5. EL SELECTOR ===');
{
  _reiniciar();
  const d = datos();
  let html = panelResumen(d);
  // Un DOM mínimo: lo justo para que `engancharResumen` encuentre los botones.
  const botones = [];
  const raiz = {
    querySelector: () => null,
    querySelectorAll: () => botones,
  };
  const pulsar = sel => {
    botones.length = 0;
    for (const m of html.matchAll(/data-sel="(\w+)"/g)) {
      const b = { dataset: { sel: m[1] }, oyente: null, addEventListener(_, f) { this.oyente = f; } };
      botones.push(b);
    }
    engancharResumen(raiz, () => { html = panelResumen(d); });
    botones.find(b => b.dataset.sel === sel).oyente();
  };
  const titulo = () => html.match(/class="h-eti">([^<]+)</)?.[1];
  ok('arranca en el patrimonio', titulo(), 'Patrimonio del nodo');
  pulsar('wallet');
  ok('tocar la wallet la pone arriba', titulo(), 'En la wallet');
  okQue('con la vuelta al patrimonio', /← Patrimonio/.test(html));
  ok('y la cifra es la de la wallet', Number(html.match(/data-base="([^"]+)"/)[1]), 2050000);
  pulsar('wallet');
  ok('tocarla otra vez vuelve al total', titulo(), 'Patrimonio del nodo');
  pulsar('generado');
  okQue('lo generado también se elige', /Generado desde el/.test(titulo()));
  pulsar('total');
  ok('y «← Patrimonio» vuelve', titulo(), 'Patrimonio del nodo');
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
