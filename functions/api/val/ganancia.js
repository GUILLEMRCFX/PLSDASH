/**
 * PLSDASH — Validator Dashboard: /api/val/ganancia
 *
 * Requiere sesión válida (ver _middleware.js).
 *
 * La ganancia real, reconciliada contra la cadena.
 *
 * `ganado` del beacon es solo el excedente que aún no se ha retirado: cada
 * ~8,1 h el protocolo lo barre a la wallet y vuelve a cero. Lo ganado de
 * verdad es lo retirado más ese excedente, y lo retirado solo lo sabe la
 * cadena:
 *
 *     ganancia real = retiradas de nuestros validadores + excedente sin barrer
 *
 * ## La tabla manda, no la caché
 *
 * La primera versión llevaba el acumulado en KV con su propio cursor. Eso
 * dejaba dos estados que podían separarse, y se separaron: KV iba por el
 * índice 160169136 con siete barridos contados mientras `barridos` seguía
 * vacía, así que al desplegar la escritura solo habría recogido lo posterior
 * y las siete retiradas ya contadas no habrían entrado nunca.
 *
 * Ahora `barridos` es el estado. El cursor sale de su propio máximo, de modo
 * que una tabla vacía se rellena sola desde el principio, y los totales se
 * calculan con SQL sobre ella. KV se queda solo como caché de la respuesta,
 * para no llamar al explorador en cada carga del panel.
 */

/* ⚠ LA WALLET NO SE ESCRIBE AQUÍ, NI LA FECHA DE ACTIVACIÓN. Estuvieron las dos
   a mano, y las dos las sabe la cadena: el recolector publica la dirección de
   retirada —la leen las `withdrawal_credentials` de los validadores— y la
   activación de cada uno. Salen del estado igual que los índices; ver
   `grupoDesde()`. */
const API = 'https://api.scan.pulsechain.com/api/v2';

// Los índices propios NO se escriben aquí.
//
// Estuvieron a fuego como un rango `109549..109558`, y funcionó exactamente
// hasta que entró el undécimo validador: su índice es 109876, no 109559,
// porque entre un depósito y el siguiente entraron 317 validadores más en la
// red. Ampliar el rango tampoco habría servido — los índices no son
// correlativos y nunca lo van a ser.
//
// Ahora el conjunto sale del estado real que publica el recolector, con la
// caché de esta misma respuesta como respaldo. Filtrar sigue haciendo falta:
// esta wallet la usó otro validador durante un año, y aunque el corte por
// activación deja fuera casi todo lo suyo, una retirada de salida podría
// caer del lado nuevo y colarse como si fuera nuestra.
const CLAVE_ESTADO = 'validator:estado';

// Una retirada normal ronda los 2.390 PLS por validador y ciclo; cuando toca
// proponer bloque sube a ~8.100. El umbral solo sirve para contarlos.
const UMBRAL_BLOQUE = 5000;

const CLAVE_CACHE = 'validator:ganancia';
const WEI = 1e18;

// El recolector escribe cada 3 min; recontar más a menudo no aporta nada.
const FRESCURA_MS = 5 * 60 * 1000;

// El corte por activación sigue haciendo falta: todo lo anterior pertenece al
// validador que usó esta misma wallet durante casi un año, y son miles de
// retiradas. Sin él, una tabla vacía dispara un recorrido que termina en 524
// (timeout de Cloudflare) sin llegar a escribir nada. Lo que cambia es de
// dónde sale: de la activación más antigua del grupo, que publica el
// recolector. Hasta el 23-sep-2026 era el número 1786095955 escrito aquí, y es
// exactamente lo que da la epoch 319720 de los primeros diez.

// Páginas por fase y pasada. Cada llamada hace como mucho NOVEDADES + SIEMBRA,
// así que el peor caso son 6 peticiones al explorador. En marcha normal es una.
//
// 3 páginas son 150 retiradas ≈ cinco días de barridos, margen de sobra para
// que una ausencia larga no deje huecos entre lo guardado y lo nuevo.
const PAGINAS_NOVEDADES = 3;
const PAGINAS_SIEMBRA = 3;

