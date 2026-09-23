/**
 * La guía para añadir un validador, como DATO.
 *
 * ## P9: guiar no es operar
 *
 * El panel compone texto que tú copias y observa el resultado en los datos que
 * ya publica el NUC. No abre conexiones, no escribe en el NUC, no firma, no sube
 * nada. Todo lo que hay en este fichero es texto para leer o copiar.
 *
 * ## Por qué es un dato y no código
 *
 * La receta se lee y se corrige sin tocar interfaz, y se puede PROBAR sin
 * navegador: `pruebas/ampliar-test.mjs` comprueba que cada campo que nombra un
 * paso lo publica de verdad `nuc/collector.py`, ejecutándolo. Es la prueba que
 * habría cazado a tiempo el `red_validadores_activos`, que el panel leía y
 * nadie escribía.
 *
 * ## Nada personal aquí
 *
 * Ni usuario, ni rutas, ni la dirección de la wallet: son marcadores `{…}` que
 * se rellenan con lo que publica el NUC. Los niveles, de más alto a más bajo:
 *
 *   1 · de la cadena          depósito, versión de fork, contrato, dirección
 *                             de retirada, cuántas claves hay
 *   2 · lo publica el NUC     usuario, carpeta de claves, script de
 *                             recuperación, último deposit_data
 *   3 · de este navegador     el nombre o la IP del nodo (`{host}`): el NUC no
 *                             sabe por dónde lo alcanzas tú
 *   4 · nunca                 la seed y las contraseñas de los keystores. No hay
 *                             un solo campo donde escribirlas.
 *
 * ## La guía envejece
 *
 * Los pasos dependen de que `plsmenu` mantenga el orden de sus pantallas, que
 * el documento 27 tiene como supuesto sin verificar. Por eso cada paso dice lo
 * que deberías estar viendo y tiene un «no me coincide» que para.
 */

/** Contra qué se escribió. Lo enseña el «no me coincide». */
export const ESCRITA_CONTRA = {
  proyecto: 'tdslaine/install_pulse_node',
  /* ⚠ PENDIENTE: la versión (o el commit) de la instalación del nodo. Mientras
     sea null, la guía lo dice en pantalla en vez de inventarse una. */
  version: null,
  fecha: 'septiembre de 2026',
};

/**
 * Los seis pasos. Cada uno declara en `usa` los campos del estado que nombra
 * —la prueba de contrato los comprueba contra el recolector— y en `local` lo
 * que sale de este navegador.
 *
 *   texto      párrafos, con marcadores, ANTES de los comandos
 *   comandos   para copiar; `nota` dice dónde se escriben
 *   despues    párrafos que van DESPUÉS de los comandos
 *   datos      pares etiqueta/valor que la terminal te va a pedir
 *   trampas    avisos pegados al paso; `grande` es la respuesta a teclear
 *   deberias   lo que tendrías que estar viendo — lo que el «no me coincide»
 *              compara
 *   marca      un paso que no se puede observar se marca a mano, y el texto es
 *              lo que afirmas al marcarlo
 *   hecho      el resumen cuando ya está hecho, si el de siempre deja de ser
 *              verdad —el índice de inicio sube en cuanto la clave existe—
 */
