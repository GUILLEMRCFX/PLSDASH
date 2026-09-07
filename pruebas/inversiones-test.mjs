/**
 * `functions/api/inversiones.js`: clasificar y armar la respuesta.
 *
 * Se llama a la Function directamente con una D1 de mentira y un `fetch`
 * doblado, que es más rápido y más exacto que levantar `wrangler`: se controla
 * página a página lo que devuelve el explorador.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/inversiones-test.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { crear: d1Falsa } = require('./d1-falsa.js');

const mod = await import('../functions/api/inversiones.js');

let fallos = 0, pruebas = 0;
const ok = (que, real, esperado) => {
  pruebas++;
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallos++;
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${que}`
    + (bien ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`));
};

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const USDC = '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07';
const ESTAFA = '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead';
const DEPOSITO = '0xdddddddddddddddddddddddddddddddddddddddd';
/* ⚠ Direcciones VÁLIDAS, con solo dígitos hexadecimales. Un `0xhex000…` se lee
   bonito en la prueba y la Function lo descarta en `esDireccion()`, así que la
   transferencia desaparece y el caso deja de probar lo que dice probar. */
const HEX = '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39';

const hace = dias => new Date(Date.now() - dias * 86400e3).toISOString();

/** Una transferencia de token, como la devuelve Blockscout v2. */
const tt = (hash, ts, token, sim, cant, de, a, dec = 18) => ({
  transaction_hash: hash, timestamp: ts,
  token: { address: token, symbol: sim, name: sim, decimals: String(dec), type: 'ERC-20' },
  total: { value: String(BigInt(Math.round(cant * 1e6)) * 10n ** BigInt(dec - 6)), decimals: String(dec) },
  from: { hash: de }, to: { hash: a },
});

/** Una transacción nativa: PLS que se mueve sin token de por medio. */
const tx = (hash, ts, cant, de, a) => ({
  hash, timestamp: ts, value: String(BigInt(Math.round(cant)) * 10n ** 18n),
  from: { hash: de }, to: { hash: a },
});

const fetchReal = globalThis.fetch;

/**
 * `paginas` es un mapa de ruta → lista de páginas. La ruta que no esté
 * devuelve vacío, que es lo que hace el explorador con una wallet sin nada.
 *
 * ⚠ HAY QUE HONRAR `?filter=to|from`, y no es un detalle de la fixture. La
 *   Function pide cada fuente DOS veces, una por sentido, porque para distinguir
 *   una compra de un swap hace falta ver lo que entra y lo que sale. Un doble
 *   que devuelva la misma lista a las dos llamadas entrega cada transferencia
 *   dos veces, `fundir()` las suma y todas las cantidades salen al doble: la
 *   primera versión de esta prueba veía 1000 $ donde había 500 y culpaba al
 *   código. La dirección se mira contra la wallet de la URL, igual que hace el
 *   explorador de verdad.
 */
function fetchFalso(paginas, contador) {
  return async url => {
    contador.n++;
    const u = new URL(url);
    const clave = Object.keys(paginas).find(k => u.pathname.includes(k));
    const lista = clave ? paginas[clave] : null;
    const pagina = lista ? (lista[0] || { items: [] }) : { items: [] };

    const filtro = u.searchParams.get('filter');
    const quien = (u.pathname.match(/0x[0-9a-fA-F]{40}/) || [''])[0].toLowerCase();
    const lado = it => String((it.from?.hash ?? it.from) || '').toLowerCase() === quien ? 'from' : 'to';
    const items = filtro
      ? (pagina.items || []).filter(it => lado(it) === filtro)
      : (pagina.items || []);

    return { ok: true, json: async () => ({ ...pagina, items }) };
  };
}