const CLAVE_SIEMBRA = 'barridos_siembra_completa';

// Hasta qué instante se han pasado los barridos al registro de vida. Va
// aparte del cursor de `barridos` porque son dos avances distintos: la tabla
// puede estar completa y el registro no haberse escrito todavía, que es
// justo lo que pasó al desplegar la escritura con la tabla ya sembrada.
const CLAVE_EVENTOS = 'eventos_hasta_ts';

// D1 acepta lotes grandes, pero trocear mantiene cada escritura acotada.
const TAM_LOTE = 100;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

async function pedir(ruta, params) {
  const url = new URL(API + ruta);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'user-agent': 'plsdash/1.0' } });
  if (!res.ok) throw new Error(`explorador HTTP ${res.status}`);
  return res.json();
}

/** Extremos de lo ya guardado. Sirven de cursor en las dos direcciones. */
async function extremos(db) {
  const fila = await db.prepare(
    'SELECT MAX(indice_retirada) AS tope, MIN(indice_retirada) AS suelo FROM barridos'
  ).first();
  return {
    tope: fila && fila.tope != null ? Number(fila.tope) : null,
    suelo: fila && fila.suelo != null ? Number(fila.suelo) : null,
  };
}

async function leerMeta(db, clave) {
  const fila = await db.prepare('SELECT valor FROM meta WHERE clave = ?').bind(clave).first();
  return fila?.valor ?? null;
}

async function escribirMeta(db, clave, valor) {
  await db.prepare(
    'INSERT INTO meta (clave, valor, actualizado) VALUES (?, ?, ?)'
    + ' ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor,'
    + ' actualizado = excluded.actualizado'
  ).bind(clave, String(valor), Math.floor(Date.now() / 1000)).run();
}

async function siembraCompleta(db) {
  return (await leerMeta(db, CLAVE_SIEMBRA)) === '1';
}

async function marcarSiembraCompleta(db) {
  await escribirMeta(db, CLAVE_SIEMBRA, '1');
}

// Margen para considerar que dos retiradas pertenecen al mismo barrido. El
// protocolo reparte los diez en el mismo instante, pero puede partirlos entre
// dos bloques consecutivos: el del 9-ago fue 6 + 4 con 10 s de diferencia.
const SEGUNDOS_MISMO_BARRIDO = 120;

// Agrupar por minuto fijo contaba ese barrido partido como dos. Se agrupa por
// cercanía: una retirada abre ciclo nuevo solo si han pasado más de dos
// minutos desde la anterior.
const SQL_CICLOS = `
  WITH marcado AS (
    SELECT ts, cantidad, es_bloque, validador,
           CASE WHEN LAG(ts) OVER (ORDER BY ts) IS NULL
                  OR ts - LAG(ts) OVER (ORDER BY ts) > ?
                THEN 1 ELSE 0 END AS inicio
    FROM barridos
  ), grupos AS (
    SELECT *, SUM(inicio) OVER (ORDER BY ts ROWS UNBOUNDED PRECEDING) AS ciclo
    FROM marcado
  )
  SELECT ciclo, MIN(ts) AS ts, COUNT(*) AS validadores,
         SUM(cantidad) AS pls, SUM(es_bloque) AS bloques,
         GROUP_CONCAT(CASE WHEN es_bloque = 1 THEN validador END) AS proponentes,
         SUM(CASE WHEN es_bloque = 0 THEN cantidad END) AS pls_base,
         SUM(CASE WHEN es_bloque = 0 THEN 1 END) AS n_base
  FROM grupos GROUP BY ciclo ORDER BY ts ASC`;

async function ciclos(db) {
  const { results } = await db.prepare(SQL_CICLOS).bind(SEGUNDOS_MISMO_BARRIDO).all();

  return (results || []).map(c => {
    // Lo que habría cobrado el proponente sin el bloque: la media de sus
    // compañeros en ese mismo ciclo. La diferencia es la recompensa del bloque.
    const base = c.n_base > 0 ? c.pls_base / c.n_base : null;
    const extra = base != null && c.bloques > 0
      ? Math.max(0, c.pls - (base * c.validadores))
      : 0;

    return {
      ts: Number(c.ts),
      validadores: Number(c.validadores),
      pls: Number(c.pls),
      bloques: Number(c.bloques),
      proponentes: c.proponentes ? String(c.proponentes).split(',').map(Number) : [],
      base_validador: base,
      pls_bloques: extra,
    };
  });
}

