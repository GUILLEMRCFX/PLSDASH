/**
 * PLSDASH — Validator Dashboard: /api/val/validadores
 *
 * Requiere sesión válida (ver _middleware.js).
 * Histórico por validador (tabla `validador_diario`), que es lo que permite
 * comparar la efectividad de hoy contra la media histórica propia en vez de
 * contra la red — el brief descartó explícitamente la comparativa con la red.
 *
 * Devuelve:
 *   por_dia        → un registro por fecha con la media y el máximo del grupo.
 *                    efectividad del día = media / máximo.
 *   por_validador  → acumulado de cada validador sobre todo el periodo.
 */

const err = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function onRequestGet({ env }) {
  if (!env.VALIDATOR_DB) return err('D1 no configurado (binding VALIDATOR_DB)', 500);

  const porDia = env.VALIDATOR_DB.prepare(`
    SELECT fecha,
           AVG(ganado) AS media,
           MAX(ganado) AS maximo,
           MIN(ganado) AS minimo,
           COUNT(*)    AS n
    FROM validador_diario
    GROUP BY fecha
    ORDER BY fecha ASC
  `);

  const porValidador = env.VALIDATOR_DB.prepare(`
    SELECT indice,
           COUNT(*)    AS dias,
           AVG(ganado) AS ganado_medio,
           MAX(fecha)  AS ultima_fecha
    FROM validador_diario
    GROUP BY indice
    ORDER BY indice ASC
  `);

  const [dia, val] = await env.VALIDATOR_DB.batch([porDia, porValidador]);

  return new Response(JSON.stringify({
    por_dia: dia.results || [],
    por_validador: val.results || [],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}
