/**
 * PLSDASH — lógica de ganancias, compartida entre `/val/` y `/val/v2/`.
 *
 * Estas funciones estaban dentro del IIFE de `val/index.html` y costaron tres
 * rondas de afinado. Viven aquí para que los dos paneles den la misma cifra:
 * duplicarlas garantizaría que dentro de dos meses discrepen y no se sepa cuál
 * creer.
 *
 * Son puras: reciben los datos por parámetro y no leen nada del entorno. Lo
 * que antes eran variables del módulo (`estado`, `ganancia`, `serie`,
 * `snapshots24h`) ahora entra por la firma.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE HAY QUE ENTENDER ANTES DE TOCAR NADA
 *
 * `snapshots.ganado` (= balance − stake) NO es lo ganado. Es solo el excedente
 * que todavía no se ha retirado: cada ~8,1 h el protocolo barre ese excedente
 * a la wallet de retirada y el contador vuelve a cero. Verificado dos veces el
 * 8 y 9 de ago: el balance vuelve a 320.000.000 exactos y la acumulación sigue
 * después al mismo ritmo.
 *
 * Por eso una bajada NO es un dato corrupto y NO se filtra. Aquí vivió un
 * filtro de monotonía, escrito cuando los barridos se tomaban por corrupción,
 * que descartaba cada lectura posterior a un barrido y hundía el ritmo.
 *
 * ⚠ TRAMPA — `snapshots.pls_hora` NO es lo generado esa hora.
 *
 *   Es `ganado / horas_activo`: la media acumulada desde la activación. Y
 *   como `ganado` se reinicia con cada barrido, además arrastra ese sesgo.
 *   Medido con datos reales del 16-ago-2026:
 *
 *     hora    ganado      pls_hora   delta real
 *     15:00    5.283,03      23,88     2.910,82
 *     16:00    8.436,36      37,96     3.153,33
 *     17:00   17.095,37      76,58     8.659,01
 *     18:00   20.002,20      89,20     2.906,83
 *
 *   `ganado / pls_hora` da 221,2 → 222,2 → 223,2 → 224,2: sube exactamente 1
 *   por hora, que son las horas activas. Usar esa columna como «generado esta
 *   hora» enseñaría 89 PLS donde la realidad son 2.907 — y 89 es lo bastante
 *   plausible como para que nadie lo notara.
 *
 *   Para eso está `ultimaHora()`, que mide el tramo de verdad.
 *
 * ⚠ TRAMPA — el `apr` y el `pls_hora` del recolector tenían LA MISMA raíz.
 *
 *   Hasta el 18-ago-2026 el recolector publicaba:
 *
 *       pls_hora = ganado_total / horas_activo
 *       apr      = pls_hora × 24 × 365 / stake_total × 100
 *
 *   Mal por los dos lados de la división:
 *
 *   · El NUMERADOR es el excedente sin barrer, que vuelve a cero cada ~8,1 h.
 *     Eso da un diente de sierra, no una rentabilidad. Medido en D1 en seis
 *     horas seguidas: 0,217 → 0 → 0,029 → 0,061 → 0,09 → 0,119. El cero es el
 *     instante justo después del barrido.
 *   · El DENOMINADOR eran las horas desde la activación MÁS ANTIGUA del grupo.
 *     Daba igual mientras todos entraran juntos; en cuanto uno lleva once días
 *     y otro unas horas, la media queda diluida.
 *
 *   Por eso el recolector ya no los publica (van a `null`) y el APR se calcula
 *   aquí con `aprValidadorHora()`, ponderando por validador-hora.
 *
 * ⚠ TRAMPA — `daily.ganado_dia` tampoco sirve.
 *
 *   Guarda el excedente que había a medianoche, no lo ganado en la jornada.
 *   Para el 15-ago-2026 anota 0 cuando el día real fueron 68.253 PLS. Por eso
 *   `diarioReal()` recompone los días desde la serie en vez de leer esa
 *   columna.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Lo ganado entre dos lecturas consecutivas del excedente.
 *
 * Si bajó es que hubo barrido, y lo ganado en ese tramo es lo que se haya
 * acumulado después de él. Queda algo por debajo de la verdad —se pierde el
 * trozo entre el último snapshot y el instante del barrido— nunca por encima.
 */