/** Cuántos bloques lleva propuestos cada validador. */
async function porValidador(db) {
  const { results } = await db.prepare(
    'SELECT validador, SUM(es_bloque) AS bloques FROM barridos'
    + ' GROUP BY validador HAVING bloques > 0'
  ).all();
  const mapa = {};
  for (const f of results || []) mapa[f.validador] = Number(f.bloques);
  return mapa;
}

/** Saldo actual de la wallet: el dinero que de verdad ha llegado. */
async function saldoWallet(wallet) {
  const datos = await pedir(`/addresses/${wallet}`, null);
  const bruto = datos?.coin_balance;
  return bruto != null ? Number(bruto) / WEI : null;
}

/**
 * Recorre el listado de retiradas, que viene de más nueva a más vieja.
 *
 * `arrancarEn`  índice desde el que continuar hacia atrás (para la siembra).
 * `pararEn`     índice ya guardado: al alcanzarlo no queda nada nuevo.
 * `maxPaginas`  presupuesto de esta pasada.
 *
 * Devuelve lo encontrado y el motivo de la parada, que es lo que dice si la
 * siembra ha terminado o si hay que seguir en la próxima llamada.
 */
async function recorrer({ arrancarEn = null, pararEn = null, maxPaginas, propios, wallet, activacionTs }) {
  const encontradas = [];
  let params = { items_count: 50 };
  if (arrancarEn != null) params.index = arrancarEn;

  let motivo = 'presupuesto';
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const datos = await pedir(`/addresses/${wallet}/withdrawals`, params);
    const items = datos.items || [];
    if (!items.length) { motivo = 'fin'; break; }

    let parada = null;
    for (const w of items) {
      const indice = Number(w.index);
      const ts = Math.floor(Date.parse(w.timestamp) / 1000);

      // Cruzar la activación significa haber llegado al validador anterior.
      if (ts < activacionTs) { parada = 'activacion'; break; }
      if (pararEn != null && indice <= pararEn) { parada = 'conocido'; break; }

      const validador = Number(w.validator_index);
      if (!propios.has(validador)) continue;

      encontradas.push({
        indice,
        validador,
        pls: Number(w.amount) / WEI,
        ts,
        bloque: Number(w.block_number) || null,
      });
    }

    if (parada) { motivo = parada; break; }
    if (!datos.next_page_params) { motivo = 'fin'; break; }
    params = { items_count: 50, ...datos.next_page_params };
  }

  return { encontradas, motivo };
}

/**
 * INSERT OR IGNORE: el índice de retirada es la clave primaria, así que
 * reprocesar un tramo no duplica nada.
 *
 * ⚠ `precio_pls` NO se nombra aquí, y no es porque la columna no exista.
 *
 *   El comentario que había aquí decía que «la columna se ha borrado». Era
 *   falso: lo que se escribió fue la migración que la borraría, y esa
 *   migración lleva aparcada desde el 25-ago sin ejecutarse. La columna sigue
 *   en D1 — el documento 03 la verificó contra producción el 15-sep— y desde
 *   el 21-sep-2026 se RELLENA, con el repaso `sellarPrecios()` de más arriba.
 *
 *   Se sigue sin nombrar en el INSERT a propósito: un barrido puede
 *   descubrirse antes de que exista el snapshot de su hora, y con
 *   `INSERT OR IGNORE` esa fila no se volvería a tocar jamás. El repaso la
 *   sella cuando el dato está.
 */
