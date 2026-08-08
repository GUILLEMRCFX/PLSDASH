/**
 * PLSDASH — Validator Dashboard: /api/val/auth
 *
 * POST { pin } → compara contra VAL_PIN (secret de Cloudflare).
 * Si es correcto, emite cookie de sesión firmada (30 días).
 * Si es incorrecto, no sale ningún dato — solo un 401 genérico.
 *
 * Sin bloqueo por intentos fallidos (decisión explícita del propietario:
 * el subdominio no está enlazado en ningún sitio y el panel es solo lectura).
 */

import { createSessionCookie } from './_lib/session.js';

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.VAL_PIN || !env.VAL_SESSION_SECRET) {
    return json({ error: 'Servidor no configurado' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const pin = String(body?.pin ?? '');
  if (!timingSafeEqual(pin, String(env.VAL_PIN))) {
    return json({ error: 'PIN incorrecto' }, 401);
  }

  const cookie = await createSessionCookie(env.VAL_SESSION_SECRET);
  return json({ ok: true }, 200, { 'set-cookie': cookie });
}
