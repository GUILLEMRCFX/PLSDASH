/**
 * La pestaña Ampliar, sin navegador.
 *
 *   1. CONTRATO: cada campo que nombra un paso de la guía lo publica de verdad
 *      `nuc/collector.py`. No contra una lista escrita aquí: se EJECUTA el
 *      recolector con la red simulada y se mira su salida. Es la prueba que
 *      habría cazado `red_validadores_activos`, que el panel leía y nadie
 *      escribía.
 *   2. En qué paso estás: manda lo observado sobre lo marcado.
 *   3. Los cinco controles del deposit_data, y que ninguno se da por bueno sin
 *      poder hacerse.
 *   4. La wallet y la activación ya no están escritas: salen del estado.
 *   5. Nada personal en el código de la pestaña, y ningún campo para la seed.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/ampliar-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PASOS, marcadoresDe, rellenar, leerRuta, fase, baseDe } from '/val/v2/paneles/pasos.js';
import { verificarDeposito, direccionDeCredenciales } from '/val/v2/paneles/deposito.js';
import { panelGuia, panelVerificador, _reiniciar } from '/val/v2/paneles/ampliar.js';
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
const okQue = (que, cond, detalle = '') => {
  pruebas++;
  if (!cond) { fallos++; console.log(`  FALLA ${que}${detalle ? ' · ' + detalle : ''}`); }
  else console.log(`  OK   ${que}`);
};

const RAIZ = new URL('..', import.meta.url).pathname;
const leer = f => readFileSync(RAIZ + f, 'utf8');

/* ───────────────────────────────────────────────────────────────── 1 */
console.log('\n=== 1. LA GUÍA SOLO USA LO QUE EL NUC PUBLICA ===');

/* El recolector de verdad, con la red de mentira. Todo lo que la guía puede
   nombrar tiene que existir en su salida; con valor, porque el caso simulado
   es el completo —un nodo con script, con deposit_data y con credenciales
   0x01—. */
const PY = `
import json, os, sys, tempfile
sys.path.insert(0, ${JSON.stringify(RAIZ + 'nuc')})
import collector
base = tempfile.mkdtemp()
claves = os.path.join(base, "validator_keys"); os.mkdir(claves)
open(os.path.join(base, "start_validator.sh"), "w").close()
open(os.path.join(claves, "deposit_data-1.json"), "w").close()
collector.KEYSTORE_DIR = claves
PK = ["0x" + ("%02x" % i) * 48 for i in range(1, 4)]
CRED = "0x01" + "00" * 11 + "ab" * 20
beacon = {"data": [{"index": str(100 + i), "balance": str(32_000_000 * 10**9),
  "status": "active_ongoing", "validator": {"pubkey": pk, "slashed": False,
  "activation_epoch": "319720", "withdrawal_credentials": CRED}} for i, pk in enumerate(PK[:2])]}
spec = {"data": {"MAX_EFFECTIVE_BALANCE": "32000000000000000",
  "GENESIS_FORK_VERSION": "0x00000369", "DEPOSIT_CONTRACT_ADDRESS": "0x" + "36" * 20}}
collector._pubkeys_locales = lambda: PK
collector.get_json = lambda url: spec if url.endswith(collector.SPEC) else (beacon if "validators" in url else None)
collector.prom_query = lambda *a, **k: None
print(json.dumps(collector.recolectar()))
`;
const estadoNuc = JSON.parse(execFileSync('python3', ['-c', PY], {
  encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  stdio: ['ignore', 'pipe', 'ignore'],
}));

for (const p of PASOS) {
  for (const ruta of p.usa || []) {
    const v = leerRuta(estadoNuc, ruta);
    okQue(`«${p.id}» usa ${ruta}, y el recolector lo publica`, v !== undefined && v !== null,
      `vale ${JSON.stringify(v)}`);
  }
  /* Y al revés: un marcador que no está declarado se escaparía de la prueba de
     arriba. `host` es de este navegador y va en `local`. */
  for (const m of marcadoresDe(p)) {
    okQue(`«${p.id}»: {${m}} está declarado`,
      (p.usa || []).includes(m) || (p.local || []).includes(m));
  }
}
okQue('la prueba ve de verdad lo que publica: la wallet sale de las credenciales',
  estadoNuc.validadores.wallet_retirada === '0x' + 'ab'.repeat(20));
