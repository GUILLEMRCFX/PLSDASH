-- PLSDASH · migración 002 — sellar el precio de los barridos ya registrados
--
-- Pasada ÚNICA. Rellena `barridos.precio_pls` en las filas que lo tienen vacío,
-- con el precio que `snapshots` registró en la misma hora (±90 min).
--
-- ── POR QUÉ ESTO NO ES INVENTARSE UN PRECIO ──────────────────────────────────
--
-- Durante semanas se dio por hecho que los barridos antiguos se quedaban sin
-- precio para siempre, porque el precio de una hora pasada no lo sirve ninguna
-- API. Es cierto para las APIs — y falso para nosotros: `snapshots.precio_pls`
-- lleva 843 lecturas reales guardadas desde el 16-ago-2026, hechas por este
-- mismo proyecto en el momento.
--
-- Así que esto no reconstruye nada ni estima nada: empareja cada barrido con
-- una lectura que YA ESTABA en la base, y solo si cae a menos de 90 minutos.
-- Los que no tengan ninguna cerca se quedan vacíos, que es lo correcto.
--
-- Medido contra producción antes de ejecutar (21-sep-2026):
--
--     barridos totales ................ 1.434
--     con precio ...................... 0
--     que se pueden sellar ............ 1.154  (80,5 %)
--     que no, por ser anteriores al
--     primer snapshot con precio ......   280
--
--   1.434 − 1.154 = 280, y coincide exactamente con los anteriores al
--   16-ago: no se pierde ninguno por otro motivo.
--
-- ── SEGURIDAD ────────────────────────────────────────────────────────────────
--
-- · IDEMPOTENTE. Solo toca `precio_pls IS NULL`, así que ejecutarla dos veces
--   no reescribe nada. Comprobado: la segunda pasada da 0 cambios.
-- · NO BORRA NADA. Ni columnas ni filas.
-- · Se puede ejecutar antes o después de desplegar: no depende del código.
--
--     npx wrangler d1 execute validator-dashboard --remote \
--       --file=migraciones/002-sellar-precio-pasado.sql
--
-- ── ⚠ POR QUÉ ESTÁ ESCRITA ASÍ Y NO CON «EL MÁS CERCANO» ─────────────────────
--
-- La forma natural sería `ORDER BY ABS(s.ts - b.ts) LIMIT 1`. **SQLite no lo
-- admite**: una subconsulta puede usar una columna de la consulta de fuera en
-- su `WHERE`, pero NO en su `ORDER BY`. Da «no such column: b.ts».
--
-- Por eso se buscan por separado el snapshot anterior y el posterior —cada uno
-- ordenando por su propia columna, que sí vale— y se elige entre los dos con un
-- CASE. El empate lo gana el anterior, igual que `precioMasCercano()` en
-- `functions/api/val/ganancia.js`. Hay una prueba que ejecuta ESTE fichero y
-- exige que dé exactamente lo mismo que esa función.

WITH cerca AS (
  SELECT b.indice_retirada AS id, b.ts AS bts,
    (SELECT s.precio_pls FROM snapshots s
      WHERE s.precio_pls IS NOT NULL AND s.ts <= b.ts AND s.ts >= b.ts - 5400
      ORDER BY s.ts DESC LIMIT 1) AS p_ant,
    (SELECT s.ts FROM snapshots s
      WHERE s.precio_pls IS NOT NULL AND s.ts <= b.ts AND s.ts >= b.ts - 5400
      ORDER BY s.ts DESC LIMIT 1) AS t_ant,
    (SELECT s.precio_pls FROM snapshots s
      WHERE s.precio_pls IS NOT NULL AND s.ts > b.ts AND s.ts <= b.ts + 5400
      ORDER BY s.ts ASC LIMIT 1) AS p_pos,
    (SELECT s.ts FROM snapshots s
      WHERE s.precio_pls IS NOT NULL AND s.ts > b.ts AND s.ts <= b.ts + 5400
      ORDER BY s.ts ASC LIMIT 1) AS t_pos
  FROM barridos b WHERE b.precio_pls IS NULL
),
elegido AS (
  SELECT id, CASE
    WHEN p_ant IS NULL THEN p_pos
    WHEN p_pos IS NULL THEN p_ant
    WHEN (bts - t_ant) <= (t_pos - bts) THEN p_ant
    ELSE p_pos END AS p
  FROM cerca
)
UPDATE barridos SET precio_pls = (SELECT p FROM elegido WHERE elegido.id = barridos.indice_retirada)
 WHERE precio_pls IS NULL
   AND (SELECT p FROM elegido WHERE elegido.id = barridos.indice_retirada) IS NOT NULL;
