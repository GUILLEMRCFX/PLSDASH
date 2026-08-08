/**
 * PLSDASH — Validator Dashboard: /api/val/logout
 *
 * Borra la cookie de sesión. La cookie es httpOnly, así que el frontend
 * no puede borrarla por sí mismo con document.cookie.
 */

import { clearSessionCookie } from './_lib/session.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': clearSessionCookie() },
  });
}
