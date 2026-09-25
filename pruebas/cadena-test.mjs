/**
 * La wallet de retirada y la fecha de activación ya no están escritas: salen
 * del estado que publica el NUC, que las lee de la cadena.
 *
 *   1. `/api/val/ganancia` toma la wallet, los índices y la activación del
 *      estado, con su propia caché como respaldo, y sin cualquiera de las tres
 *      no recorre el explorador.
 *   2. El panel toma la activación del estado.
 *   3. Ninguno de los tres sitios donde estaban las lleva escritas.
 *
 * Lo del recolector —que las publica— lo prueba `nuc-test.py`.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/cadena-test.mjs
 */
import { readFileSync } from 'node:fs';
import { activacionTs } from '/val/v2/datos.js';
import { grupoDesde } from '../functions/api/val/ganancia.js';

let fallos = 0, pruebas = 0;
const ok = (que, real, esperado) => {
  pruebas++;
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallos++;
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${que}`
    + (bien ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`));
};
const okQue = (que, cond) => {
  pruebas++;
  if (!cond) fallos++;
  console.log(`  ${cond ? 'OK  ' : 'FALLA'} ${que}`);
};
const RAIZ = new URL('..', import.meta.url).pathname;
const leer = f => readFileSync(RAIZ + f, 'utf8');

const MIA = '0x' + 'ab'.repeat(20);
const nuevo = { validadores: { wallet_retirada: MIA, activacion_ts: 1786095955,
  detalle: [{ indice: 100, activacion_ts: 1786095955 }, { indice: 101, activacion_ts: 1786995955 },
            { indice: null, esperando: true }] } };
// Un recolector anterior al 23-sep-2026: índices y activaciones, sin wallet.
const viejo = { validadores: { detalle: [{ indice: 7, activacion_ts: 1786095955 }, { indice: 8, activacion_ts: 1787000000 }] } };

console.log('\n=== 1. LA FUNCTION DE GANANCIAS ===');
{
  const g = grupoDesde(nuevo, null);
  ok('la wallet, del estado', g.wallet, MIA);
  ok('los índices, del estado, sin el que espera', [...g.indices], [100, 101]);
  ok('la activación, la del grupo', g.activacionTs, 1786095955);
  ok('sin wallet en el estado ni en la caché: null, y no se recorre nada', grupoDesde(viejo, null).wallet, null);
  ok('con la caché, la de la caché', grupoDesde(viejo, { wallet: '0x' + 'EE'.repeat(20) }).wallet, '0x' + 'ee'.repeat(20));
  ok('la activación, la MÁS ANTIGUA del detalle', grupoDesde(viejo, null).activacionTs, 1786095955);
  ok('una wallet con otra forma no vale', grupoDesde({ validadores: { wallet_retirada: '0x12' } }, null).wallet, null);
  ok('sin nada, todo null', grupoDesde(null, null), { indices: null, wallet: null, activacionTs: null });
}

console.log('\n=== 2. EL PANEL ===');
{
  ok('la del grupo', activacionTs(nuevo), 1786095955);
  ok('sin grupo, la más antigua del detalle', activacionTs(viejo), 1786095955);
  ok('sin nada, null', activacionTs({}), null);
}

console.log('\n=== 3. YA NO ESTÁN ESCRITAS ===');
for (const f of ['functions/api/val/ganancia.js', 'nuc/explorador.py', 'public/val/v2/datos.js']) {
  const t = leer(f);
  okQue(`${f}: sin la wallet`, !/952e0311/i.test(t));
  okQue(`${f}: sin la activación como constante`, !/(ACTIVACION_TS\s*=|=\s*1786095955)/.test(t));
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
