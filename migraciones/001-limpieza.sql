-- PLSDASH · migración 001 — quitar de D1 lo que nadie escribe o nadie lee
--
-- ⚠ ORDEN OBLIGATORIO. Esta migración borra columnas que el código DESPLEGADO
--   nombra hoy. Ejecutarla antes de desplegar deja la web rota:
--
--     1. Fusiona el PR y espera a que Cloudflare Pages termine el despliegue.
--     2. Comprueba que /val/ carga y que las ganancias salen.
--     3. Solo entonces, ejecuta este fichero.
--     4. Actualiza el NUC (ver `nuc/PASOS.md`) — `push.py` también cambia.
--
--   Si se ejecuta al revés, `/api/val/ganancia` da 500 (nombra `precio_pls`)
--   y el cierre diario del NUC falla en silencio (nombra `apr_medio`).
--
-- Cada borrado, con la razón y la cuenta que lo justifica, medidas el 23-ago-2026.

-- ── snapshots ────────────────────────────────────────────────────────────────
-- 0 de 355 filas escritas. Nadie las nombra: ni `push.py` ni ninguna Function.
ALTER TABLE snapshots DROP COLUMN barrido_acum;
ALTER TABLE snapshots DROP COLUMN ganado_real;

-- ── barridos ─────────────────────────────────────────────────────────────────
-- 0 de 484 filas. `functions/api/val/ganancia.js` SÍ la nombraba, insertando
-- NULL a propósito; ese INSERT se corrige en el mismo PR.
-- Consecuencia asumida: valorar cada barrido al precio de su día deja de ser
-- posible para los 484 barridos ya registrados. No hay forma de recuperarlo.
ALTER TABLE barridos DROP COLUMN precio_pls;

-- ── daily ────────────────────────────────────────────────────────────────────
-- Suma 0 en las 15 filas. Los bloques de verdad están marcados uno a uno en
-- `barridos.es_bloque`, que es de donde los lee el panel.
ALTER TABLE daily DROP COLUMN bloques;

-- Escrita hasta el 19-ago y NULL desde entonces, y sus valores (0,056 … 1,484)
-- no son un APR de nada: el real está en el 9,5 %. No la leía ningún panel.
ALTER TABLE daily DROP COLUMN apr_medio;

-- ⚠ `daily.minutos_caido` NO se toca, aunque también sumaba 0.
--   Estaba en la lista de columnas muertas, pero el mismo trabajo que la
--   borraría la resucita: `push.py` ya la mide contra Prometheus. Borrarla y
--   volverla a crear sería trabajo para acabar donde estamos.

-- ── validador_diario ─────────────────────────────────────────────────────────
-- 165 filas que solo leía `/api/val/validadores`, un endpoint que no llamaba
-- nadie. Los dos se retiran; `push.py` deja de escribirla.
-- El detalle por validador sigue vivo en el estado de KV, que es lo que pintan
-- los paneles.
DROP TABLE IF EXISTS validador_diario;