const llamar = async (paginas, { w = [A], tz = 0, ver = null } = {}) => {
  const contador = { n: 0 };
  globalThis.fetch = fetchFalso(paginas, contador);
  const db = d1Falsa();
  const req = new Request(`https://plsdash.com/api/inversiones?w=${w.join(',')}&tz=${tz}`
    + (ver ? `&ver=${ver.join(',')}` : ''));
  try {
    const res = await mod.onRequestGet({ request: req, env: { VALIDATOR_DB: db } });
    return { res, cuerpo: await res.json(), db, peticiones: contador.n };
  } finally {
    globalThis.fetch = fetchReal;
  }
};

console.log('\n=== 1. UNA ENTRADA LIMPIA EN STABLECOIN ===');
{
  const { cuerpo } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [tt('0x1', hace(3), USDC, 'USDC', 500, B, A)] }],
  });
  ok('un solo día', cuerpo.dias.length, 1);
  ok('con una entrada, en dólares', cuerpo.dias[0].entradas[0].usd, 500);
  ok('la semana suma esos dólares', cuerpo.semanas[0].usd, 500);
  ok('nada en descuadres', cuerpo.descuadres.length, 0);
}

console.log('\n=== 2. UN SWAP NO ES INVERTIR ===');
{
  const ts = hace(3);
  const { cuerpo } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [
      tt('0x2', ts, USDC, 'USDC', 300, A, B),          // sale
      tt('0x2', ts, HEX, 'HEX', 900, B, A),                 // entra
    ] }],
  });
  ok('es un movimiento, no una entrada', cuerpo.dias[0].movimientos.length, 1);
  ok('y no hay entrada ninguna', cuerpo.dias[0].entradas.length, 0);
  /* ⚠ LO QUE MÁS IMPORTA DE TODO EL FICHERO: un swap NO suma dólares. Mover lo
     que ya tenías no es dinero que entra, y contarlo inflaría el total cada vez
     que se cambia de token. */
  ok('y sobre todo: no suma dólares', cuerpo.semanas.length, 0);
}

console.log('\n=== 3. UN TOKEN DE ESTAFA QUE SE LLAMA USDC NO COLA ===');
{
  const { cuerpo } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [tt('0xf1', hace(2), ESTAFA, 'USDC', 999999, B, A)] }],
  });
  ok('no se cuenta como dólares', cuerpo.semanas.length, 0);
  ok('va a descuadres', cuerpo.descuadres.length, 1);
}
{
  // Y al revés: la dirección buena con el símbolo cambiado tampoco.
  const { cuerpo } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [tt('0xf2', hace(2), USDC, 'USDCoin', 500, B, A)] }],
  });
  ok('dirección conocida pero símbolo raro: a descuadres', cuerpo.descuadres.length, 1);
  ok('y cero dólares', cuerpo.semanas.length, 0);
}

console.log('\n=== 4. TRASPASO ENTRE WALLETS PROPIAS ===');
{
  /* El mismo movimiento lo ve cada wallet por su lado: la que manda y la que
     recibe. Son dos filas de la tabla describiendo UN hecho. */
  const traspaso = tt('0xt1', hace(4), USDC, 'USDC', 300, B, A);
  const { cuerpo } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [traspaso] }],
    [`/addresses/${B}/token-transfers`]: [{ items: [traspaso] }],
  }, { w: [A, B] });
  ok('no es una inversión', cuerpo.dias.length, 0);
  ok('es un traspaso, y UNA sola vez', cuerpo.descuadres.map(d => d.motivo), ['traspaso']);
  ok('y no suma dólares', cuerpo.semanas.length, 0);

  /* ⚠ El origen y el destino tienen que LLEGAR a la portada. Estaban en la
     tabla desde siempre y se perdían al armar la respuesta, así que un envío
     hacia fuera llegaba como «salió PLS» sin decir a dónde — y sin eso la
     portada no puede notar que varios envíos idénticos fueron al mismo sitio,
     que es lo único que distingue unos depósitos de validador de unos envíos
     sueltos. */
  const cara = cuerpo.descuadres[0];
  ok('las piezas llevan de dónde y a dónde', [cara.sale[0].desde, cara.sale[0].hacia], [B, A]);
}