okQue('y un campo que no existe se detecta', leerRuta(estadoNuc, 'validadores.red_validadores_activos') === undefined);

/* ───────────────────────────────────────────────────────────────── 2 */
console.log('\n=== 2. LOS MARCADORES ===');
{
  const ctx = { estado: estadoNuc, host: '', fmt: n => String(n) };
  const r = rellenar('ssh {entorno.usuario}@{host}', ctx);
  ok('sin host, queda el hueco a la vista', r.faltan, ['host']);
  okQue('y se ve dónde', r.texto.endsWith('@‹host›'), r.texto);
  const r2 = rellenar('ssh {entorno.usuario}@{host}', { ...ctx, host: 'nodo' });
  ok('con todo, nada falta', r2.faltan, []);
  ok('el formato de PLS', rellenar('{red.deposito|pls}', ctx).texto, '32000000 PLS');
  ok('un campo nulo es un hueco, no «null»',
    rellenar('{x.y}', { estado: { x: { y: null } } }).texto, '‹y›');
}

/* ───────────────────────────────────────────────────────────────── 3 */
console.log('\n=== 3. EN QUÉ PASO ESTÁS: MANDA LO OBSERVADO ===');
const pk = i => '0x' + i.toString(16).padStart(2, '0').repeat(48);
const act = i => ({ indice: 100 + i, pubkey: pk(i), esperando: false, activacion_ts: 1786095955 });
const est = ({ esperando = 0, pendientes = 0, activos = 12 } = {}) => {
  const detalle = Array.from({ length: 12 }, (_, i) => act(i + 1));
  for (let i = 0; i < esperando; i++) detalle.push({ indice: null, pubkey: pk(50 + i), esperando: true, pendiente: true });
  for (let i = 0; i < pendientes; i++) detalle.push({ indice: 200 + i, pubkey: pk(60 + i), esperando: false, pendiente: true });
  return { validadores: { total: 12 + pendientes, activos, pendientes, esperando,
    claves: 12 + pendientes + esperando, detalle, wallet_retirada: '0x' + 'ab'.repeat(20),
    stake_total: (12 + pendientes) * 32e6 } };
};
{
  ok('sin nada, el paso 1', fase(est()).actual, 0);
  ok('la base es lo que ya valida', baseDe(est()), 12);
  ok('marcado el 1, el 2', fase(est(), { base: 12, preparar: true }).actual, 1);
  ok('una marca de otro ciclo no cuenta', fase(est(), { base: 11, preparar: true }).actual, 0);

  const e = est({ esperando: 1 });
  ok('con una clave esperando, 1 y 2 hechos sin marcar nada', fase(e).hechos.slice(0, 2), [true, true]);
  ok('y toca importar', fase(e).actual, 2);
  ok('importada a mano, toca comprobar', fase(e, { base: 12, importar: true }).actual, 3);
  ok('comprobado el fichero de ESA clave, toca depositar',
    fase(e, { base: 12, importar: true }, { pubkey: pk(50), ok: true }).actual, 4);
  ok('pero el de otra clave no cuenta',
    fase(e, { base: 12, importar: true }, { pubkey: pk(3), ok: true }).actual, 3);
  ok('ni uno con fallos', fase(e, { base: 12, importar: true }, { pubkey: pk(50), ok: false }).actual, 3);

  const c = est({ pendientes: 1 });
  ok('en cola: todo hecho menos esperar', fase(c).hechos, [true, true, true, true, true, false]);
  ok('y toca esperar', fase(c).actual, 5);
  ok('en cola, la base no cuenta al que espera turno', baseDe(c), 12);

  // ⚠ Una marca que los datos desmienten NO cuenta, y se dice.
  const d = fase(est(), { base: 12, preparar: true, importar: true });
  ok('importar marcado sin clave en el nodo: no hecho', d.hechos[2], false);
  ok('y queda desmentido', d.desmentidas, ['importar']);

  // Al entrar el nuevo, la base sube y todo vuelve a empezar.
  const tras = est(); tras.validadores.total = 13; tras.validadores.activos = 13;
  ok('cuando entra, las marcas del ciclo anterior caducan',
    fase(tras, { base: 12, preparar: true, importar: true }).actual, 0);
}