export function ganadoEntre(anterior, actual) {
  const a = Number(anterior), c = Number(actual);
  if (!Number.isFinite(a) || !Number.isFinite(c)) return 0;
  return c >= a ? c - a : c;
}

/**
 * Ganancia real acumulada: lo barrido a la wallet más lo que aún no se ha
 * barrido.
 *
 * @param {object}   estado        El JSON de /api/val/estado.
 * @param {object?}  ganancia      El JSON de /api/val/ganancia (puede faltar).
 * @param {Array}    serie         [{ts, ganado}] de /api/val/historico?rango=serie.
 * @param {number}   activacionTs  Unix ts de la activación de los validadores.
 * @returns {object|null} null si no hay con qué calcularlo.
 */
export function gananciaAcumulada({ estado, ganancia, serie = [], activacionTs }) {
  const excedente = estado?.validadores?.ganado_total ?? 0;

  // La cadena es la fuente buena: recoge también lo barrido antes de que el
  // recolector arrancara, que la serie de snapshots no puede ver.
  if (ganancia && ganancia.total > 0) {
    return {
      total: ganancia.total + excedente,
      barrido: ganancia.total,
      barridos: ganancia.barridos,
      bloques: ganancia.bloques,
      excedente,
      fuente: ganancia.obsoleto ? 'cadena (dato en caché)' : 'cadena',
      completo: true,
    };
  }

  // Sin explorador se recompone de los snapshots: cada bajada es un barrido y
  // lo que había justo antes es lo que se llevó. Solo alcanza desde que se
  // empezó a registrar, así que es un suelo.
  if (serie.length < 2) return null;

  let barrido = 0;
  let barridos = 0;
  for (let i = 1; i < serie.length; i++) {
    if (serie[i].ganado < serie[i - 1].ganado) {
      barrido += serie[i - 1].ganado;
      barridos++;
    }
  }

  return {
    total: barrido + excedente + serie[0].ganado,
    barrido,
    barridos,
    excedente,
    fuente: 'snapshots',
    completo: serie[0].ts <= activacionTs + 3600,
  };
}

/**
 * Ganado por día, recompuesto de la serie.
 *
 * ⚠ El día es UTC, no local. Se agrupa con `toISOString()`, igual que
 *   `daily.fecha` en D1. En España (UTC+2 en verano) eso significa que «hoy»
 *   empieza a las 02:00 hora local: entre medianoche y las dos de la mañana
 *   esta función todavía cuenta el día anterior. Es una rareza aceptada a
 *   propósito — cambiarla solo en un panel haría que los dos discrepasen.
 */