async function guardar(db, nuevas) {
  if (!nuevas.length) return 0;

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO barridos'
    + ' (indice_retirada, ts, validador, cantidad, bloque, es_bloque)'
    + ' VALUES (?, ?, ?, ?, ?, ?)'
  );

  let escritas = 0;
  for (let i = 0; i < nuevas.length; i += TAM_LOTE) {
    const lote = nuevas.slice(i, i + TAM_LOTE).map(n => stmt.bind(
      n.indice, n.ts, n.validador, n.pls, n.bloque, n.pls > UMBRAL_BLOQUE ? 1 : 0
    ));
    const res = await db.batch(lote);
    escritas += res.reduce((acc, r) => acc + (r.meta?.changes || 0), 0);
  }
  return escritas;
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL PRECIO DE CADA BARRIDO

   `barridos.precio_pls` llevaba 1.218 filas a cero desde siempre, y era el
   único agujero del proyecto que EMPEORA CADA DÍA: el precio de una hora
   pasada no lo sirve ninguna API, así que cada barrido que se registra sin él
   queda sin valor para siempre. Es el bloqueo nº 1 del documento 27.

   ## De dónde sale el precio, y por qué NO del momento de registrarlo

   La tentación es sellar con el precio de ahora, como hacen las aportaciones.
   Pero una aportación se apunta cuando ocurre, y un barrido se DESCUBRE
   cuando alguien abre el panel — que pueden ser horas o días después de que
   la cadena lo hiciera. Sellar con el precio de ahora sería inventarse un
   precio retroactivo, igual de falso que inventárselo hacia atrás.

   Así que sale de `snapshots.precio_pls`: el precio que ESTE MISMO PROYECTO
   registró, cada hora, desde el 16-ago-2026. No es una estimación ni una
   reconstrucción — es una lectura que ya estaba guardada. Se toma la más
   cercana en el tiempo al barrido, y solo si cae dentro de la tolerancia.

   ⚠ Y si no hay ninguna cerca, se queda a NULL. Un hueco es la respuesta
     correcta cuando no se sabe; el panel lo distingue y lo dice.

   ## Por qué es un repaso y no parte del INSERT

   Un barrido puede descubrirse ANTES de que exista el snapshot de su hora
   —la cadena va por delante del cron—, y con `INSERT OR IGNORE` esa fila no
   se vuelve a tocar nunca: el precio se perdería justo en los barridos más
   recientes, que son los que más importan. Como repaso idempotente, la fila
   se sella en cuanto el snapshot aparece.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Los snapshots son horarios, así que el más cercano a un instante cualquiera
   está a ≤30 min. Se dan 90 para que un snapshot perdido —el NUC apagado una
   hora— no deje sin precio a los barridos de alrededor. Más allá de eso, el
   precio de PLS se ha movido lo bastante como para que la cifra deje de ser
   la de aquel momento: PLS hizo un 47 % en cinco días. */
export const TOLERANCIA_PRECIO_S = 90 * 60;

/* Solo se sellan los barridos RECIENTES. No es una limitación técnica: es la
   diferencia entre rellenar lo que va llegando y reescribir el pasado, y la
   segunda es una decisión del propietario, no de este código. Ver la nota de
   abajo sobre los 1.218 antiguos. */
export const VENTANA_SELLADO_S = 7 * 86400;

/**
 * El precio registrado más cercano a un instante, o `null` si no hay ninguno
 * dentro de la tolerancia.
 *
 * ⚠ ESTO ESTUVO ESCRITO EN SQL Y ERA UNA TRAMPA. La versión correlada
 *   —`... WHERE s.ts BETWEEN barridos.ts - ? ...`— **SQLite la rechaza**: no
 *   deja cualificar la tabla del UPDATE dentro de la subconsulta del SET, ni
 *   por nombre ni por alias.
 *
 *   Y la versión sin cualificar, que sí compila, hace algo peor que fallar:
 *   `snapshots` TAMBIÉN tiene una columna `ts`, así que `ts` ahí dentro se
 *   resuelve a `s.ts` y la condición queda `s.ts BETWEEN s.ts-tol AND
 *   s.ts+tol` — siempre cierta— y el orden `ABS(s.ts - ts)` sale cero para
 *   todos. Devuelve un precio cualquiera del rango entero y parece funcionar.
 *   Lo cazó la prueba, comprobando que se coge el MÁS CERCANO y no uno
 *   cualquiera.
 *
 *   Así que la elección se hace aquí, en JavaScript, donde se puede leer y
 *   probar. Las consultas quedan en dos lecturas y unas pocas escrituras por
 *   clave primaria, sin correlación ninguna.
 *
 * @param {number} ts          instante del barrido
 * @param {Array}  snapshots   `{ts, precio_pls}`, los que tengan precio
 * @returns {number|null}
 */
