/**
 * Los idiomas (3-nov-2026): que no falte ninguna traducción y que, en inglés y
 * en francés, el panel no deje español a la vista.
 *
 * Tres comprobaciones:
 *   1. Cada clave que usa el código —`t('…')` en el panel, `tr('…')` en la
 *      portada, los `data-i18n` del HTML y las que pasan por una variable
 *      (lista de abajo)— está en inglés Y en francés.
 *   2. Cada traducción lleva las mismas marcas `{n}` que su original: una que
 *      se pierde deja la cifra fuera; una de más sale escrita tal cual.
 *   3. Los paneles pintados en inglés y en francés con datos de verdad no
 *      contienen palabras españolas sueltas. Es la que caza un texto que se
 *      escribió sin `t()`.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/idioma-test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

await import('/i18n/idioma.js');
await import('/i18n/portada.js');
const I = globalThis.plsI18n;
const { TEXTOS } = await import('/val/v2/paneles/textos.js');

let fallos = 0, pruebas = 0;
const okQue = (que, cond, detalle = '') => {
  pruebas++;
  if (!cond) { fallos++; console.log(`  FALLA ${que}${detalle ? `\n        ${detalle}` : ''}`); }
  else console.log(`  OK   ${que}`);
};

const RAIZ = new URL('..', import.meta.url).pathname;
const leer = r => readFileSync(join(RAIZ, r), 'utf8');
const sinComentarios = s => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/** Las claves literales de un fuente: llamadas a t/tt/tr y `data-i18n`. */
function claves(src, funciones) {
  const s = sinComentarios(src);
  const out = new Set();
  const re = new RegExp(`(?<![\\w.])(?:${funciones.join('|')})\\(\\s*('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|\`(?:[^\`\\\\$]|\\\\.)*\`)`, 'g');
  for (const m of s.matchAll(re)) out.add(m[1].slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"'));
  for (const m of s.matchAll(/data-i18n(?:-[\w-]+)?="([^"$]+)"/g)) out.add(m[1]);
  for (const m of s.matchAll(/data-i18n(?:-[\w-]+)?='([^'$]+)'/g)) out.add(m[1]);
  return out;
}

/* Las que pasan por una variable y no se ven como `t('…')`. Si se añade una
   constante de texto que se traduce al pintarla, va aquí. */
const INDIRECTAS_PANEL = [
  // TITULO de cada panel
  'Aportaciones', 'Ciclo de barrido', 'Estado global', 'Ganancias', 'Cómo se ha construido',
  'Precio de PLS', 'Si PLS valiera otra cosa', 'Registro', 'Resumen', 'Salud del nodo', 'Validadores',
  // ritmo.js PERIODOS, resumen.js NOMBRE, tema.js TEMAS, puerta.js ROTULO
  'Hora', 'Día', 'Semana', 'Mes', 'Año', 'el staking', 'la wallet', 'lo sin barrer',
  'Núcleo', 'cian y naranja', 'Menta', 'frío y bajo en saturación', 'Pulso', 'el rosa de la portada',
  'Ámbar', 'cálido', 'Papel', 'casi sin color', 'Salir a PLSDASH', 'Borrar el último dígito',
  // etiquetas que se pasan a una función que las traduce
  'Hoy · UTC', 'Última hora', 'Vale el stake', 'Vale lo generado', 'Dentro de un año',
  'al ritmo de ahora, a este precio', 'Frente a tu entrada', 'Precio de ahora', 'Precio del sacrificio',
  'aviso', 'critico', 'Encendiendo la red', 'Esperando datos del nodo',
  // títulos que escribe el recolector en D1 (comprobados contra D1)
  'Barrido de saldo', 'Bloque propuesto', 'Validador nuevo esperando a entrar en la cadena', 'Validadores recuperados',
];
const INDIRECTAS_PORTADA = [
  '24 h', '7 días', '30 días', 'Valor', 'Cambio 24h', 'Nombre',
  'Desde $10', 'Desde $5', 'Desde $1', 'Desde $0.10', 'Ver todo',
  'Traspaso entre tus propias wallets', 'Un NFT, que no tiene cantidad que sumar',
  'Salió de la wallet sin recibir nada a cambio',
  'Llegó un token sin que saliera nada: airdrop, regalo o envío de un tercero',
  'Llegaron varios tokens en la misma transacción',
  'Varios tokens a la vez: liquidez o un enrutado que no se lee como un cambio',
  'Idioma',
];

const ficherosPanel = [
  ...['datos.js', 'puerta.js', 'index.html'].map(f => `public/val/v2/${f}`),
  ...readdirSync(join(RAIZ, 'public/val/v2/paneles')).filter(f => f.endsWith('.js') && f !== 'textos.js')
    .map(f => `public/val/v2/paneles/${f}`),
  ...readdirSync(join(RAIZ, 'public/val/v2/carga')).filter(f => f.endsWith('.js')).map(f => `public/val/v2/carga/${f}`),
  'public/val/compartido/ganancias.js',
];
const panel = new Set(INDIRECTAS_PANEL);
for (const f of ficherosPanel) for (const k of claves(leer(f), ['t', 'tt'])) panel.add(k);
// `${…}` en una clave es una plantilla, no un texto: la marca de atributo de
// la puerta lleva la variable y su clave real está en INDIRECTAS.
for (const k of [...panel]) if (k.includes('${')) panel.delete(k);

const portada = new Set(INDIRECTAS_PORTADA);
for (const k of claves(leer('public/index.html'), ['tr'])) portada.add(k);

const marcas = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

function comprobar(nombre, usadas, dic) {
  console.log(`── ${nombre}: ${usadas.size} claves`);
  for (const l of ['en', 'fr']) {
    const faltan = [...usadas].filter(k => !(k in dic[l]));
    okQue(`${nombre} · todas en ${l}`, !faltan.length, faltan.slice(0, 12).map(k => JSON.stringify(k)).join('\n        '));
    const mal = [...usadas].filter(k => k in dic[l] && marcas(k) !== marcas(dic[l][k]));
    okQue(`${nombre} · ${l} con las mismas marcas {…}`, !mal.length, mal.slice(0, 8).map(k => `${k} → ${dic[l][k]}`).join('\n        '));
    const vacias = Object.entries(dic[l]).filter(([, v]) => !String(v).trim());
    okQue(`${nombre} · ${l} sin traducciones vacías`, !vacias.length, vacias.map(([k]) => k).join(', '));
  }
}
comprobar('panel', panel, TEXTOS);
comprobar('portada', portada, I._dic);

/* ── 3. pintado en inglés y francés ─────────────────────────────────────── */
console.log('── los paneles pintados, sin español a la vista');
const P = '/val/v2/paneles/';
const mods = await Promise.all(['resumen', 'ganancias', 'ciclo', 'validadores', 'salud-nodo', 'estado-global',
  'registro', 'hitos', 'trayectoria', 'precio-historico', 'precio-simulado', 'aportaciones']
  .map(m => import(`${P}${m}.js`)));
const funciones = mods.flatMap(m => Object.entries(m).filter(([k, v]) => /^panel/.test(k) && typeof v === 'function').map(([, v]) => v));

const AHORA = Math.floor(Date.now() / 1000);
const det = Array.from({ length: 14 }, (_, i) => ({
  indice: i < 12 ? 109549 + i : null, pubkey_corta: '0xab' + i + '…',
  estado: i < 11 ? 'active_ongoing' : i === 11 ? 'pending_queued' : 'esperando',
  esperando: i >= 12, pendiente: i === 11, activacion_ts: AHORA - (i < 6 ? 80 : 20) * 86400,
  balance: 32e6 + 800 - (i === 3 ? 900 : 0), ganado: i === 5 ? 100 : 800,
}));
const ciclos = Array.from({ length: 30 }, (_, i) => ({ ts: AHORA - (30 - i) * 8.1 * 3600 - 7200, pls: 18000, validadores: 11, bloques: i % 6 === 0 ? 1 : 0 }));
const serie = Array.from({ length: 24 * 20 }, (_, i) => ({ ts: AHORA - (24 * 20 - i) * 3600, ganado: (i % 8) * 2300, balance_total: 352e6 }));
const datos = {
  sesion: true, ahoraS: AHORA,
  estado: {
    generado_ts: AHORA - 60, salud: 'ok',
    nodo: { sincronizado: true, peers: 50, uptime_horas: 400, temp_cpu: 52, ram_total_gb: 32, ram_libre_gb: 18,
            disco_usado_pct: 63, disco_libre_gb: 700, carga_pct: 12, head_slot: 1234, epoch_actual: 99 },
    validadores: { total: 12, activos: 11, pendientes: 1, esperando: 2, claves: 14, stake_total: 384e6,
                   ganado_total: 12000, pls_dia: 48000, detalle: det },
  },
  ganancia: { total: 4.2e6, saldo_wallet: 4.3e6, ciclos, por_validador: { 109550: 3, 109553: 1 },
              pls_bloques: 2e5, peso_bloques: 4.7, valorado: { barridos: 30, con_precio: 20, usd: 21.4 } },
  precio: { disponible: true, precio: 0.000005886, cambio24: 3.2, simbolo: 'PLS' },
  precioSerie: Array.from({ length: 200 }, (_, i) => ({ ts: AHORA - (200 - i) * 3600, precio_pls: 0.0000055 + 1e-7 * Math.sin(i / 9) })),
  serie, snapshots24h: serie.slice(-24), daily: [],
  eventos: [
    { ts: AHORA - 3600, tipo: 'barrido', titulo: 'Barrido de saldo', pls: 18000 },
    { ts: AHORA - 3600, tipo: 'bloque', titulo: 'Bloque propuesto', validador: 109550, pls: 3000 },
    { ts: AHORA - 90000, tipo: 'bloque', titulo: 'Bloque propuesto', validador: 109553, pls: 3000 },
    { ts: AHORA - 200000, tipo: 'activacion', titulo: 'Validador 109559 activado', validador: 109559 },
    { ts: AHORA - 200000, tipo: 'activacion', titulo: 'Validador 109560 activado', validador: 109560 },
    { ts: AHORA - 300000, tipo: 'aviso', titulo: 'Validador nuevo esperando a entrar en la cadena' },
    { ts: AHORA - 400000, tipo: 'recuperacion', titulo: 'Validadores recuperados' },
  ],
  aportaciones: { aportaciones: [{ id: 1, ts: AHORA - 5 * 86400, pls: 1e6, precio_pls: 0.000006 }], total_pls: 1e6, total_usd: 6, sin_precio: 0 },
};

/* Palabras que delatan español. Los nombres propios y los términos que se
   dejan igual a propósito (PLS, NUC, staking, wallet, prune, optimistic) no
   están. Con tildes o eñe basta un carácter. */
const DELATORAS = /\b(?:de|del|los|las|el|la|sin|con|por|para|que|está|están|validadores?|barrido|hace|días|hoy|ayer|aún|todavía|precio|dato|bloques?|cada|desde|hacia|entre|nodo|ganado|generado|aportad[oa]s?)\b|[áéíóúñ¿¡]/i;
/* ⚠ Las FECHAS se quedan en español a propósito: los números y las fechas no
   cambian con el idioma (decisión del propietario, 3-nov-2026). Se quitan
   antes de buscar, o cada «15 de agosto de 2026» contaría como un fallo. */
const MESES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic';
const DIAS = 'lunes|martes|miércoles|jueves|viernes|sábado|domingo|lun|mié|jue|vie|sáb|dom';
const sinFechas = s => s
  .replace(new RegExp(`\\b(?:${DIAS})\\.?,?\\s*`, 'gi'), ' ')
  .replace(new RegExp(`\\b\\d{1,2}\\s+(?:de\\s+)?(?:${MESES})\\.?(?:\\s+de\\s+\\d{4})?`, 'gi'), ' ')
  .replace(new RegExp(`\\b(?:${MESES})\\s+de\\s+\\d{4}`, 'gi'), ' ');
const texto = h => sinFechas(h.replace(/<code>[\s\S]*?<\/code>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim());
const atributos = h => sinFechas([...h.matchAll(/(?:aria-label|title|aria-valuetext)="([^"]*)"/g)].map(m => m[1]).join(' · '));

for (const l of ['en', 'fr']) {
  I._poner(l);
  const malos = [];
  for (const f of funciones) {
    const html = f(datos);
    for (const trozo of [texto(html), atributos(html)]) {
      // Se trocea por frases cortas para que el informe diga DÓNDE.
      for (const frase of trozo.split(/ · | — |\. /)) {
        // En francés «de», «la» y «les» también existen: allí solo cuentan las
        // tildes españolas y las palabras que no existen en francés.
        const re = l === 'fr'
          ? /\b(?:del|los|las|el|sin|con|por|para|está|están|validadores?|barrido|hace|días|hoy|ayer|aún|todavía|precio|dato|bloques?|cada|desde|hacia|nodo|ganado|generado|aportad[oa]s?)\b|[áíóúñ¿¡]/i
          : DELATORAS;
        if (re.test(frase)) malos.push(`${f.name}: «${frase.trim().slice(0, 90)}»`);
      }
    }
  }
  okQue(`en ${l}, ningún panel deja español`, !malos.length, [...new Set(malos)].slice(0, 15).join('\n        '));
}
I._poner('es');

console.log(`\n${pruebas - fallos}/${pruebas} bien`);
process.exit(fallos ? 1 : 0);