export function diarioReal(serie = []) {
  const porDia = new Map();
  for (let i = 1; i < serie.length; i++) {
    const ganado = ganadoEntre(serie[i - 1].ganado, serie[i].ganado);
    const fecha = new Date(serie[i].ts * 1000).toISOString().slice(0, 10);

    const d = porDia.get(fecha) || { fecha, ganado_dia: 0, desde: serie[i].ts, hasta: serie[i].ts };
    d.ganado_dia += ganado;
    d.desde = Math.min(d.desde, serie[i - 1].ts);
    d.hasta = Math.max(d.hasta, serie[i].ts);
    porDia.set(fecha, d);
  }

  return [...porDia.values()]
    .map(d => ({
      ...d,
      // Horas de la jornada realmente cubiertas. El primer día registrado casi
      // nunca está entero, y contarlo como completo hunde cualquier media: el
      // 8-ago solo se midió desde las 13:53.
      horas: (d.hasta - d.desde) / 3600,
      completo: (d.hasta - d.desde) / 3600 >= 23,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * Ritmo de recompensas.
 *
 * `pls_dia` de KV es la media desde la activación, y durante las primeras
 * semanas está dominada por el periodo en que los validadores aún entraban en
 * cola ganando casi nada: subestima el ritmo real hasta 10 veces, y de ahí
 * cuelgan los hitos y las proyecciones. Se mide sobre datos recientes y solo se
 * usa KV como último recurso.
 *
 * Las propuestas de bloque son esporádicas y grandes: una ventana corta que
 * pille una infla el ritmo, y una que no la pille lo desinfla. Por eso se marca
 * como provisional mientras la ventana sea de horas y no de días.
 *
 * @param {function} fmt  Formateador de horas, para que la etiqueta salga
 *                        idéntica a la del panel que la pide.
 */
export function ritmoDiario({
  serie = [],
  snapshots24h = [],
  plsDiaKV,
  hoy = new Date().toISOString().slice(0, 10),
  fmt = n => String(Math.round(n)),
} = {}) {
  const cerrados = diarioReal(serie)
    .filter(d => d.fecha !== hoy && d.completo && d.ganado_dia > 0).slice(-7);
  if (cerrados.length >= 2) {
    return {
      pls_dia: cerrados.reduce((a, d) => a + d.ganado_dia, 0) / cerrados.length,
      base: `media de ${cerrados.length} días`,
      provisional: false,
    };
  }

  // Sin días enteros se mide sobre los snapshots, sumando tramo a tramo para
  // que los barridos no resten.
  const s = snapshots24h;
  if (s.length >= 2) {
    const horas = (s[s.length - 1].ts - s[0].ts) / 3600;
    let acumulado = 0;
    for (let i = 1; i < s.length; i++) acumulado += ganadoEntre(s[i - 1].ganado, s[i].ganado);
    if (horas >= 2 && acumulado > 0) {
      return { pls_dia: (acumulado / horas) * 24, base: `medido en ${fmt(horas, 0)} h`, provisional: true };
    }
  }

  return { pls_dia: plsDiaKV, base: 'media desde la activación', provisional: true };
}

/**
 * Lo generado en la última hora CERRADA.
 *
 * Se llama «última hora» y no «esta hora» a propósito: los snapshots son
 * horarios en punto, así que a las 18:45 el dato más reciente es el del tramo
 * 17:00→18:00. Rotularlo «esta hora» sería mentir por comodidad.
 *
 * @returns {object|null} { pls, desde, hasta } o null si no hay dos lecturas.
 */
export function ultimaHora(serie = []) {
  if (serie.length < 2) return null;
  const a = serie[serie.length - 2];
  const b = serie[serie.length - 1];
  return { pls: ganadoEntre(a.ganado, b.ganado), desde: a.ts, hasta: b.ts };
}

/**
 * Lo generado hoy (día UTC — ver la nota de `diarioReal`).
 *
 * @returns {object|null} el día de hoy, o null si aún no hay tramo medido.
 */
export function generadoHoy(serie = [], hoy = new Date().toISOString().slice(0, 10)) {
  return diarioReal(serie).find(d => d.fecha === hoy) || null;
}

/**
 * Referencia del grupo para comparar validadores entre sí.
 *
 * Es la media **quitando al que más ha ganado**, no el máximo. Si uno acaba de
 * proponer bloque se lleva unos 5.700 PLS de premio, y medir contra él
 * convertiría esa suerte en «lo que han fallado» los otros nueve — justo lo
 * contrario de lo que pasa.
 *
 * @returns {number|null} null si no hay suficientes para comparar.
 */
export function referenciaGrupo(valores) {
  if (valores.length < 3) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const resto = orden.slice(0, -1);            // fuera el más alto
  const ref = resto.reduce((a, x) => a + x, 0) / resto.length;
  return ref > 0 ? ref : null;
}

/**
 * APR real, ponderado por validador-hora.
 *
 *     APR = ganancia_real / Σ(depósito_i × horas_activas_i) × 8760 × 100
 *
 * El denominador NO es `stake_total × horas_del_grupo`. Con validadores de
 * distinta antigüedad esa cuenta miente en los dos sentidos: si se usan las
 * horas del más veterano, el que acaba de entrar infla el stake sin haber
 * tenido tiempo de producir y el APR sale bajo; si se usan las del más nuevo,
 * sale disparado. Lo que de verdad ha estado trabajando es cada depósito
 * durante SUS horas, y eso es lo que se suma.
 *
 * Con diez a 273 h y uno a 20 h, el denominador correcto es
 * 320M×273 + 32M×20 = 88.000M validador-hora, frente a los 96.096M que da
 * `stake_total × horas_del_veterano`. Un 8,4% de diferencia, y el APR sale
 * proporcionalmente más alto.
 *
 * El numerador es la ganancia REAL —barridos más excedente—, nunca el
 * excedente suelto.
 *
 * @param {number} total      `gananciaAcumulada().total`.
 * @param {Array}  detalle    `estado.validadores.detalle`, con `activacion_ts`.
 * @param {number} deposito   PLS por validador (`stake_total / total`).
 * @returns {object|null} { pct, validadorHoras, conActivacion, deTodos }
 */
export function aprValidadorHora({ total, detalle = [], deposito, ahoraS = Math.floor(Date.now() / 1000) }) {
  if (!(total > 0) || !(deposito > 0) || !detalle.length) return null;

  let validadorHoras = 0;
  let conActivacion = 0;

  for (const d of detalle) {
    const ts = Number(d.activacion_ts);
    if (!Number.isFinite(ts) || ts <= 0 || ts > ahoraS) continue;
    conActivacion++;
    validadorHoras += deposito * ((ahoraS - ts) / 3600);
  }

  // Sin activaciones no se inventa nada: es preferible no enseñar APR a
  // enseñar uno calculado sobre un denominador adivinado.
  if (conActivacion === 0 || validadorHoras <= 0) return null;

  return {
    pct: (total / validadorHoras) * 8760 * 100,
    validadorHoras,
    conActivacion,
    // Si el recolector todavía no publica `activacion_ts` para todos, el APR
    // sale sobre los que sí lo traen y hay que decirlo.
    deTodos: conActivacion === detalle.length,
  };
}

/**
 * Ritmo de los barridos, medido sobre los ciclos ya observados.
 *
 * Se usa la MEDIANA de los huecos, no la media: si el recolector estuvo parado
 * un día, ese hueco enorme entra en la lista y una media lo repartiría sobre
 * la estimación entera. La mediana lo ignora.
 *
 * @param {Array} ciclos  `ganancia.ciclos`, cada uno con su `ts`.
 * @returns {object|null} { periodo, ultimo, n } en segundos, o null.
 */
export function ritmoBarridos(ciclos = []) {
  if (ciclos.length < 3) return null;

  const ts = ciclos.map(c => Number(c.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  if (ts.length < 3) return null;

  const huecos = [];
  for (let i = 1; i < ts.length; i++) huecos.push(ts[i] - ts[i - 1]);
  huecos.sort((a, b) => a - b);

  return {
    periodo: huecos[Math.floor(huecos.length / 2)],
    ultimo: ts[ts.length - 1],
    n: ts.length,
  };
}

/**
 * Cuándo toca el próximo barrido.
 *
 * `falta` en negativo significa que ya debería haber caído: no es un error,
 * el protocolo tiene su propia cola y el ciclo se corre unos minutos. El panel
 * lo dice en vez de enseñar una cuenta atrás en negativo.
 */
export function proximoBarrido(ciclos = [], ahoraS = Math.floor(Date.now() / 1000)) {
  const r = ritmoBarridos(ciclos);
  if (!r) return null;

  const previsto = r.ultimo + r.periodo;
  return {
    ...r,
    previsto,
    desde: ahoraS - r.ultimo,
    falta: previsto - ahoraS,
    avance: Math.max(0, Math.min(1, (ahoraS - r.ultimo) / r.periodo)),
  };
}