export const PASOS = [
  {
    id: 'preparar',
    titulo: 'Prepárate antes de tocar nada',
    resumen: 'la seed en papel y dos ventanas abiertas',
    texto: [
      'Ten la seed en papel delante. Esta pestaña no la pide, no la guarda y no tiene dónde escribirla.',
      'Abre dos ventanas de terminal y entra al nodo en las dos:',
    ],
    comandos: [
      { plantilla: 'ssh {entorno.usuario}@{host}', nota: 'en las dos ventanas' },
      { plantilla: 'sudo {entorno.script_recuperacion}',
        nota: 'en la segunda: déjalo escrito y NO pulses Enter' },
    ],
    trampas: [{
      texto: 'plsmenu para el validador antes de pedirte la seed. Si algo falla, no lo vuelve a '
        + 'crear: el comando de la segunda ventana lo recupera.',
    }],
    deberias: 'El símbolo del sistema del nodo en las dos ventanas, y el comando escrito en la segunda.',
    marca: 'Tengo las dos ventanas abiertas y el comando escrito',
    usa: ['entorno.usuario', 'entorno.script_recuperacion'],
    local: ['host'],
  },
  {
    id: 'generar',
    titulo: 'Generar la clave',
    resumen: 'índice de inicio: {validadores.claves} · sale de tus claves',
    hecho: 'la clave nueva ya está en el nodo',
    texto: [
      'En la primera ventana abre plsmenu y ve a las claves del validador: añadir claves a partir de la seed que ya tienes.',
    ],
    comandos: [{ plantilla: 'plsmenu', nota: 'en la primera ventana' }],
    datos: [
      { etiqueta: 'Índice de inicio', valor: '{validadores.claves}',
        nota: 'el número de claves que ya tienes, no el 0 que propone' },
      { etiqueta: 'Cuántas', valor: '1' },
      { etiqueta: 'Dirección de retirada', valor: '{validadores.wallet_retirada}',
        nota: 'la que ya usan tus validadores, leída de la cadena' },
    ],
    trampas: [
      { cuando: 'Si te pregunta si deshabilitar la interfaz de red', grande: 'n',
        texto: 'Con «y» el nodo se queda sin red: se corta esta conexión y deja de validar.' },
      { texto: 'Un índice de inicio equivocado vuelve a generar una clave que ya existe. '
        + 'Es {validadores.claves}, no 0.' },
    ],
    deberias: 'Que te pide la seed y después una contraseña para el keystore. Las dos se escriben en la terminal, nunca aquí.',
    // Se observa: la clave nueva aparece como «esperando» en cuanto existe.
    observa: 'El NUC ve una clave nueva',
    usa: ['validadores.claves', 'validadores.wallet_retirada', 'validadores.esperando'],
  },
  {
    id: 'importar',
    titulo: 'Importarla',
    resumen: 'al cliente del validador, que vuelve a arrancar',
    texto: [
      'plsmenu importa la clave nueva al cliente del validador y lo vuelve a arrancar. '
        + 'Te pedirá la contraseña del keystore que acabas de poner.',
    ],
    deberias: 'El validador arrancando otra vez. Si se queda parado, en la segunda ventana tienes el comando que lo levanta: pulsa Enter.',
    marca: 'Importada, y el validador vuelve a estar en marcha',
    // No se puede observar la importación en sí; sí que los que ya había
    // siguen validando, que es lo que de verdad importa en este paso.
    vigila: true,
    usa: ['validadores.activos', 'validadores.total', 'validadores.pendientes'],
  },
  {
    id: 'comprobar',
    titulo: 'Comprobar el fichero de depósito',
    resumen: 'antes de mandar nada a la cadena',
    texto: [
      'Tráete el deposit_data a este ordenador. Desde una terminal DEL ORDENADOR, no del nodo:',
    ],
    despues: ['Y suéltalo en la caja de abajo. Se lee aquí mismo: no sale de tu ordenador.'],
    comandos: [{
      plantilla: 'scp {entorno.usuario}@{host}:{entorno.dir_claves}/{entorno.deposit_data_reciente.nombre} .',
      nota: 'en una terminal de este ordenador',
    }],
    observa: 'El fichero ha pasado la comprobación en este navegador',
    usa: ['entorno.usuario', 'entorno.dir_claves', 'entorno.deposit_data_reciente.nombre'],
    local: ['host'],
  },
  {
    id: 'depositar',
    titulo: 'Depositar',
    resumen: 'en el launchpad, con la wallet que tiene los PLS',
    texto: [
      'Abre el launchpad oficial de PulseChain escribiendo tú la dirección —no desde un buscador ni un anuncio—, sube el fichero y firma.',
    ],
    datos: [
      { etiqueta: 'Importe', valor: '{red.deposito|pls}' },
      { etiqueta: 'Contrato de depósito', valor: '{red.contrato_deposito}',
        nota: 'el que tiene que aparecer en la wallet al firmar; lo dice la cadena' },
    ],
    deberias: 'La wallet pidiéndote firmar un envío de ese importe a ese contrato. Si el contrato es otro, no firmes.',
    observa: 'La cadena conoce la clave nueva',
    usa: ['red.deposito', 'red.contrato_deposito', 'validadores.pendientes'],
  },
  {
    id: 'esperar',
    titulo: 'Esperar a que entre',
    resumen: 'de 12 a 18 horas en cola',
    texto: [
      'La cadena adopta el depósito y le da turno. Mientras tanto no valida ni gana, y no pasa nada: '
        + 'el panel lo enseña en cola, no como un fallo.',
    ],
    observa: 'Ya valida',
    usa: ['validadores.pendientes', 'validadores.activos'],
  },
];

