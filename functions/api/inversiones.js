/**
 * PLSDASH — Pages Function: /api/inversiones
 *
 * El historial de inversiones de una o varias wallets.
 *
 * ## La distinción que lo ordena todo
 *
 * Un swap de PLS por HEX NO es invertir: es mover lo que ya tenías. Invertir es
 * cuando entra dinero de fuera. Toda esta Function existe para separar esas dos
 * cosas, y la separación se hace por TRANSACCIÓN, no por transferencia:
 *
 *   sale nada, entra algo   →  ENTRADA. Dinero de fuera.
 *   sale algo, entra algo   →  MOVIMIENTO. Un swap: cambias lo que ya tenías.
 *   sale algo, no entra     →  descuadre. Un envío hacia fuera.
 *
 * Esa clasificación es exacta y no necesita ninguna regla de reparto: la propia
 * transacción dice qué salió y qué entró. Por eso NO hay notas de procedencia
 * del tipo «este swap salió del ingreso del 12 de agosto» — harían falta reglas
 * para repartir una entrada entre swaps posteriores, y una regla se equivoca.
 *
 * ## Qué entrada cuenta como inversión
 *
 * Una entrada es dinero de fuera, pero no todo lo que llega es una inversión:
 * un airdrop también entra sin que salga nada. Se separan así:
 *
 *   entra stablecoin  →  inversión, con su importe en dólares (un USDC es un
 *                        dólar, así que no hace falta precio histórico de nada)
 *   entra PLS nativo  →  inversión, EN PLS y sin convertir. Convertirla pediría
 *                        el precio de aquel día y no lo tenemos. Se enseña
 *                        «Entraron 120M PLS» y se avisa de que no cuenta en el
 *                        resumen semanal en dólares.
 *   entra otra cosa   →  descuadre. Airdrop, regalo, traspaso. Buena parte de
 *                        esto serán airdrops de estafa, y por eso van aparte.
 *
 * ⚠ El fallo, cuando lo haya, cae del lado seguro: si la lista de stablecoins
 *   se queda corta o una dirección está mal, esa entrada NO se cuenta como
 *   dólares — se va a descuadres, donde se ve y se puede arreglar. Nunca al
 *   revés. Un importe en dólares inventado sería mucho peor que una entrada
 *   fuera de sitio.
 *
 * ## El reparto del día
 *
 * Cuando un día tiene entrada Y swaps, el dibujo son flechas de la entrada a
 * cada destino con su porcentaje. El porcentaje se calcula sobre EL STABLECOIN
 * QUE SALIÓ ESE DÍA: si ese día se gastaron 500 USDC y 300 fueron a HEX, la
 * flecha de HEX dice 60 %. Sale de las propias transacciones —cada swap dice
 * cuánto stablecoin entregó y cuánto token recibió— así que tampoco aquí hay
 * regla que pueda equivocarse.
 *
 * ## Siembra por tandas
 *
 * Igual que `ganancia.js`, y por el mismo motivo: intentar traerse el historial
 * completo de una wallet activa en una sola invocación termina en 524 sin haber
 * escrito nada. Cada llamada trae como mucho `PAGINAS_POR_TANDA` páginas por
 * dirección y por fuente, guarda lo que ha traído y deja el cursor apuntando a
 * donde se quedó. La siguiente llamada sigue por ahí. Mientras queda historia
 * por traer, la respuesta lleva `sembrando: true` y el panel lo dice.
 *
 * Y con SUELO DE FECHA: no se siembra hacia atrás sin fin. `DIAS_ATRAS` acota
 * la tabla, que aquí no guarda una wallet conocida sino la de cualquiera que
 * abra la página.
 */

const API = 'https://api.scan.pulsechain.com/api/v2';
const TIMEOUT_MS = 9000;

/* Hasta dónde se mira hacia atrás. Un año y medio: suficiente para que el
   historial cuente algo y acotado para que la tabla no crezca sin fin cuando la
   abre alguien con una wallet de hace años. */
const DIAS_ATRAS = 540;