/* ───────────────────────────────────────────────────────────────── 4 */
console.log('\n=== 4. EL DEPOSIT_DATA ===');
const MIA = '0x' + 'ab'.repeat(20);
const cred = dir => '01' + '00'.repeat(11) + dir.slice(2);
const fichero = (o = {}) => JSON.stringify([{
  pubkey: pk(50).slice(2), withdrawal_credentials: cred(MIA), amount: 32000000000000000,
  fork_version: '00000369', network_name: 'pulsechain', ...o }]);
const estado4 = { ...est({ esperando: 1 }), red: { deposito: 32e6, fork_version: '0x00000369' } };
const tonos = r => Object.fromEntries(r.controles.map(c => [c.id, c.tono]));
{
  ok('la dirección se lee de las credenciales', direccionDeCredenciales(cred(MIA)), MIA);
  ok('0x00 no tiene dirección', direccionDeCredenciales('00' + 'ab'.repeat(31)), null);

  const bien = verificarDeposito(fichero(), estado4);
  ok('el bueno: los cinco en verde', tonos(bien),
    { direccion: 'bien', uno: 'bien', clave: 'bien', importe: 'bien', red: 'bien' });
  ok('y da el paso por hecho', bien.ok, true);

  ok('otra dirección de retirada',
    tonos(verificarDeposito(fichero({ withdrawal_credentials: cred('0x' + 'cd'.repeat(20)) }), estado4)).direccion, 'mal');
  ok('credenciales 0x00',
    tonos(verificarDeposito(fichero({ withdrawal_credentials: '00' + 'ab'.repeat(31) }), estado4)).direccion, 'mal');
  const dos = JSON.parse(fichero()); dos.push({ ...dos[0], pubkey: pk(51).slice(2) });
  ok('dos validadores', tonos(verificarDeposito(JSON.stringify(dos), estado4)).uno, 'mal');
  // ⚠ El que más duele: depositar sobre un validador que ya existe.
  ok('una clave que YA valida', tonos(verificarDeposito(fichero({ pubkey: pk(3).slice(2) }), estado4)).clave, 'mal');
  ok('una clave que el nodo no tiene: aviso, no bien',
    tonos(verificarDeposito(fichero({ pubkey: pk(99).slice(2) }), estado4)).clave, 'aviso');
  ok('un importe distinto', tonos(verificarDeposito(fichero({ amount: 31000000000000000 }), estado4)).importe, 'mal');
  ok('un importe que no es un número',
    tonos(verificarDeposito(fichero({ amount: 'mucho' }), estado4)).importe, 'mal');
  ok('otra red', tonos(verificarDeposito(fichero({ fork_version: '00000000' }), estado4)).red, 'mal');

  // ⚠ Lo que no se puede comprobar NO cuenta como pasado.
  const sinNuc = { validadores: { ...estado4.validadores, wallet_retirada: null } };
  const r = verificarDeposito(fichero(), sinNuc);
  ok('sin la wallet publicada: sin dato', tonos(r).direccion, 'sin_dato');
  ok('sin la red publicada: sin dato', tonos(r).red, 'sin_dato');
  ok('y entonces el fichero NO se da por bueno', r.ok, false);
  ok('el importe cae al depósito derivado si no hay red', tonos(r).importe, 'bien');

  ok('no es JSON', verificarDeposito('hola', estado4).valido, false);
  ok('no es una lista', verificarDeposito('{}', estado4).valido, false);
  ok('le faltan campos', verificarDeposito('[{"pubkey":"aa"}]', estado4).error, 'Le faltan campos: withdrawal_credentials, amount, fork_version.');
}

