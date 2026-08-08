/**
 * PLSDASH — Validator Dashboard: /api/val/eventos
 *
 * Requiere sesión válida (ver _middleware.js).
 * ?limit= número de eventos a devolver, orden descendente (por defecto 15, máx 100)
 */

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;

const err = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function onRequestGet({ request, env }) {
  if (!env.PLSDASH_DB) return err('D1 no configurado (binding PLSDASH_DB)', 500);

  const url = new URL(request.url);
  let limit = Number(url.searchParams.get('limit') || DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const { results } = await env.PLSDASH_DB
    .prepare('SELECT id, ts, tipo, titulo, detalle, pls, validador FROM eventos ORDER BY ts DESC LIMIT ?')
    .bind(limit)
    .all();

  return new Response(JSON.stringify({ eventos: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
