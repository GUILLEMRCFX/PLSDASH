/**
 * Una D1 de mentira, en memoria, que entiende exactamente el SQL que usa
 * `functions/api/inversiones.js` y nada más.
 *
 * ⚠ Es a propósito que NO sea un SQL de verdad. Un motor completo aceptaría
 *   consultas que D1 no acepta y la prueba dejaría pasar código roto en
 *   producción. Aquí, una consulta que no esté contemplada REVIENTA con su
 *   texto delante: si alguien añade SQL nuevo a la Function, se entera al
 *   momento en vez de ver una tabla vacía y no saber por qué.
 */

function coincide(sql, trozo) {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase().includes(trozo.toUpperCase());
}

function crear() {
  // wallet|tx → fila,  clave → valor
  const inversiones = new Map();
  const meta = new Map();

  const preparada = sql => {
    const limpio = sql.replace(/\s+/g, ' ').trim();
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },

      async run() {
        if (coincide(limpio, 'CREATE TABLE') || coincide(limpio, 'CREATE INDEX')) return { success: true };
        if (coincide(limpio, 'INSERT INTO META')) {
          meta.set(args[0], String(args[1]));
          return { success: true };
        }
        if (coincide(limpio, 'INSERT INTO INVERSIONES')) { api._guardar(); return { success: true }; }
        throw new Error('D1 falsa: run() no contemplado → ' + limpio);
      },

      async first() {
        if (coincide(limpio, 'SELECT VALOR FROM META')) {
          const v = meta.get(args[0]);
          return v == null ? null : { valor: v };
        }
        throw new Error('D1 falsa: first() no contemplado → ' + limpio);
      },

      async all() {
        if (coincide(limpio, 'SELECT * FROM INVERSIONES')) {
          /* `WHERE wallet IN (?,…) AND ts >= ?` — las wallets son todos los
             argumentos menos el último, que es el suelo de fecha. */
          const suelo = args[args.length - 1];
          const quienes = new Set(args.slice(0, -1));
          const results = [...inversiones.values()]
            .filter(f => quienes.has(f.wallet) && f.ts >= suelo)
            .sort((a, b) => b.ts - a.ts);
          return { results };
        }
        throw new Error('D1 falsa: all() no contemplado → ' + limpio);
      },

      // Lo usa `batch`: una sentencia preparada guarda su propia fila.
      _guardar() {
        const [wallet, tx, ts, clase, motivo, entra, sale, usd, gasto_usd, moneda] = args;
        inversiones.set(wallet + '|' + tx,
          { wallet, tx, ts, clase, motivo, entra, sale, usd, gasto_usd, moneda });
      },
      _sql: limpio,
    };
    return api;
  };

  return {
    prepare: preparada,
    async batch(sentencias) {
      for (const s of sentencias) {
        if (coincide(s._sql, 'INSERT INTO INVERSIONES')) s._guardar();
        else throw new Error('D1 falsa: batch() no contemplado → ' + s._sql);
      }
      return sentencias.map(() => ({ success: true }));
    },
    // Para mirar por dentro desde la prueba.
    _inversiones: inversiones,
    _meta: meta,
  };
}

module.exports = { crear };