/* Páginas por fuente y por tanda. Tres fuentes por dirección —tokens,
   transacciones e internas— así que el peor caso de una tanda son 9 peticiones
   al explorador por wallet. En marcha normal, con el cursor al día, es 3. */
const PAGINAS_POR_TANDA = 3;

/* Cuántas wallets se atienden en una llamada. Más de cuatro y el peor caso se
   va a 36 subpeticiones, que es donde el plan gratuito empieza a apretar. */
const MAX_WALLETS = 4;

const TAM_LOTE = 100;          // filas por escritura en D1
const TTL_BORDE = 120;         // segundos de caché en el borde

/**
 * Las stablecoins que cuentan como dólares.
 *
 * ⚠ ESTA LISTA HAY QUE VERIFICARLA CONTRA EL EXPLORADOR antes de fiarse de los
 *   resúmenes semanales. Las direcciones están escritas de memoria y no se han
 *   podido comprobar desde donde se escribió este fichero: el entorno no tiene
 *   salida a `api.scan.pulsechain.com`.
 *
 *   Lo que SÍ está garantizado es el modo de fallo. Se comprueba la dirección Y
 *   el símbolo: si la dirección no está en la lista, o está pero el token dice
 *   llamarse otra cosa, la entrada se va a descuadres con su motivo. O sea que
 *   una dirección equivocada se manifiesta como «esta entrada no la reconozco»
 *   —visible y arreglable— y nunca como un importe en dólares inventado.
 *
 *   Un token de estafa que se llame «USDC» tampoco cuela: el símbolo solo se
 *   usa para CONFIRMAR una dirección que ya está en la lista, nunca para
 *   admitir una que no está.
 */
const ESTABLES = new Map([
  ['0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07', 'USDC'],
  ['0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f', 'USDT'],
  ['0xefd766ccb38eaf1dfd701853bfce31359239f305', 'DAI'],
]);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

const responder = (datos, { status = 200, segundos = TTL_BORDE } = {}) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': segundos > 0 ? `public, max-age=${segundos}` : 'no-store',
      ...CORS,
    },
  });

const lc = s => String(s || '').toLowerCase();
const esDireccion = s => /^0x[0-9a-f]{40}$/.test(lc(s));

/** Un entero grande a número, con sus decimales. Sin `Number(BigInt)` a pelo. */
function aNumero(bruto, decimales) {
  let v;
  try { v = BigInt(bruto ?? '0'); } catch { return 0; }
  const d = Number.isFinite(+decimales) ? Math.max(0, Math.min(36, +decimales)) : 18;
  const div = 10n ** BigInt(d);
  const entera = v / div;
  const resto = v % div;
  return Number(entera) + Number(resto) / Number(div);
}

