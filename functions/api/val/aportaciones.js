/**
 * PLSDASH — Validator Dashboard: /api/val/aportaciones
 *
 * Requiere sesión válida (ver `_middleware.js`).
 *
 *   GET     → el histórico, de más nueva a más vieja.
 *   POST    → apunta una: { ts, pls } — el precio lo pone el servidor.
 *   DELETE  → ?id=N borra una. Un registro escrito a mano necesita poder
 *             corregirse; sin esto, un cero de más se queda para siempre.
 *
 * ## Por qué esto es manual y no se lee de la cadena
 *
 * Lo suyo sería sacarlo de las transferencias entrantes de la wallet. Eso
 * es exactamente lo que hay aparcado en el bloque 7: leer movimientos exige
 * recorrer el explorador y emparejar entradas con salidas, y todavía no está
 * resuelto. Apuntarlo a mano funciona hoy y además es EXACTO, porque quien
 * manda el PLS sabe cuánto manda.
 *
 * ## Por qué se guarda el precio al apuntar, y no se calcula después
 *
 * Misma lección que `barridos.precio_pls`, que se quedó a NULL en 484 filas y
 * ya no se puede recuperar: **el precio de un día pasado no se puede
 * reconstruir**. No hay serie histórica por token en ninguna parte del
 * proyecto. Si no se guarda cuando pasa, se pierde.
 *
 * Lo pone el SERVIDOR pidiéndoselo a `/api/precio`, no el cliente: así queda
 * el precio del instante en que se registró y no el que llevara cargado una
 * pestaña abierta desde ayer.
 *
 * ⚠ Si en ese momento no hay precio, se guarda NULL y se dice. Un precio
 *   inventado sería peor que ninguno: la fila en dólares es un hecho o no es
 *   nada.
 */

const json = (cuerpo, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status, headers: { 'content-type': 'application/json' },
  });

const err = (msg, status) => json({ error: msg }, status);

/**
 * La tabla se crea sola la primera vez.
 *
 * A propósito, y no por pereza: la migración de limpieza está aparcada y no
 * quiero que una función nueva dependa de que alguien ejecute nada a mano. Un
 * `CREATE TABLE IF NOT EXISTS` es aditivo, no toca ninguna tabla existente y
 * cuesta una consulta trivial por llamada.
 */
async function asegurarTabla(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS aportaciones (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         INTEGER NOT NULL,
      pls        REAL    NOT NULL,
      precio_pls REAL,
      creado     INTEGER NOT NULL
    )`).run();
}

/** El precio de ahora, o null. Nunca lanza: sin precio se apunta igual. */
async function precioAhora(request) {
  try {
    const r = await fetch(new URL('/api/precio', request.url).toString(), {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return null;
    const p = await r.json();
    // `disponible: false` es la forma que tiene ese endpoint de decir «hoy no
    // lo sé». Un precio obsoleto sí vale: es el último real que hubo.
    if (p?.disponible === false) return null;
    const v = Number(p?.precio);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function onRequestGet({ env }) {
  if (!env.VALIDATOR_DB) return err('D1 no configurado (binding VALIDATOR_DB)', 500);
  await asegurarTabla(env.VALIDATOR_DB);

  const { results } = await env.VALIDATOR_DB
    .prepare('SELECT id, ts, pls, precio_pls FROM aportaciones ORDER BY ts DESC, id DESC')
    .all();

  const filas = results || [];
  return json({
    aportaciones: filas,
    // Se suma aquí y no en el panel: es la misma cuenta para todos los
    // consumidores y así no puede discrepar entre dos sitios.
    total_pls: filas.reduce((a, f) => a + (Number(f.pls) || 0), 0),
    // Lo aportado valorado al precio de CADA día, que es lo que de verdad
    // costó. Las filas sin precio no suman: ver el aviso de arriba.
    total_usd: filas.reduce(
      (a, f) => a + (Number(f.precio_pls) > 0 ? Number(f.pls) * Number(f.precio_pls) : 0), 0),
    sin_precio: filas.filter(f => f.precio_pls == null).length,
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.VALIDATOR_DB) return err('D1 no configurado (binding VALIDATOR_DB)', 500);

  let cuerpo;
  try { cuerpo = await request.json(); } catch { return err('JSON inválido', 400); }

  const pls = Number(cuerpo?.pls);
  if (!Number.isFinite(pls) || pls <= 0) return err('`pls` tiene que ser un número mayor que cero', 400);
  // Techo de cordura: 32M es un depósito entero. Diez veces eso es un dedo
  // que se ha quedado pegado al cero, no una aportación.
  if (pls > 320_000_000) return err('`pls` fuera de rango (máx 320.000.000)', 400);

  const ts = Number(cuerpo?.ts);
  const ahora = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || ts <= 0) return err('`ts` tiene que ser un unix ts en segundos', 400);
  // Del futuro no se aporta. Se deja un día de margen por husos horarios.
  if (ts > ahora + 86400) return err('`ts` está en el futuro', 400);

  await asegurarTabla(env.VALIDATOR_DB);

  /* ⚠ El precio que se guarda es el de AHORA, no el del día de `ts`. Si se
     apunta con retraso una aportación de hace una semana, la valoración será
     la de hoy y no la de aquel día. No hay forma de hacerlo mejor: no existe
     serie histórica de precio por día en ninguna parte del proyecto —esa es
     justamente la lección de `barridos.precio_pls`—. Se marca la fila para que
     el panel pueda decirlo en vez de fingir precisión. */
  const precio = await precioAhora(request);
  const desfasada = ahora - ts > 86400;

  const r = await env.VALIDATOR_DB.prepare(
    'INSERT INTO aportaciones (ts, pls, precio_pls, creado) VALUES (?, ?, ?, ?)')
    .bind(ts, pls, desfasada ? null : precio, ahora).run();

  return json({
    ok: true,
    id: r.meta?.last_row_id ?? null,
    precio_pls: desfasada ? null : precio,
    // Para que el panel pueda explicar por qué esa fila no lleva dólares.
    motivo_sin_precio: desfasada ? 'fecha_pasada' : (precio == null ? 'sin_precio' : null),
  }, 201);
}

export async function onRequestDelete({ request, env }) {
  if (!env.VALIDATOR_DB) return err('D1 no configurado (binding VALIDATOR_DB)', 500);

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return err('`id` inválido', 400);

  await asegurarTabla(env.VALIDATOR_DB);
  const r = await env.VALIDATOR_DB.prepare('DELETE FROM aportaciones WHERE id = ?').bind(id).run();
  if (!r.meta?.changes) return err('No existe esa aportación', 404);
  return json({ ok: true, id });
}
