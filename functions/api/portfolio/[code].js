/**
 * PLSDASH — Pages Function: portfolio en Cloudflare KV.
 *
 * Rutas (carpeta /functions): /api/portfolio/<code>
 *   GET  → devuelve la config guardada del portfolio (404 si no existe).
 *   PUT  → guarda { wallets, customTokens, hidden, ... } como JSON.
 *
 * Requiere un binding de KV llamado PLSDASH_KV (ver README).
 *
 * Modelo "código de portfolio" (sin login): el code de la URL es la
 * llave de acceso y de sincronización entre dispositivos. Quien tiene
 * el código puede leer y escribir ese portfolio.
 */

const KEY = code => `portfolio:${code}`;
const MAX_BYTES = 100 * 1024;            // límite de 100KB por portfolio
const CODE_RE = /^[A-Za-z0-9_-]{3,32}$/; // mismo formato que el frontend

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json', ...CORS } });

const err = (msg, status) => json(JSON.stringify({ error: msg }), status);

// Preflight CORS.
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ params, env }) {
  if (!env.PLSDASH_KV) return err('KV no configurado (binding PLSDASH_KV)', 500);
  if (!CODE_RE.test(params.code)) return err('Código inválido', 400);

  const data = await env.PLSDASH_KV.get(KEY(params.code));
  if (data === null) {
    // 404 = libre. El frontend lo usa para comprobar disponibilidad.
    return json('null', 404);
  }
  return json(data);
}

export async function onRequestPut({ params, request, env }) {
  if (!env.PLSDASH_KV) return err('KV no configurado (binding PLSDASH_KV)', 500);
  if (!CODE_RE.test(params.code)) return err('Código inválido', 400);

  const body = await request.text();

  // Validación de tamaño.
  if (body.length > MAX_BYTES) return err('Portfolio demasiado grande (máx 100KB)', 413);

  // Validación de forma: JSON parseable con la estructura esperada.
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return err('El cuerpo debe ser JSON válido', 400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err('Estructura de portfolio no válida', 400);
  }
  if (parsed.wallets && !Array.isArray(parsed.wallets)) {
    return err('"wallets" debe ser una lista', 400);
  }
  if (parsed.customTokens && !Array.isArray(parsed.customTokens)) {
    return err('"customTokens" debe ser una lista', 400);
  }

  await env.PLSDASH_KV.put(KEY(params.code), body);
  return json('{"ok":true}');
}
