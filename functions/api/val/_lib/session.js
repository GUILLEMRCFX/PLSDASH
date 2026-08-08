/**
 * PLSDASH — Validator Dashboard: sesión firmada con HMAC-SHA256.
 *
 * La cookie `val_session` guarda `<expiración>.<firma>`. La firma se
 * calcula con VAL_SESSION_SECRET (secret de Cloudflare, nunca en el repo).
 * Verificarla solo confirma que el servidor la emitió y que no ha caducado;
 * no lleva más datos porque no hacen falta.
 */

const COOKIE_NAME = 'val_session';
const SESSION_DAYS = 30;
const encoder = new TextEncoder();

function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function createSessionCookie(secret) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = String(exp);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const token = `${payload}.${base64url(sig)}`;
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export async function verifySession(request, secret) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const dot = match[1].lastIndexOf('.');
  if (dot === -1) return false;
  const payload = match[1].slice(0, dot);
  const sigB64 = match[1].slice(dot + 1);

  const exp = Number(payload);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;

  try {
    const key = await hmacKey(secret);
    const sig = base64urlToBytes(sigB64);
    return await crypto.subtle.verify('HMAC', key, sig, encoder.encode(payload));
  } catch {
    return false;
  }
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
