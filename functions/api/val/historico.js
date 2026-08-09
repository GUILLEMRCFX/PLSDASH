/**
 * PLSDASH — Validator Dashboard: /api/val/historico
 *
 * Requiere sesión válida (ver _middleware.js).
 * ?rango= 24h | 7d | 30d | todo | serie
 *   24h   → `snapshots` (resolución horaria), últimas 24h
 *   7d    → `daily` (resolución diaria), últimos 7 días
 *   30d   → `daily`, últimos 30 días
 *   todo  → `daily` completo
 *   serie → toda la serie de `snapshots`, solo ts y ganado
 *
 * `serie` existe para reconstruir la ganancia acumulada. `ganado` es el
 * excedente sin barrer, y el protocolo lo retira cada ~9 h dejándolo a cero,
 * así que la ganancia real solo se puede recomponer recorriendo la serie
 * entera y sumando lo que se llevó cada barrido. Se devuelven dos columnas
 * para que crezca despacio: unas 8.800 filas al año.
 */

const RANGOS = new Set(['24h', '7d', '30d', 'todo', 'serie']);

const err = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function onRequestGet({ request, env }) {
  if (!env.VALIDATOR_DB) return err('D1 no configurado (binding VALIDATOR_DB)', 500);

  const url = new URL(request.url);
  const rango = url.searchParams.get('rango') || '24h';
  if (!RANGOS.has(rango)) return err('rango inválido (24h | 7d | 30d | todo | serie)', 400);

  let stmt;
  if (rango === 'serie') {
    stmt = env.VALIDATOR_DB.prepare(
      'SELECT ts, ganado FROM snapshots WHERE ganado IS NOT NULL ORDER BY ts ASC'
    );
  } else if (rango === '24h') {
    const desde = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    stmt = env.VALIDATOR_DB.prepare('SELECT * FROM snapshots WHERE ts >= ? ORDER BY ts ASC').bind(desde);
  } else if (rango === 'todo') {
    stmt = env.VALIDATOR_DB.prepare('SELECT * FROM daily ORDER BY fecha ASC');
  } else {
    const dias = rango === '7d' ? 7 : 30;
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    stmt = env.VALIDATOR_DB.prepare('SELECT * FROM daily WHERE fecha >= ? ORDER BY fecha ASC').bind(desde);
  }

  const { results } = await stmt.all();
  return new Response(JSON.stringify({ rango, datos: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