export function precioMasCercano(ts, snapshots = [], tolerancia = TOLERANCIA_PRECIO_S) {
  let mejor = null, mejorDist = Infinity;
  for (const s of snapshots) {
    const st = Number(s.ts);
    const p = Number(s.precio_pls);
    if (!Number.isFinite(st) || !Number.isFinite(p) || p <= 0) continue;
    const d = Math.abs(st - ts);
    // `<` y no `<=`: ante un empate exacto gana el primero, y las filas vienen
    // ordenadas por `ts`, así que el desempate es el más antiguo. Da igual
    // cuál, pero tiene que ser SIEMPRE el mismo o dos pasadas discreparían.
    if (d <= tolerancia && d < mejorDist) { mejor = p; mejorDist = d; }
  }
  return mejor;
}

/** Cuántos barridos han quedado sellados en esta pasada. */
async function sellarPrecios(db, ahoraS) {
  const desde = ahoraS - VENTANA_SELLADO_S;

  const { results: pendientes = [] } = await db.prepare(
    'SELECT indice_retirada, ts FROM barridos'
    + ' WHERE precio_pls IS NULL AND ts >= ? ORDER BY ts'
  ).bind(desde).all();
  if (!pendientes.length) return 0;

  // Solo la franja que puede servir: de los snapshots (910 filas) se traen
  // los que caen alrededor de los barridos pendientes, no la tabla entera.
  const min = Number(pendientes[0].ts) - TOLERANCIA_PRECIO_S;
  const max = Number(pendientes[pendientes.length - 1].ts) + TOLERANCIA_PRECIO_S;
  const { results: snaps = [] } = await db.prepare(
    'SELECT ts, precio_pls FROM snapshots'
    + ' WHERE precio_pls IS NOT NULL AND ts BETWEEN ? AND ? ORDER BY ts'
  ).bind(min, max).all();
  if (!snaps.length) return 0;

  const stmt = db.prepare('UPDATE barridos SET precio_pls = ? WHERE indice_retirada = ?');
  const lote = [];
  for (const b of pendientes) {
    const p = precioMasCercano(Number(b.ts), snaps);
    // Sin precio cerca NO se escribe nada: un hueco es la respuesta correcta
    // cuando no se sabe, y además así el recuento significa algo.
    if (p != null) lote.push(stmt.bind(p, b.indice_retirada));
  }
  if (!lote.length) return 0;

  let sellados = 0;
  for (let i = 0; i < lote.length; i += TAM_LOTE) {
    const res = await db.batch(lote.slice(i, i + TAM_LOTE));
    sellados += res.reduce((a, r) => a + (r.meta?.changes || 0), 0);
  }
  return sellados;
}

/**
 * Cuánto de lo barrido tiene precio de verdad, y cuánto valía al cobrarlo.
 *
 * Son dos cifras distintas y el panel tiene que poder decirlo: «lo que vale
 * hoy» sale de multiplicar todo por el precio de ahora, y «lo que valía al
 * cobrarlo» solo se puede calcular sobre los barridos sellados.
 */
async function valorado(db) {
  const f = await db.prepare(
    'SELECT COUNT(*) AS todos,'
    + ' SUM(CASE WHEN precio_pls IS NOT NULL THEN 1 ELSE 0 END) AS con_precio,'
    + ' SUM(CASE WHEN precio_pls IS NOT NULL THEN cantidad ELSE 0 END) AS pls,'
    + ' SUM(CASE WHEN precio_pls IS NOT NULL THEN cantidad * precio_pls ELSE 0 END) AS usd'
    + ' FROM barridos'
  ).first();
  if (!f) return null;
  return {
    barridos: Number(f.todos) || 0,
    con_precio: Number(f.con_precio) || 0,
    pls: Number(f.pls) || 0,
    usd: Number(f.usd) || 0,
  };
}

