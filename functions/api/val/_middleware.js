/**
 * PLSDASH — Validator Dashboard: guardia de sesión para /api/val/*
 *
 * Verifica la cookie de sesión firmada antes de dejar pasar a cualquier
 * endpoint de esta carpeta, excepto /api/val/auth (que es como se consigue
 * la sesión). Si no hay sesión válida, corta aquí: los datos nunca llegan
 * a ejecutar la Function real.
 */

import { verifySession } from './_lib/session.js';

const err = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function onRequest({ request, env, next }) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/val/auth') return next();

  if (!env.VAL_SESSION_SECRET) return err('Servidor no configurado', 500);

  const valid = await verifySession(request, env.VAL_SESSION_SECRET);
  if (!valid) return err('Sesión no válida', 401);

  return next();
}
