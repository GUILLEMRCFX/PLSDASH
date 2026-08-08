/**
 * PLSDASH — Validator Dashboard: /api/val/estado
 *
 * Requiere sesión válida (ver _middleware.js). Devuelve tal cual el JSON
 * que push.py escribe en KV bajo la clave `validator:estado`.
 *
 * La frescura de los datos (campo `generado_ts`) la evalúa el frontend,
 * no esta Function: `salud` puede quedarse congelado en "ok" si el
 * collector deja de correr, así que el frontend debe comparar
 * `generado_ts` contra la hora actual para detectar datos obsoletos.
 */

const KEY = 'validator:estado';

const err = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function onRequestGet({ env }) {
  if (!env.PLSDASH_KV) return err('KV no configurado (binding PLSDASH_KV)', 500);

  const data = await env.PLSDASH_KV.get(KEY);
  if (data === null) return err('Sin datos todavía', 404);

  return new Response(data, { status: 200, headers: { 'content-type': 'application/json' } });
}