// Un evento se identifica por (ts, tipo, validador). `ON CONFLICT DO NOTHING`
// se apoya en el índice único `ix_eventos_unico`, y sin objetivo explícito:
// así solo se traga los choques de unicidad y cualquier otro fallo —un NOT
// NULL, por ejemplo— sigue saliendo a la superficie en vez de desaparecer.
const SQL_EVENTO =
  'INSERT INTO eventos (ts, tipo, titulo, detalle, pls, validador)'
  + ' VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING';

/**
 * Anota en `eventos` los barridos y bloques que aún no estuvieran.
 *
 * El registro de vida llevaba un solo evento —el sembrado a mano— mientras en
 * dos días pasaban ocho bloques y ocho barridos. Los datos estaban en
 * `barridos`; solo faltaba contarlos como sucesos.
 *
 * ## Por qué ya no se consulta antes de insertar
 *
 * Aquí había un SELECT por evento y, si no aparecía, un INSERT. Eso es una
 * carrera: este endpoint es un GET sin cerrojo y lo llama el panel en cada
 * carga, así que dos peticiones a la vez consultaban las dos, no encontraban
 * nada las dos, e insertaban las dos. No es teórico — el ciclo del 16-ago-2026
 * a las 21:20:45 acabó con el barrido escrito dos veces y el bloque del
 * validador 109555 también.
 *
 * Ahora la unicidad la impone la base de datos con `ix_eventos_unico`, un
 * índice sobre `(ts, tipo, COALESCE(validador, -1))`. El COALESCE no es
 * adorno: en SQLite dos NULL no se consideran iguales a efectos de índice
 * único, y `validador` es NULL en TODOS los barridos — un índice sobre la
 * columna a pelo habría dejado pasar exactamente el duplicado que causó el
 * problema. Comprobado contra la base real: con el índice puesto, insertar un
 * barrido repetido falla con SQLITE_CONSTRAINT_UNIQUE.
 *
 * Sale además una consulta por evento en vez de dos.
 */
export async function registrarEventos(db, ciclosNuevos) {
  let escritos = 0;

  for (const c of ciclosNuevos) {
    const barrido = await db.prepare(SQL_EVENTO).bind(
      c.ts, 'barrido', 'Barrido de saldo',
      `${c.validadores} validadores retirados`, c.pls, null
    ).run();
    // `changes` distingue lo escrito de lo ignorado por repetido, que antes
    // decidía el SELECT previo.
    escritos += barrido?.meta?.changes ?? 0;

    for (const v of c.proponentes) {
      // La recompensa se reparte entre los proponentes del ciclo: si hubo dos,
      // el extra medido es de los dos juntos.
      const premio = c.bloques > 0 ? c.pls_bloques / c.bloques : null;
      const bloque = await db.prepare(SQL_EVENTO).bind(
        c.ts, 'bloque', 'Bloque propuesto',
        `Validador ${v}`, premio, v
      ).run();
      escritos += bloque?.meta?.changes ?? 0;
    }
  }

  return escritos;
}

/**
 * Qué wallet mirar, qué índices son nuestros y desde cuándo contar.
 *
 * Los tres, con el mismo orden de preferencia:
 *   1. `validator:estado` en KV — lo que acaba de publicar el recolector, que
 *      los lee de la cadena y de los keystores del disco.
 *   2. Lo guardado en la caché de esta misma respuesta, por si KV falla o el
 *      recolector lleva un rato callado.
 *
 * Cada uno por separado: un recolector anterior al 23-sep-2026 publica índices
 * y activaciones pero no la wallet, y eso no debe tirar los otros dos.
 *
 * Lo que no aparezca en ninguno de los dos sitios vuelve `null`, y quien llama
 * NO recorre el explorador. Es deliberado: sin saber cuáles son nuestros, la
 * alternativa sería aceptar cualquier retirada a esta wallet, y esta wallet la
 * usó otro validador durante un año. Escribir sus retiradas en `barridos`
 * inflaría el total para siempre y habría que limpiarlo a mano. Una cifra vieja
 * se arregla sola en la siguiente pasada; una tabla contaminada, no.
 */