console.log('\n=== 5. `ver` DIBUJA MENOS, PERO NO CAMBIA QUÉ ES TUYO ===');
{
  /* El mismo traspaso, pero pidiendo ver solo A. La wallet apagada sigue en
     `w`, así que la Function tiene que seguir sabiendo que B es tuya: si no, el
     envío de B a A dejaría de ser un traspaso y pasaría a ser «salió de la
     wallet sin recibir nada». Ése es el fallo que este diseño evita, y aquí es
     donde se demuestra. */
  const traspaso = tt('0xv1', hace(4), USDC, 'USDC', 300, B, A);
  const { cuerpo } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [traspaso] }],
    [`/addresses/${B}/token-transfers`]: [{ items: [traspaso] }],
  }, { w: [A, B], ver: [A] });
  ok('se dice qué se está dibujando', cuerpo.ver, [A]);
  ok('y de quién son, que son las dos', cuerpo.wallets, [A, B]);
  ok('sigue siendo un traspaso, no una fuga', cuerpo.descuadres.map(d => d.motivo), ['traspaso']);
}
{
  const { cuerpo } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [tt('0xv2', hace(3), USDC, 'USDC', 500, B, A)] }],
  }, { w: [A] });
  ok('sin `ver`, se ven todas', cuerpo.ver, [A]);
  ok('y la entrada está', cuerpo.dias.length, 1);
}
{
  // Un `ver` con una dirección que no es tuya se cruza contra `w` antes de
  // usarlo, así que se ignora en vez de vaciar la respuesta.
  const { cuerpo } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [tt('0xv3', hace(3), USDC, 'USDC', 500, B, A)] }],
  }, { w: [A], ver: ['0x9999999999999999999999999999999999999999'] });
  ok('un `ver` ajeno se ignora, no vacía la respuesta', cuerpo.ver, [A]);
  ok('y sigue habiendo datos', cuerpo.dias.length, 1);
}

console.log('\n=== 6. UN ENVÍO HACIA FUERA LLEVA SU DESTINO ===');
{
  /* La forma de un depósito de validador. La agrupación la hace la portada
     —aquí solo se comprueba que el dato llega—, pero sin `hacia` no habría nada
     que agrupar. */
  const { cuerpo } = await llamar({
    [`/addresses/${A}/transactions`]: [{ items: [tx('0xd1', hace(5), 32e6, A, DEPOSITO)] }],
  });
  ok('es un descuadre, con su motivo', cuerpo.descuadres.map(d => d.motivo), ['salida hacia fuera']);
  ok('y se sabe a dónde fue', cuerpo.descuadres[0].sale[0].hacia, DEPOSITO);
  ok('en PLS nativo', cuerpo.descuadres[0].sale[0].dir, 'native');
}

console.log('\n=== 7. SIN WALLETS VÁLIDAS ===');
{
  const { res, cuerpo } = await llamar({}, { w: ['no-es-una-direccion'] });
  ok('responde 400', res.status, 400);
  ok('y lo dice', cuerpo.ok, false);
}

console.log('\n=== 8. EL CURSOR AVANZA ===');
{
  /* ⚠ LA PRUEBA QUE NACIÓ DE UN FALLO REAL. La siembra arrancaba SIEMPRE en la
     primera página, así que cada tanda releía las mismas tres y no avanzaba
     nunca: la ventana nominal eran 540 días y la real, tres. El cursor de cada
     flujo se guarda en `meta`, y aquí se comprueba que se escribe. */
  const { db } = await llamar({
    [`/addresses/${A}/token-transfers`]: [{ items: [tt('0xc1', hace(2), USDC, 'USDC', 100, B, A)] }],
  });
  const claves = [...db._meta.keys()].filter(k => k.startsWith('inv_cur_'));
  ok('se guarda un cursor por flujo', claves.length, 5);
  ok('y todos apuntan al fondo, que es lo que devuelve la fixture',
    [...new Set([...db._meta.values()])], ['fin']);
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