/* ───────────────────────────────────────────── los marcadores */

const MARCADOR = /\{([a-z_.]+)(?:\|([a-z]+))?\}/g;

/** Lee `a.b.c` de un objeto. `undefined` si algún tramo no existe. */
export function leerRuta(obj, ruta) {
  return ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Todos los marcadores de un paso, sin repetir: lo que la prueba compara con `usa`. */
export function marcadoresDe(paso) {
  const textos = [
    paso.resumen, ...(paso.texto || []), ...(paso.despues || []),
    ...(paso.comandos || []).map(c => c.plantilla),
    ...(paso.datos || []).map(d => d.valor),
    ...(paso.trampas || []).map(t => t.texto),
  ].filter(Boolean);
  const vistos = new Set();
  for (const t of textos) for (const m of t.matchAll(MARCADOR)) vistos.add(m[1]);
  return [...vistos];
}

/**
 * Rellena una plantilla. Lo que falte se deja como `‹nombre›` y se devuelve en
 * `faltan`: el panel no puede ofrecer copiar un comando a medias como si
 * estuviera completo.
 *
 * @param {object} ctx  { estado, host, fmt }
 */
export function rellenar(plantilla, ctx) {
  const faltan = [];
  const texto = String(plantilla).replace(MARCADOR, (_, ruta, formato) => {
    const v = ruta === 'host' ? ctx.host : leerRuta(ctx.estado, ruta);
    if (v == null || v === '') {
      faltan.push(ruta);
      return `‹${ruta.split('.').pop()}›`;
    }
    if (formato === 'pls' && ctx.fmt) return `${ctx.fmt(Number(v))} PLS`;
    return String(v);
  });
  return { texto, faltan };
}

/* ───────────────────────────────────────────── en qué punto estás */

/**
 * La base de un ciclo de ampliación: los validadores que ya están dentro del
 * todo. Cuando el nuevo entra, sube, y las marcas hechas a mano para él dejan
 * de valer solas.
 */
export function baseDe(estado) {
  const v = estado?.validadores || {};
  const total = Number(v.total);
  if (!Number.isFinite(total)) return null;
  return total - (Number(v.pendientes) || 0);
}

/**
 * Qué pasos están hechos y cuál toca.
 *
 * ⚠ MANDA LO OBSERVADO. Una lista de comprobación que contradice a los datos es
 *   la forma de que el panel mienta sobre su propio estado. Así que:
 *     · lo que se ve en el estado cuenta aunque no lo hayas marcado, y arrastra
 *       como hechos los pasos anteriores —no se deposita sin clave—;
 *     · una marca que el estado desmiente NO cuenta, y se dice por qué.
 *
 * @param {object} estado    el de /api/val/estado
 * @param {object} marcas    { base, preparar, importar } de este navegador
 * @param {object} verif     { pubkey, ok } del último fichero comprobado, o null
 * @returns {object} { hechos:bool[6], actual, desmentidas:string[], enCurso }
 */
export function fase(estado, marcas = {}, verif = null) {
  const v = estado?.validadores || {};
  const esperando = Number(v.esperando) || 0;
  const enCola = Number(v.pendientes) || 0;
  const base = baseDe(estado);

  // Las marcas de un ciclo anterior no cuentan: ese validador ya entró.
  const vigentes = marcas && marcas.base != null && marcas.base === base ? marcas : {};

  const pubEsperando = (v.detalle || [])
    .filter(d => d?.esperando).map(d => normPub(d.pubkey));

  const clave = esperando > 0 || enCola > 0;
  const deposito = enCola > 0;
  const verificado = !!(verif && verif.ok && pubEsperando.includes(normPub(verif.pubkey)));

  const hechos = [
    !!vigentes.preparar || clave,
    clave,
    (!!vigentes.importar && clave) || deposito,
    verificado || deposito,
    deposito,
    false,       // «ya valida» cierra el ciclo: la base sube y todo vuelve a cero
  ];

  const desmentidas = [];
  if (vigentes.importar && !clave) {
    desmentidas.push('importar');
  }

  let actual = hechos.findIndex(h => !h);
  if (actual < 0) actual = PASOS.length - 1;

  return { hechos, actual, desmentidas, enCurso: clave || !!vigentes.preparar };
}

/** Pubkey en minúsculas y sin `0x`, que es como la escribe el `deposit_data`. */
export function normPub(p) {
  return String(p || '').toLowerCase().replace(/^0x/, '');
}