export function grupoDesde(estado, cache) {
  const v = estado?.validadores || {};
  const detalle = Array.isArray(v.detalle) ? v.detalle : [];

  const deEstado = new Set(detalle.map(d => d?.indice)
    .filter(i => i != null && i !== '').map(Number).filter(Number.isFinite));
  const deCache = new Set((Array.isArray(cache?.indices) ? cache.indices : [])
    .map(Number).filter(Number.isFinite));
  const indices = deEstado.size ? deEstado : (deCache.size ? deCache : null);

  const esDireccion = w => typeof w === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w);
  const wallet = esDireccion(v.wallet_retirada) ? v.wallet_retirada.toLowerCase()
    : esDireccion(cache?.wallet) ? cache.wallet.toLowerCase() : null;

  /* La activación del grupo es la MÁS ANTIGUA de las reales. La de un
     validador en cola es null y no puede ser el mínimo de nada. */
  const activaciones = detalle.map(d => Number(d?.activacion_ts))
    .filter(t => Number.isFinite(t) && t > 0);
  const deGrupo = Number(v.activacion_ts);
  const activacionTs = Number.isFinite(deGrupo) && deGrupo > 0 ? deGrupo
    : activaciones.length ? Math.min(...activaciones)
    : Number(cache?.activacion_ts) > 0 ? Number(cache.activacion_ts) : null;

  return { indices, wallet, activacionTs };
}

async function grupoPropio(env, cache) {
  let estado = null;
  if (env.PLSDASH_KV) {
    try { estado = await env.PLSDASH_KV.get(CLAVE_ESTADO, { type: 'json' }); }
    catch { /* se prueba el respaldo */ }
  }
  return grupoDesde(estado, cache);
}