const aSegundos = t => {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

// ───────────────────────────────────────────────────────── el explorador

async function pedir(ruta, params) {
  const url = new URL(API + ruta);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'plsdash/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`explorador HTTP ${res.status}`);
  return res.json();
}

/**
 * Pagina una ruta hasta agotar la tanda, cruzar el suelo de fecha o quedarse
 * sin páginas. Devuelve lo traído y si quedaba más por traer.
 */
async function paginar(ruta, sueloTs, maxPaginas) {
  const items = [];
  let params = null, quedaMas = false;
  for (let i = 0; i < maxPaginas; i++) {
    const j = await pedir(ruta, params);
    const lote = Array.isArray(j.items) ? j.items : [];
    let cruzado = false;
    for (const it of lote) {
      const ts = aSegundos(it.timestamp || it.block_timestamp);
      if (ts == null) continue;
      if (ts < sueloTs) { cruzado = true; continue; }
      items.push(it);
    }
    if (cruzado) return { items, quedaMas: false };   // el suelo manda
    if (!j.next_page_params) return { items, quedaMas: false };
    params = j.next_page_params;
    quedaMas = true;                                  // hay más y se cortó aquí
  }
  return { items, quedaMas };
}

// ───────────────────────────────────────── de transferencias a transacciones

/**
 * Agrupa todo lo que ha pasado por la wallet en transacciones, y en cada una
 * separa lo que ENTRA de lo que SALE desde el punto de vista de la wallet.
 *
 * Es el paso que hace posible la clasificación: una transferencia suelta no
 * dice si fue una compra o un cobro; la transacción entera sí.
 */
function agrupar(wallet, { tokens, nativas, internas }) {
  const txs = new Map();
  const de = h => {
    if (!txs.has(h)) txs.set(h, { tx: h, ts: 0, entra: [], sale: [] });
    return txs.get(h);
  };

  for (const it of tokens) {
    const h = it.transaction_hash || it.tx_hash;
    if (!h) continue;
    const ts = aSegundos(it.timestamp || it.block_timestamp);
    if (ts == null) continue;
    const tok = it.token || {};
    const dir = lc(tok.address || tok.address_hash);
    if (!esDireccion(dir)) continue;
    const tipo = String(tok.type || '').toUpperCase();
    const decimales = tok.decimals != null ? tok.decimals : it.total?.decimals;
    const bruto = it.total?.value != null ? it.total.value : (it.total ?? it.value ?? '0');
    const cant = aNumero(bruto, decimales);
    const desde = lc(it.from?.hash || it.from);
    const hacia = lc(it.to?.hash || it.to);
    // Un NFT no tiene «cantidad» que sumar; se marca y acaba en descuadres.
    const nft = tipo.startsWith('ERC-721') || tipo.startsWith('ERC-1155');
    const pieza = { dir, sim: tok.symbol || '?', nom: tok.name || '', logo: tok.icon_url || null,
                    cant, nft, desde, hacia };
    const t = de(h);
    t.ts = Math.max(t.ts, ts);
    if (hacia === wallet && desde !== wallet) t.entra.push(pieza);
    else if (desde === wallet && hacia !== wallet) t.sale.push(pieza);
  }

  // PLS nativo. Las transacciones directas y las internas —que son por donde
  // llega el PLS que devuelve un swap— se tratan igual.
  for (const it of [...nativas, ...internas]) {
    const h = it.hash || it.transaction_hash;
    if (!h) continue;
    const ts = aSegundos(it.timestamp || it.block_timestamp);
    if (ts == null) continue;
    const cant = aNumero(it.value, 18);
    if (!(cant > 0)) continue;                  // llamadas sin valor: no son dinero
    const desde = lc(it.from?.hash || it.from);
    const hacia = lc(it.to?.hash || it.to);
    const pieza = { dir: 'native', sim: 'PLS', nom: 'Pulse', logo: null,
                    cant, nft: false, desde, hacia };
    const t = de(h);
    t.ts = Math.max(t.ts, ts);
    if (hacia === wallet && desde !== wallet) t.entra.push(pieza);
    else if (desde === wallet && hacia !== wallet) t.sale.push(pieza);
  }

  return [...txs.values()].filter(t => t.entra.length || t.sale.length);
}

/** Junta dos piezas del mismo token dentro de una transacción. */
function fundir(piezas) {
  const m = new Map();
  for (const p of piezas) {
    const a = m.get(p.dir);
    if (a) { a.cant += p.cant; a.nft = a.nft || p.nft; if (!a.logo && p.logo) a.logo = p.logo; }
    else m.set(p.dir, { ...p });
  }
  return [...m.values()];
}

const esEstable = p => ESTABLES.has(p.dir) && ESTABLES.get(p.dir) === String(p.sim).toUpperCase();

/**
 * Clasifica una transacción ya agrupada.
 *
 * `propias` es el conjunto de wallets del usuario: un traspaso entre wallets
 * suyas no es ni inversión ni movimiento, es cambiar de bolsillo.
 */
function clasificar(t, propias) {
  const entra = fundir(t.entra);
  const sale = fundir(t.sale);
  const base = { tx: t.tx, ts: t.ts, entra, sale };

  const desc = motivo => ({ ...base, clase: 'descuadre', motivo });

  if (entra.some(p => p.nft) || sale.some(p => p.nft)) return desc('nft');

  // Entre wallets propias: da igual la dirección del movimiento.
  const traspaso = [...entra, ...sale].some(p =>
    (propias.has(p.desde) && propias.has(p.hacia)));
  if (traspaso) return desc('traspaso');

  if (sale.length === 0 && entra.length > 0) {
    if (entra.length > 1) return desc('varios tokens de golpe');
    const p = entra[0];
    if (esEstable(p)) return { ...base, clase: 'entrada', moneda: 'usd', usd: p.cant };
    if (p.dir === 'native') return { ...base, clase: 'entrada', moneda: 'pls' };
    return desc('token que no es ni stablecoin ni PLS');
  }

  if (sale.length > 0 && entra.length === 0) return desc('salida hacia fuera');

  // Los dos lados con algo. Un swap es exactamente uno por uno; con más de un
  // token en algún lado esto es liquidez, un enrutado raro o algo que no se
  // puede leer como «cambié esto por aquello». No se adivina: va aparte.
  if (sale.length !== 1 || entra.length !== 1) return desc('varios tokens en la misma operación');

  return {
    ...base,
    clase: 'movimiento',
    // Lo que se gastó, si lo gastado fue stablecoin: es lo que da el porcentaje
    // del reparto del día.
    gastoUsd: esEstable(sale[0]) ? sale[0].cant : null,
  };
}

// ───────────────────────────────────────────────────────────────── D1

const CREAR = [
  `CREATE TABLE IF NOT EXISTS inversiones (
     wallet TEXT NOT NULL, tx TEXT NOT NULL, ts INTEGER NOT NULL,
     clase TEXT NOT NULL, motivo TEXT,
     entra TEXT NOT NULL, sale TEXT NOT NULL,
     usd REAL, gasto_usd REAL, moneda TEXT,
     PRIMARY KEY (wallet, tx)
   )`,
  `CREATE INDEX IF NOT EXISTS inversiones_wallet_ts ON inversiones (wallet, ts)`,
  `CREATE TABLE IF NOT EXISTS meta (
     clave TEXT PRIMARY KEY, valor TEXT, actualizado INTEGER
   )`,
];

async function asegurarTablas(db) {
  for (const sql of CREAR) await db.prepare(sql).run();
}

const leerMeta = async (db, clave) =>
  (await db.prepare('SELECT valor FROM meta WHERE clave = ?').bind(clave).first())?.valor ?? null;

const escribirMeta = (db, clave, valor) => db.prepare(
  'INSERT INTO meta (clave, valor, actualizado) VALUES (?, ?, ?)'
  + ' ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado = excluded.actualizado'
).bind(clave, String(valor), Math.floor(Date.now() / 1000)).run();

async function guardar(db, wallet, filas) {
  for (let i = 0; i < filas.length; i += TAM_LOTE) {
    const lote = filas.slice(i, i + TAM_LOTE).map(f => db.prepare(
      `INSERT INTO inversiones (wallet, tx, ts, clase, motivo, entra, sale, usd, gasto_usd, moneda)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, tx) DO UPDATE SET
         ts = excluded.ts, clase = excluded.clase, motivo = excluded.motivo,
         entra = excluded.entra, sale = excluded.sale, usd = excluded.usd,
         gasto_usd = excluded.gasto_usd, moneda = excluded.moneda`
    ).bind(
      wallet, f.tx, f.ts, f.clase, f.motivo ?? null,
      JSON.stringify(f.entra), JSON.stringify(f.sale),
      f.usd ?? null, f.gastoUsd ?? null, f.moneda ?? null,
    ));
    await db.batch(lote);
  }
}

/**
 * Una tanda para una dirección: pide, clasifica, guarda y mueve el cursor.
 * Devuelve si le queda historia por sembrar.
 */
async function tanda(db, wallet, propias, sueloTs) {
  const clave = 'inv_sembrada_' + wallet;
  const yaEsta = (await leerMeta(db, clave)) === '1';
  // Con la siembra hecha basta una página por fuente para recoger lo nuevo;
  // sin hacer, se tira de la tanda entera.
  const paginas = yaEsta ? 1 : PAGINAS_POR_TANDA;

  const [tk, nv, itx] = await Promise.all([
    paginar(`/addresses/${wallet}/token-transfers`, sueloTs, paginas),
    paginar(`/addresses/${wallet}/transactions`, sueloTs, paginas),
    paginar(`/addresses/${wallet}/internal-transactions`, sueloTs, paginas),
  ]);

  const filas = agrupar(wallet, { tokens: tk.items, nativas: nv.items, internas: itx.items })
    .map(t => clasificar(t, propias));
  if (filas.length) await guardar(db, wallet, filas);

  const quedaMas = tk.quedaMas || nv.quedaMas || itx.quedaMas;
  if (!quedaMas && !yaEsta) await escribirMeta(db, clave, '1');
  return quedaMas;
}

// ───────────────────────────────────────────────────── armar la respuesta

/* ⚠ El día y la semana se cuentan en la hora DEL USUARIO, no en UTC.
   Un ingreso a las 00:30 en España son las 22:30 UTC del día anterior: en UTC
   se dibujaría en el día de antes y, lo que es peor, «entrada y reparto el
   mismo día» dejaría de cuadrar justo en las operaciones de madrugada. Un
   Worker no sabe dónde está quien pregunta, así que el desfase lo manda la
   portada en `tz` —lo que devuelve `getTimezoneOffset()`, minutos— y aquí solo
   se aplica. Sin `tz` se trabaja en UTC, que es el comportamiento de siempre. */
const conDesfase = (ts, tzMin) => new Date((ts - tzMin * 60) * 1000);

const diaDe = (ts, tzMin) => conDesfase(ts, tzMin).toISOString().slice(0, 10);

/** El lunes de la semana de `ts`, en `YYYY-MM-DD`. */
function lunesDe(ts, tzMin) {
  const d = conDesfase(ts, tzMin);
  const dow = (d.getUTCDay() + 6) % 7;              // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const pieza = p => ({ sim: p.sim, logo: p.logo || null, cant: p.cant, dir: p.dir });

/**
 * De las filas guardadas al objeto que dibuja la portada: días, con sus tres
 * formas, resúmenes semanales y descuadres aparte.
 */
function armar(filas, tzMin) {
  const dias = new Map();
  const semanas = new Map();
  /* ⚠ Los descuadres se juntan POR TRANSACCIÓN, no por fila.
     Un traspaso entre dos wallets tuyas lo ve cada una por su lado —la que
     manda lo guarda como salida, la que recibe como entrada— y son dos filas de
     la tabla que describen UN solo hecho. Sin esto, la sección de «no cuadra»
     enseñaba el mismo movimiento dos veces. Lo cazó la prueba con las dos
     wallets puestas.

     Las entradas NO se juntan así a propósito: una misma transacción puede
     repartir dinero a dos wallets tuyas, y ahí sí son dos entradas de verdad
     que tienen que sumar las dos. */
  const descuadres = new Map();

  for (const f of filas) {
    const entra = JSON.parse(f.entra), sale = JSON.parse(f.sale);
    if (f.clase === 'descuadre') {
      const ya = descuadres.get(f.tx);
      if (ya) {
        // La otra cara del mismo hecho: se completa con lo que aporte.
        for (const p of entra.map(pieza)) if (!ya.entra.some(q => q.dir === p.dir)) ya.entra.push(p);
        for (const p of sale.map(pieza)) if (!ya.sale.some(q => q.dir === p.dir)) ya.sale.push(p);
      } else {
        descuadres.set(f.tx, { ts: f.ts, tx: f.tx, motivo: f.motivo,
                               entra: entra.map(pieza), sale: sale.map(pieza) });
      }
      continue;
    }
    const dia = diaDe(f.ts, tzMin);
    if (!dias.has(dia)) dias.set(dia, { fecha: dia, entradas: [], movimientos: [] });
    const d = dias.get(dia);

    if (f.clase === 'entrada') {
      d.entradas.push({ ts: f.ts, moneda: f.moneda, usd: f.usd ?? null, ...pieza(entra[0]) });
      if (f.moneda === 'usd' && f.usd > 0) {
        const l = lunesDe(f.ts, tzMin);
        semanas.set(l, (semanas.get(l) || 0) + f.usd);
      }
    } else {
      d.movimientos.push({ ts: f.ts, sale: pieza(sale[0]), entra: pieza(entra[0]),
                           gastoUsd: f.gasto_usd ?? null });
    }
  }

  /* El reparto: solo en los días que tienen entrada Y swaps pagados con
     stablecoin. El porcentaje es sobre el stablecoin gastado ESE DÍA, que sale
     de las propias transacciones y no de ninguna regla de reparto. */
  for (const d of dias.values()) {
    const conGasto = d.movimientos.filter(m => m.gastoUsd > 0);
    if (!d.entradas.length || !conGasto.length) continue;
    const total = conGasto.reduce((a, m) => a + m.gastoUsd, 0);
    if (!(total > 0)) continue;
    const porDestino = new Map();
    for (const m of conGasto) {
      const k = m.entra.dir;
      const a = porDestino.get(k) || { ...m.entra, cant: 0, usd: 0 };
      a.cant += m.entra.cant; a.usd += m.gastoUsd;
      porDestino.set(k, a);
    }
    d.reparto = [...porDestino.values()]
      .map(a => ({ ...a, pct: (a.usd / total) * 100 }))
      .sort((x, y) => y.pct - x.pct);
    d.gastadoUsd = total;
  }

  return {
    dias: [...dias.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
    semanas: [...semanas.entries()]
      .map(([desde, usd]) => ({ desde, usd }))
      .sort((a, b) => (a.desde < b.desde ? 1 : -1)),
    descuadres: [...descuadres.values()].sort((a, b) => b.ts - a.ts),
  };
}

// ─────────────────────────────────────────────────────────────── entrada

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const brutas = (url.searchParams.get('w') || '').split(',').map(lc).filter(Boolean);
  const wallets = [...new Set(brutas.filter(esDireccion))].slice(0, MAX_WALLETS);

  if (!wallets.length) {
    return responder({ ok: false, error: 'sin wallets válidas' }, { status: 400, segundos: 0 });
  }
  if (!env.VALIDATOR_DB) {
    return responder({ ok: false, error: 'sin base de datos' }, { status: 503, segundos: 0 });
  }

  const db = env.VALIDATOR_DB;
  const sueloTs = Math.floor(Date.now() / 1000) - DIAS_ATRAS * 86400;
  const propias = new Set(wallets);

  let sembrando = false;
  const fallos = [];
  try {
    await asegurarTablas(db);
    for (const w of wallets) {
      try {
        if (await tanda(db, w, propias, sueloTs)) sembrando = true;
      } catch (e) {
        // Que una wallet falle no puede dejar sin historial a las otras: se
        // anota y se sigue con lo que haya guardado de antes.
        fallos.push({ wallet: w, error: String(e.message || e) });
      }
    }
  } catch (e) {
    return responder({ ok: false, error: String(e.message || e) }, { status: 502, segundos: 0 });
  }

  const marcas = wallets.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT * FROM inversiones WHERE wallet IN (${marcas}) AND ts >= ? ORDER BY ts DESC`
  ).bind(...wallets, sueloTs).all();

  /* `getTimezoneOffset()` da minutos y con el signo al revés de lo que uno
     espera: en España en verano son -120. Se acota a ±16 h, que cubre todos los
     husos reales, para que un parámetro inventado no descoloque las fechas. */
  const tzBruto = Number(url.searchParams.get('tz'));
  const tzMin = Number.isFinite(tzBruto) ? Math.max(-960, Math.min(960, Math.trunc(tzBruto))) : 0;

  const salida = armar(results || [], tzMin);
  return responder({
    ok: true,
    wallets,
    desde: sueloTs,
    tz: tzMin,
    // Mientras esto sea true falta historia por traer: la portada lo dice y
    // vuelve a llamar. No es un error, es una siembra a medias.
    sembrando,
    fallos,
    ...salida,
  }, { segundos: sembrando ? 0 : TTL_BORDE });
}
