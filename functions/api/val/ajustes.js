/**
 * PLSDASH — Validator Dashboard: /api/val/ajustes
 *
 * Requiere sesión válida (ver `_middleware.js`).
 *
 *   GET  → todos los ajustes, como un objeto plano.
 *   PUT  → { clave: valor, … } guarda los que vengan. Los que no vengan no se
 *          tocan: así el panel puede escribir uno sin conocer los demás.
 *
 * ## Qué es esto y por qué existe
 *
 * Números que solo sabe el dueño del panel y que NO se pueden deducir de
 * ninguna fuente. Hoy hay uno:
 *
 *   `precio_entrada`  el precio de PLS al que se entró — el «sacrificio».
 *
 * En el v1 ese número está así:
 *
 *     const PRECIO_SACRIFICIO = 0.0001;   // escrito en el código
 *
 * Y es el mismo vicio que `const V11 = 32_000_000`: un dato personal escrito a
 * fuego en un fichero que hay que desplegar para cambiar. Peor todavía, porque
 * el depósito al menos es un parámetro público del protocolo y este no: es un
 * hecho de una persona, y esa persona es la única que lo sabe.
 *
 * ## Por qué en D1 y no en `localStorage`
 *
 * El tema y la posición del deslizador viven en `localStorage` porque son
 * preferencias del aparato: que el móvil vaya en «Papel» y el escritorio en
 * «Núcleo» es una ventaja. El precio de entrada NO es eso. Es un dato, es el
 * mismo desde cualquier pantalla, y si se guardara en el navegador se perdería
 * al limpiar el almacenamiento — y con él, la única referencia para saber si lo
 * invertido va por encima o por debajo.
 *
 * ## Clave/valor y no una columna por ajuste
 *
 * Para que añadir el segundo ajuste no exija tocar la base. La tabla se crea
 * sola, igual que `aportaciones`, y por el mismo motivo: la migración de
 * limpieza está aparcada y una función nueva no debe depender de que alguien
 * ejecute nada a mano.
 */

const json = (cuerpo, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status, headers: { 'content-type': 'application/json' },
  });

const err = (msg, status) => json({ error: msg }, status);

/**
 * Los ajustes que se aceptan, con su validación.
 *
 * ⚠ Lista CERRADA a propósito. Sin ella, un PUT podría escribir cualquier clave
 *   y la tabla se llenaría de basura que nadie lee — y el panel acabaría
 *   dependiendo de que el cliente mande solo lo correcto, que es confiar en el
 *   lado equivocado.
 */
const AJUSTES = {
  /* El precio al que se entró. El rango es amplio a propósito: PLS ha cotizado
     entre 1e-5 y 1e-3, y encajarlo más sería adivinar el futuro. Lo que sí se
     rechaza es el cero y lo negativo, que no son precios. */
  precio_entrada: {
    valida: v => Number.isFinite(v) && v > 0 && v < 1,
    porque: 'tiene que ser un precio en dólares mayor que cero y menor que 1',
  },
};

async function asegurarTabla(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ajustes (
      clave      TEXT PRIMARY KEY,
      valor      REAL NOT NULL,
      actualizado INTEGER NOT NULL
    )`).run();
}

export async function onRequestGet({ env }) {
  if (!env.VALIDATOR_DB) return err('D1 no configurado (binding VALIDATOR_DB)', 500);
  await asegurarTabla(env.VALIDATOR_DB);

  const { results } = await env.VALIDATOR_DB
    .prepare('SELECT clave, valor, actualizado FROM ajustes').all();

  const out = {};
  for (const f of results || []) {
    // Una clave que ya no se acepta se ignora en vez de devolverse: si un día
    // se retira un ajuste, el panel no debe seguir viéndolo.
    if (AJUSTES[f.clave]) out[f.clave] = { valor: Number(f.valor), actualizado: Number(f.actualizado) };
  }
  return json({ ajustes: out });
}

export async function onRequestPut({ request, env }) {
  if (!env.VALIDATOR_DB) return err('D1 no configurado (binding VALIDATOR_DB)', 500);

  let cuerpo;
  try { cuerpo = await request.json(); } catch { return err('JSON inválido', 400); }
  if (!cuerpo || typeof cuerpo !== 'object') return err('Se esperaba un objeto', 400);

  const entradas = Object.entries(cuerpo);
  if (!entradas.length) return err('Nada que guardar', 400);

  for (const [clave, valor] of entradas) {
    const def = AJUSTES[clave];
    if (!def) return err(`Ajuste desconocido: ${clave}`, 400);
    if (!def.valida(Number(valor))) return err(`\`${clave}\` ${def.porque}`, 400);
  }

  await asegurarTabla(env.VALIDATOR_DB);
  const ahora = Math.floor(Date.now() / 1000);

  /* `ON CONFLICT` y no un DELETE + INSERT: escribir un ajuste no debe poder
     dejar la fila borrada si la segunda mitad falla. */
  const lote = entradas.map(([clave, valor]) => env.VALIDATOR_DB
    .prepare(`INSERT INTO ajustes (clave, valor, actualizado) VALUES (?, ?, ?)
              ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor,
                                               actualizado = excluded.actualizado`)
    .bind(clave, Number(valor), ahora));
  await env.VALIDATOR_DB.batch(lote);

  return json({ ok: true, guardados: entradas.map(([k]) => k), actualizado: ahora });
}