export async function onRequestGet({ env }) {
  const db = env.VALIDATOR_DB;
  if (!db) return json({ error: 'D1 no configurado (binding VALIDATOR_DB)' }, 500);

  // Caché de respuesta. Si algo falla al leerla se sigue adelante: es una
  // optimización, no un requisito.
  let cacheGuardada = null;
  try {
    if (env.PLSDASH_KV) {
      const cache = await env.PLSDASH_KV.get(CLAVE_CACHE, { type: 'json' });
      cacheGuardada = cache;
      // Durante la siembra la caché se acorta: si no, cada tramo esperaría
      // cinco minutos y completar el histórico llevaría horas.
      const ventana = cache && cache.sembrando ? 5000 : FRESCURA_MS;
      if (cache && Date.now() - (cache.actualizado || 0) < ventana) {
        return json({ ...cache, obsoleto: false, de_cache: true });
      }
    }
  } catch { /* sin caché, se recalcula */ }

  let nuevas = 0;
  let error = null;
  let sembrando = false;

  const { indices: propios, wallet, activacionTs } = await grupoPropio(env, cacheGuardada);

  try {
    // Sin cualquiera de los tres no se toca el explorador: ver `grupoDesde`.
    if (!propios) {
      throw new Error('no se sabe qué índices son nuestros (KV sin estado y sin caché)');
    }
    if (!wallet) {
      throw new Error('no se sabe cuál es la wallet de retirada: el recolector no la publica '
        + '(¿versión anterior al 23-sep-2026?) o los validadores no comparten una');
    }
    if (!activacionTs) {
      throw new Error('no se sabe desde cuándo contar: ningún validador tiene activación');
    }
    const comun = { propios, wallet, activacionTs };

    const { tope, suelo } = await extremos(db);

    // Fase 1 — novedades. Desde la más reciente hasta alcanzar lo guardado.
    const nov = await recorrer({ pararEn: tope, maxPaginas: PAGINAS_NOVEDADES, ...comun });
    nuevas += await guardar(db, nov.encontradas);

    // Fase 2 — siembra hacia atrás, a trozos. La tabla empieza vacía y el
    // histórico no cabe en una sola llamada sin agotar el tiempo del Worker,
    // así que cada carga del panel avanza un tramo y se guarda el progreso
    // solo con haber escrito las filas: el cursor es el mínimo de la tabla.
    if (!(await siembraCompleta(db))) {
      const desde = suelo ?? (nov.encontradas.length
        ? Math.min(...nov.encontradas.map(n => n.indice))
        : null);

      if (desde != null) {
        const atras = await recorrer({ arrancarEn: desde, maxPaginas: PAGINAS_SIEMBRA, ...comun });
        nuevas += await guardar(db, atras.encontradas);

        if (atras.motivo === 'activacion' || atras.motivo === 'fin') {
          await marcarSiembraCompleta(db);
        } else {
          sembrando = true;
        }
      }
    }
  } catch (e) {
    // Si el explorador no responde se sirve lo que ya está guardado: una cifra
    // algo vieja es mejor que ninguna, siempre que se diga.
    error = String(e.message || e);
  }

  const lista = await ciclos(db);
  const total = lista.reduce((a, c) => a + c.pls, 0);
  const bloques = lista.reduce((a, c) => a + c.bloques, 0);
  const plsBloques = lista.reduce((a, c) => a + c.pls_bloques, 0);

  // El registro avanza por su cuenta: se anotan los ciclos posteriores a lo
  // ya registrado, haya habido filas nuevas o no. Atarlo a `nuevas > 0` dejó
  // el registro vacío para siempre, porque la tabla ya estaba sembrada cuando
  // la escritura llegó a producción y `nuevas` valía 0 en cada pasada.
  try {
    const desdeTs = Number(await leerMeta(db, CLAVE_EVENTOS)) || 0;
    const pendientes = lista.filter(c => c.ts > desdeTs);
    if (pendientes.length) {
      await registrarEventos(db, pendientes);
      await escribirMeta(db, CLAVE_EVENTOS, Math.max(...pendientes.map(c => c.ts)));
    }
  } catch (e) {
    console.error('no se pudieron registrar los eventos:', e);
  }

  let saldo = null;
  if (!error) {
    try { saldo = await saldoWallet(wallet); } catch { /* dato de adorno, no crítico */ }
  }

  /* El sellado del precio y su recuento. Los dos en su propio `try`: si la
     columna `precio_pls` no estuviera —la migración aparcada la borraba, ver
     `migraciones/001-limpieza.sql`— esto fallaría y se llevaría por delante
     TODAS las ganancias del panel. Que falle esta parte no puede tumbar el
     conjunto (principio P8). */
  let sellados = 0, precios = null;
  try {
    sellados = await sellarPrecios(db, Math.floor(Date.now() / 1000));
    precios = await valorado(db);
  } catch (e) {
    console.error('no se pudo sellar el precio de los barridos:', e);
  }

  const cuerpo = {
    total,
    bloques,
    barridos: lista.length,
    retiradas: lista.reduce((a, c) => a + c.validadores, 0),
    // Cuánto del total viene de proponer bloques. Es la parte de suerte
    // frente al rendimiento base del nodo, y explica que el APR baile.
    pls_bloques: plsBloques,
    peso_bloques: total > 0 ? (plsBloques / total) * 100 : 0,
    por_validador: await porValidador(db),
    // Se publican para que la próxima pasada tenga respaldo si KV falla, y
    // para poder ver desde fuera con qué conjunto se filtró.
    indices: propios ? [...propios].sort((a, b) => a - b) : (cacheGuardada?.indices ?? []),
    // Igual que los índices: respaldo para la próxima pasada si KV falla.
    wallet: wallet ?? cacheGuardada?.wallet ?? null,
    activacion_ts: activacionTs ?? cacheGuardada?.activacion_ts ?? null,
    saldo_wallet: saldo,
    /* Lo que valía al cobrarlo, y sobre cuántos barridos se puede decir. El
       panel NO puede presentar esto como «el valor de lo ganado» a secas: es
       el valor de la parte que tiene precio real. */
    valorado: precios,
    sellados,
    ciclos: lista.slice(-40),
    nuevas,
    sembrando,
    actualizado: Date.now(),
  };

  if (!error && env.PLSDASH_KV) {
    try { await env.PLSDASH_KV.put(CLAVE_CACHE, JSON.stringify(cuerpo)); } catch { /* la caché no es crítica */ }
  }

  return json(error ? { ...cuerpo, obsoleto: true, error } : { ...cuerpo, obsoleto: false });
}
