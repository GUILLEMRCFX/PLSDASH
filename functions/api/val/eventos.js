/**
 * PLSDASH — Validator Dashboard: /api/val/eventos
 *
 * Requiere sesión válida (ver _middleware.js).
 * ?limit= número de eventos a devolver, orden descendente (por defecto 15, máx 100)
 * ?tipos= lista separada por comas para filtrar (ej. `caida,slash`). Se usa
 *         para localizar el último incidente sin arrastrar todo el registro.
 */

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;

// Los tipos que escribe push.py; filtrar contra esta lista evita construir
// SQL con texto arbitrario de la query string.
const TIPOS_VALIDOS = new Set([
  'activacion', 'bloque', 'caida', 'recuperacion', 'reinicio',
  'desync', 'resync', 'slash', 'aviso',
  // `descarte` lo escribe la validación del NUC cuando rechaza una lectura.
  // No es una incidencia de los validadores: es la tubería protegiéndose, y
  // el panel lo usa para distinguir «el NUC está caído» de «el NUC responde
  // pero sus datos no se admiten».
  'descarte',
  // `barrido` lo escribe /api/val/ganancia al detectar una retirada del
  // protocolo. Es el suceso más frecuente del registro y el que faltaba.
  'barrido',
]);

const err = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function onRequestGet({ request, env }) {
  if (!env.VALIDATOR_DB) return err('D1 no configurado (binding VALIDATOR_DB)', 500);

  const url = new URL(request.url);
  let limit = Number(url.searchParams.get('limit') || DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const tipos = (url.searchParams.get('tipos') || '')
    .split(',').map(t => t.trim()).filter(t => TIPOS_VALIDOS.has(t));

  const campos = 'SELECT id, ts, tipo, titulo, detalle, pls, validador FROM eventos';
  const stmt = tipos.length
    ? env.VALIDATOR_DB
        .prepare(`${campos} WHERE tipo IN (${tipos.map(() => '?').join(',')}) ORDER BY ts DESC LIMIT ?`)
        .bind(...tipos, limit)
    : env.VALIDATOR_DB.prepare(`${campos} ORDER BY ts DESC LIMIT ?`).bind(limit);

  const { results } = await stmt.all();

  return new Response(JSON.stringify({ eventos: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