/* ───────────────────────────────────────────────────────────────── 5 */
console.log('\n=== 5. LA WALLET Y LA ACTIVACIÓN SALEN DEL ESTADO ===');
{
  const g = grupoDesde(estadoNuc, null);
  ok('la wallet, del estado', g.wallet, '0x' + 'ab'.repeat(20));
  ok('los índices, del estado', [...g.indices], [100, 101]);
  ok('la activación, la del grupo', g.activacionTs, 1786095955);

  // Un recolector anterior al cambio: índices y activaciones sí, wallet no.
  const viejo = { validadores: { detalle: [{ indice: 7, activacion_ts: 1786095955 }, { indice: 8, activacion_ts: 1787000000 }] } };
  ok('sin wallet en el estado ni en la caché: null, y no se recorre nada', grupoDesde(viejo, null).wallet, null);
  ok('con la caché, la de la caché', grupoDesde(viejo, { wallet: '0x' + 'EE'.repeat(20) }).wallet, '0x' + 'ee'.repeat(20));
  ok('la activación, la MÁS ANTIGUA del detalle', grupoDesde(viejo, null).activacionTs, 1786095955);
  ok('una wallet con otra forma no vale', grupoDesde({ validadores: { wallet_retirada: '0x12' } }, null).wallet, null);
  ok('el que espera no aporta índice',
    [...grupoDesde({ validadores: { detalle: [{ indice: 5 }, { indice: null }] } }, null).indices], [5]);
  ok('sin nada, todo null', grupoDesde(null, null), { indices: null, wallet: null, activacionTs: null });

  ok('el panel: la del grupo', activacionTs(estadoNuc), 1786095955);
  ok('el panel: sin grupo, la más antigua del detalle', activacionTs(viejo), 1786095955);
  ok('el panel: sin nada, null', activacionTs({}), null);
}

/* ───────────────────────────────────────────────────────────────── 6 */
console.log('\n=== 6. NADA PERSONAL, NINGÚN CAMPO PARA LA SEED ===');
{
  const DE_LA_PESTANA = ['val/v2/paneles/pasos.js', 'val/v2/paneles/ampliar.js',
    'val/v2/paneles/deposito.js', 'val/v2/paneles/trayectoria.js', 'val/v2/paneles/aportaciones.js'];
  for (const f of DE_LA_PESTANA) {
    const t = leer(f);
    okQue(`${f}: sin direcciones escritas`, !/0x[0-9a-fA-F]{40}/.test(t));
    okQue(`${f}: sin IPs`, !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t));
    okQue(`${f}: sin rutas de una máquina`, !/\/home\/|\/blockchain/.test(t));
  }
  for (const f of ['functions/api/val/ganancia.js', 'nuc/explorador.py', 'val/v2/datos.js']) {
    const t = leer(f);
    okQue(`${f}: sin la wallet escrita`, !/952e0311/i.test(t));
    okQue(`${f}: sin la activación como constante`, !/(ACTIVACION_TS\s*=|=\s*1786095955)/.test(t));
  }

  _reiniciar();
  // En el paso 1, que es donde está el campo del host.
  const html = panelGuia({ estado: { ...est(), entorno: estadoNuc.entorno } }) + panelVerificador({ estado: estadoNuc });
  const campos = [...html.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map(m => m[0]);
  ok('solo dos campos en toda la pestaña: el host y el fichero',
    campos.map(c => c.match(/id="([^"]+)"/)?.[1]), ['gHost', 'dFichero']);
  okQue('ninguno es de contraseña', !campos.some(c => /type="password"/.test(c)));
  okQue('ni un textarea donde pegar una seed', !/<textarea/.test(html));
  okQue('dice en pantalla que no comprueba la firma', /No comprueba la firma/.test(html));
  okQue('y que el fichero no sale del ordenador', /no sale de tu ordenador/.test(html));
  okQue('y la frase de P9', /No abre conexiones, no escribe en el NUC, no firma,\s+no sube nada/.test(html));
  okQue('la pestaña no hace peticiones', !/fetch\(/.test(leer('val/v2/paneles/ampliar.js') + leer('val/v2/paneles/deposito.js') + leer('val/v2/paneles/pasos.js')));
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
