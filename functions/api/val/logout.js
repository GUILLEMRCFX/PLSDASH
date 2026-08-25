/**
 * PLSDASH — Validator Dashboard: /api/val/logout
 *
 * ⚠ NO ESTÁ MUERTO. Se borró el 23-ago dándolo por tal y hubo que restaurarlo:
 *   lo llama el botón «salir» del v1 con `fetch(API + '/logout')`, así que el
 *   literal completo no aparece en el código y un grep no lo ve.
 *
 *   Y su fallo era INVISIBLE: la llamada va dentro de un `try/catch`, así que
 *   sin el endpoint el botón seguía navegando a «/» como siempre — pero la
 *   cookie no se borraba. Parecía que cerrabas sesión y no la cerrabas.
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
