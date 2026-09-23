/**
 * Comprobación de un `deposit_data`, entera en el navegador.
 *
 * El fichero se lee con `File.text()` y se queda en la memoria de esta página:
 * no se manda a ningún sitio, no se guarda y no se vuelve a leer. No es
 * secreto —es lo que acaba publicado en la cadena—, pero no tiene por qué
 * viajar. Lo único que se recuerda al terminar es el resultado y la pubkey,
 * para que la guía sepa que ese paso está hecho.
 *
 * ## Los cinco controles, por orden de lo que duele equivocarse
 *
 *   1. La dirección de retirada, contra la que usan tus validadores.
 *   2. Que contiene exactamente uno.
 *   3. La pubkey contra tus claves: si ya valida, estarías depositando otra vez
 *      sobre un validador que existe.
 *   4. El importe, contra el depósito que dice la cadena.
 *   5. La red, por la versión de fork.
 *
 * ## ⚠ Lo que NO comprueba: la firma
 *
 * Eso exige BLS, y meter una librería de criptografía en un proyecto sin
 * compilación. La firma la valida el launchpad. El panel lo dice en pantalla:
 * un «todo correcto» sin esa frase se leería como una garantía que no es.
 */

import { normPub } from './pasos.js';

const GWEI = 1e9;

/** '0x…' de 20 bytes de unas credenciales 0x01/0x02, o null. Igual que el recolector. */
export function direccionDeCredenciales(cred) {
  const c = String(cred || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(c)) return null;
  if (c.slice(0, 2) !== '01' && c.slice(0, 2) !== '02') return null;
  if (c.slice(2, 24) !== '0'.repeat(22)) return null;
  return '0x' + c.slice(24);
}

const corta = s => (s && s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s || '');
const hex = s => String(s || '').toLowerCase().replace(/^0x/, '');

/**
 * @param {string} texto   el contenido del fichero
 * @param {object} estado  el de /api/val/estado
 * @param {function} fmt   formateo de cifras
 * @returns {object} { valido, error?, pubkey?, controles:[{id, tono, titulo, detalle}], ok }
 *   `tono`: 'bien' | 'mal' | 'aviso' | 'sin_dato'
 */
export function verificarDeposito(texto, estado, fmt = n => String(n)) {
  let datos;
  try { datos = JSON.parse(texto); }
  catch { return { valido: false, error: 'No es un JSON. ¿Es el deposit_data-….json?', controles: [], ok: false }; }

  if (!Array.isArray(datos)) {
    return { valido: false, error: 'No tiene la forma de un deposit_data: tendría que ser una lista.', controles: [], ok: false };
  }
  const primero = datos[0] || {};
  const campos = ['pubkey', 'withdrawal_credentials', 'amount', 'fork_version'];
  const faltan = campos.filter(c => primero[c] == null);
  if (!datos.length || faltan.length) {
    return { valido: false,
      error: datos.length ? `Le faltan campos: ${faltan.join(', ')}.` : 'Está vacío.',
      controles: [], ok: false };
  }

  const v = estado?.validadores || {};
  const red = estado?.red || {};
  const controles = [];

  /* 1 · La dirección de retirada. */
  {
    const propia = typeof v.wallet_retirada === 'string' ? v.wallet_retirada.toLowerCase() : null;
    const dirs = datos.map(d => direccionDeCredenciales(d.withdrawal_credentials));
    if (dirs.some(d => d == null)) {
      controles.push({ id: 'direccion', tono: 'mal', titulo: 'Sin dirección de retirada',
        detalle: 'Sus credenciales son de tipo 0x00: lo que genere no se podría retirar a una wallet.' });
    } else if (!propia) {
      controles.push({ id: 'direccion', tono: 'sin_dato', titulo: 'Dirección de retirada: no se puede comparar',
        detalle: `Lleva ${corta(dirs[0])}, pero el NUC no publica la tuya todavía.` });
    } else if (dirs.every(d => d === propia)) {
      controles.push({ id: 'direccion', tono: 'bien', titulo: 'La dirección de retirada es la tuya',
        detalle: `${corta(propia)}, la misma que usan tus validadores.` });
    } else {
      const otra = dirs.find(d => d !== propia);
      controles.push({ id: 'direccion', tono: 'mal', titulo: 'La dirección de retirada NO es la tuya',
        detalle: `Lleva ${corta(otra)} y tus validadores retiran a ${corta(propia)}. No lo deposites.` });
    }
  }

  /* 2 · Exactamente uno. */
  controles.push(datos.length === 1
    ? { id: 'uno', tono: 'bien', titulo: 'Contiene un validador', detalle: 'Uno, que es lo que hay que depositar.' }
    : { id: 'uno', tono: 'mal', titulo: `Contiene ${datos.length} validadores`,
        detalle: 'Tendría que ser uno. Suele ser haber generado de más: revisa el índice de inicio y cuántas.' });

  /* 3 · La pubkey contra tus claves. */
  const pub = normPub(primero.pubkey);
  {
    const mia = (v.detalle || []).find(d => normPub(d?.pubkey) === pub);
    if (!mia) {
      controles.push({ id: 'clave', tono: 'aviso', titulo: 'La clave no está en el nodo',
        detalle: 'Ninguna clave del NUC coincide. ¿Es de otra máquina? Si acabas de generarla, el dato llega cada 3 minutos.' });
    } else if (mia.esperando) {
      controles.push({ id: 'clave', tono: 'bien', titulo: 'Es la clave que acabas de generar',
        detalle: `${corta('0x' + pub)}, en el nodo y sin depositar.` });
    } else {
      controles.push({ id: 'clave', tono: 'mal', titulo: 'Esa clave YA es un validador',
        detalle: `Es el ${mia.indice ?? corta('0x' + pub)}, que la cadena ya conoce. Depositar otra vez sería meter más PLS en el mismo, no uno nuevo.` });
    }
  }

  /* 4 · El importe. */
  {
    const deposito = Number(red.deposito) > 0 ? Number(red.deposito)
      : Number(v.total) > 0 ? Number(v.stake_total) / Number(v.total) : null;
    const importes = datos.map(d => Number(d.amount) / GWEI);
    /* En BigInt y en gwei: 32M PLS son 3,2e16 gwei, por encima del entero
       exacto de un double. Hoy da igual por suerte —ese número en concreto se
       representa bien—, pero otro depósito podría no hacerlo, y aquí la
       igualdad tiene que ser exacta. */
    const gwei = datos.map(d => { try { return BigInt(String(d.amount)); } catch { return null; } });
    if (!deposito) {
      controles.push({ id: 'importe', tono: 'sin_dato', titulo: 'Importe: no se puede comparar',
        detalle: `Lleva ${fmt(importes[0])} PLS, y el NUC no publica el depósito.` });
    } else if (gwei.every(g => g !== null && g === BigInt(Math.round(deposito)) * 1000000000n)) {
      controles.push({ id: 'importe', tono: 'bien', titulo: 'El importe es el depósito',
        detalle: `${fmt(deposito)} PLS, lo que dice la cadena.` });
    } else {
      const i = gwei.findIndex(g => g === null || g !== BigInt(Math.round(deposito)) * 1000000000n);
      controles.push({ id: 'importe', tono: 'mal', titulo: 'El importe no es el depósito',
        detalle: `Lleva ${Number.isFinite(importes[i]) ? fmt(importes[i]) : 'un importe ilegible de'} PLS y el depósito son ${fmt(deposito)}.` });
    }
  }

  /* 5 · La red. */
  {
    const esperada = red.fork_version ? hex(red.fork_version) : null;
    const lleva = hex(primero.fork_version);
    if (!esperada) {
      controles.push({ id: 'red', tono: 'sin_dato', titulo: 'Red: no se puede comparar',
        detalle: `Lleva la versión ${lleva}, y el NUC no publica la de la cadena.` });
    } else if (datos.every(d => hex(d.fork_version) === esperada)) {
      controles.push({ id: 'red', tono: 'bien', titulo: 'Es para esta red',
        detalle: `Versión de fork ${lleva}${primero.network_name ? ` (${primero.network_name})` : ''}.` });
    } else {
      controles.push({ id: 'red', tono: 'mal', titulo: 'Es para OTRA red',
        detalle: `Lleva la versión ${lleva} y esta cadena usa ${esperada}. El depósito se perdería.` });
    }
  }

  return {
    valido: true,
    pubkey: pub,
    controles,
    // Todo en verde. Un control que no se puede hacer NO cuenta como pasado.
    ok: controles.every(c => c.tono === 'bien'),
  };
}
