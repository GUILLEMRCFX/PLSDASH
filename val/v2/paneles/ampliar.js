/**
 * Pestaña Ampliar — la guía para añadir un validador y la comprobación del
 * `deposit_data`.
 *
 * Las otras dos piezas de la pestaña —lo que falta con su trayectoria y las
 * aportaciones— siguen en sus módulos (`trayectoria.js`, `aportaciones.js`):
 * aquí solo se pinta lo nuevo. La receta vive en `pasos.js`, como dato; la
 * comprobación en `deposito.js`, sin DOM.
 *
 * ## P9: guiar no es operar
 *
 * El panel compone texto que tú copias y observa el resultado en los datos que
 * ya publica el NUC. No abre conexiones, no escribe en el NUC, no firma, no
 * sube nada. En este fichero no hay un solo `fetch`.
 *
 * ## Lo que se recuerda, y dónde
 *
 *   · El nombre o la IP del nodo, en `localStorage`: el NUC no sabe por dónde
 *     lo alcanzas tú, y es de este aparato.
 *   · Las marcas de los dos pasos que no se pueden observar, en
 *     `localStorage`, atadas al ciclo: cuando el validador nuevo entra, dejan
 *     de valer solas.
 *   · El resultado del último `deposit_data` —el resultado, no el fichero—, en
 *     la memoria de la página. Al recargar se olvida, y está bien: se vuelve a
 *     soltar.
 *
 * La seed y las contraseñas de los keystores no tienen campo. Ninguno.
 */

import { PASOS, ESCRITA_CONTRA, fase, rellenar, baseDe } from './pasos.js';
import { verificarDeposito } from './deposito.js';
import { fmt, escapar } from './formato.js';

const CLAVE_HOST = 'plsdash:nodo-host';
const CLAVE_MARCAS = 'plsdash:ampliar';

const leer = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } };
const escribir = (k, v) => { try { localStorage.setItem(k, v); } catch { /* no poder recordarlo no impide usarlo */ } };

export function hostGuardado() {
  return leer(CLAVE_HOST, '').trim();
}

function marcasGuardadas() {
  try { return JSON.parse(leer(CLAVE_MARCAS, '{}')) || {}; } catch { return {}; }
}

/* Estado de la página. Vive lo que la pestaña abierta: el repintado de los 18
   segundos regenera el HTML, y esto es lo que hace que no se note. */
let abierto = null;               // paso desplegado a mano; null = el que toca
const noCoincide = new Set();     // pasos donde se pulsó «no me coincide»
let informe = null;               // { nombre, resultado } del último fichero
let guardaVentana = false;

/* ─────────────────────────────────────────────── la guía */

const ICONO_COPIAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';
const ICONO_TRAMPA = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';

/**
 * Un texto con marcadores, escapado, con los huecos a la vista.
 *
 * `cortes` mete un «wbr» tras cada barra, para que una ruta larga parta por
 * sus carpetas. ⚠ Se hace sobre el TEXTO, antes de envolver los huecos: hecho
 * después, también partía la etiqueta de cierre del hueco y en pantalla salía
 * «‹host›span>».
 */
function conHuecos(plantilla, ctx, { cortes = false } = {}) {
  const { texto } = rellenar(plantilla, ctx);
  let html = escapar(texto);
  if (cortes) html = html.replace(/\//g, '/<wbr>');
  return html.replace(/‹([a-z_]+)›/g, '<span class="g-hueco">‹$1›</span>');
}

function comando(c, ctx) {
  const { texto, faltan } = rellenar(c.plantilla, ctx);
  const completo = faltan.length === 0;
  return `
    <div class="g-cmd">
      <code>${conHuecos(c.plantilla, ctx, { cortes: true })}</code>
      <button type="button" class="g-copiar" data-copiar="${escapar(texto)}"
              ${completo ? '' : 'disabled'} aria-label="Copiar el comando">${ICONO_COPIAR}</button>
    </div>
    ${c.nota ? `<p class="g-nota">${escapar(c.nota)}</p>` : ''}
    ${completo ? '' : `<p class="g-nota alerta">${escapar(motivoHueco(faltan))}</p>`}`;
}

function motivoHueco(faltan) {
  if (faltan.includes('host')) return 'Falta el nombre o la IP del nodo: ponlo arriba, en el paso 1.';
  if (faltan.some(f => f.startsWith('entorno.'))) {
    return faltan.includes('entorno.script_recuperacion')
      ? 'El NUC no encuentra el script de recuperación en la carpeta de instalación.'
      : 'El NUC aún no publica esto: sube el collector.py nuevo al NUC.';
  }
  return 'Falta un dato del NUC para completarlo.';
}

function campoHost(host) {
  return `
    <label class="g-host">
      <span>Nombre o IP del nodo en tu red</span>
      <input type="text" id="gHost" value="${escapar(host)}" autocomplete="off"
             autocapitalize="off" spellcheck="false" inputmode="url" placeholder="nuc.local">
      <span class="g-nota">Se queda en este navegador. El NUC no sabe por dónde lo alcanzas tú.</span>
    </label>`;
}

function vigilancia(estado) {
  const v = estado?.validadores || {};
  const deberian = Number(v.total) - (Number(v.pendientes) || 0);
  const activos = Number(v.activos);
  if (!Number.isFinite(deberian) || !Number.isFinite(activos)) return '';
  return activos >= deberian
    ? `<p class="g-vigila bien">Tus ${fmt(activos)} validadores siguen validando.</p>`
    : `<p class="g-vigila mal">${fmt(deberian - activos)} de tus validadores no están validando.
       Si plsmenu no ha vuelto a arrancar el validador, pulsa Enter en la segunda ventana.</p>`;
}

function cuerpoPaso(paso, i, ctx, f) {
  const partes = [];

  // El paso 2 no se despliega hasta que el 1 está hecho: la ventana con el
  // comando de recuperación tiene que existir ANTES de abrir plsmenu.
  if (paso.id === 'generar' && !f.hechos[0]) {
    return `<p class="g-bloqueo">Antes, el paso 1: la segunda ventana con el comando de
      recuperación escrito. plsmenu para el validador en cuanto empieza.</p>`;
  }

  (paso.texto || []).forEach(t => partes.push(`<p class="g-texto">${conHuecos(t, ctx)}</p>`));
  if (paso.id === 'preparar') partes.push(campoHost(ctx.host));
  (paso.comandos || []).forEach(c => partes.push(comando(c, ctx)));
  (paso.despues || []).forEach(t => partes.push(`<p class="g-texto">${conHuecos(t, ctx)}</p>`));

  if (paso.datos?.length) {
    partes.push(`<dl class="g-datos">${paso.datos.map(d => `
      <div><dt>${escapar(d.etiqueta)}</dt>
        <dd><span class="mono">${conHuecos(d.valor, ctx)}</span>${
          d.nota ? `<span class="g-nota">${escapar(d.nota)}</span>` : ''}</dd></div>`).join('')}
    </dl>`);
  }

  (paso.trampas || []).forEach(t => partes.push(`
    <div class="g-trampa">${ICONO_TRAMPA}
      <div>${t.cuando ? `<p class="g-cuando">${escapar(t.cuando)}</p>` : ''}${
        t.grande ? `<p class="g-grande">${escapar(t.grande)}</p>` : ''}
        <p>${conHuecos(t.texto, ctx)}</p></div>
    </div>`));

  if (paso.vigila) partes.push(vigilancia(ctx.estado));

  if (paso.deberias) {
    partes.push(`<p class="g-deberias"><b>Deberías ver:</b> ${escapar(paso.deberias)}</p>`);
  }

  if (paso.observa) {
    partes.push(`<p class="g-observa${f.hechos[i] ? ' hecho' : ''}">${f.hechos[i] ? '✓ ' : ''}${
      escapar(paso.observa)}${f.hechos[i] ? '' : ' — se marca solo cuando el panel lo vea.'}</p>`);
  }

  if (paso.marca) {
    const marcado = !!ctx.marcas[paso.id] && ctx.marcas.base === ctx.base;
    const visto = f.hechos[i] && !marcado;
    partes.push(`
      <button type="button" class="g-marca${marcado || visto ? ' si' : ''}" data-marcar="${paso.id}"
              aria-pressed="${marcado || visto}" ${visto ? 'disabled' : ''}>
        <span class="g-caja" aria-hidden="true">${marcado || visto ? '✓' : ''}</span>
        ${escapar(paso.marca)}${visto ? ' · lo ve el panel' : ''}
      </button>`);
  }
  if (f.desmentidas.includes(paso.id)) {
    partes.push(`<p class="g-nota alerta">Lo marcaste, pero el NUC no ve ninguna clave nueva.
      Manda lo que ve el NUC: si acabas de hacerlo, el dato llega cada 3 minutos.</p>`);
  }

  partes.push(noCoincide.has(paso.id) ? `
    <div class="g-para">
      <p><b>Para aquí.</b> No sigas con la guía: puede haber envejecido.</p>
      <p>Está escrita en ${escapar(ESCRITA_CONTRA.fecha)} contra ${escapar(ESCRITA_CONTRA.proyecto)}${
        ESCRITA_CONTRA.version ? `, versión ${escapar(ESCRITA_CONTRA.version)}` : ' (versión sin anotar todavía)'}.
        Si tu plsmenu enseña otra cosa, ha cambiado él o la guía está mal.</p>
      ${ctx.estado?.entorno?.script_recuperacion
        ? `<p>Si el validador se ha quedado parado, en la segunda ventana tienes el comando que lo levanta.</p>`
        : ''}
      <button type="button" class="g-link" data-coincide="${paso.id}">Sí coincide, seguir</button>
    </div>` : `
    <button type="button" class="g-link" data-nocoincide="${paso.id}">No me coincide</button>`);

  return partes.join('');
}

export function panelGuia(datos) {
  const estado = datos?.estado;
  if (!estado?.validadores) {
    return `
      <section class="panel" aria-labelledby="pg-t">
        <header class="p-cab"><h2 id="pg-t">Guía para añadir uno</h2></header>
        <p class="vacio">Sin el estado del NUC no se puede saber en qué punto estás.</p>
      </section>`;
  }

  const marcas = marcasGuardadas();
  const base = baseDe(estado);
  const verif = informe?.resultado?.valido
    ? { pubkey: informe.resultado.pubkey, ok: informe.resultado.ok } : null;
  const f = fase(estado, marcas, verif);
  const ctx = { estado, host: hostGuardado(), fmt, marcas, base };
  const desplegado = abierto ?? PASOS[f.actual].id;

  const filas = PASOS.map((p, i) => {
    const hecho = f.hechos[i];
    const toca = i === f.actual;
    const abiertoAqui = p.id === desplegado;
    const clase = hecho ? 'hecho' : toca ? 'toca' : 'luego';
    return `
      <li class="g-paso ${clase}${abiertoAqui ? ' abierto' : ''}">
        <button type="button" class="g-cabeza" data-paso="${p.id}" aria-expanded="${abiertoAqui}">
          <span class="g-num" aria-hidden="true">${hecho ? '✓' : i + 1}</span>
          <span class="g-tit">
            <span class="g-nombre">${escapar(p.titulo)}</span>
            ${abiertoAqui ? '' : `<span class="g-res">${conHuecos(hecho && p.hecho ? p.hecho : p.resumen, ctx)}</span>`}
          </span>
          <span class="visually-hidden">${hecho ? 'hecho' : toca ? 'toca ahora' : 'después'}</span>
        </button>
        ${abiertoAqui ? `<div class="g-cuerpo">${cuerpoPaso(p, i, ctx, f)}</div>` : ''}
      </li>`;
  }).join('');

  const sinEntorno = !estado.entorno
    ? `<p class="g-nota alerta">El NUC todavía no publica su entorno ni la dirección de
       retirada: los comandos salen con huecos hasta que se suba el collector.py nuevo.</p>`
    : '';

  return `
    <section class="panel g-panel" aria-labelledby="pg-t">
      <header class="p-cab">
        <h2 id="pg-t">Guía para añadir uno</h2>
        <span class="g-cuenta">paso ${f.actual + 1} de ${PASOS.length}</span>
      </header>
      ${sinEntorno}
      <ol class="g-lista">${filas}</ol>
      <p class="g-p9">El panel compone texto que tú copias y observa el resultado en los
        datos que ya publica el NUC. No abre conexiones, no escribe en el NUC, no firma,
        no sube nada.</p>
    </section>`;
}

/* ─────────────────────────────────────────────── el deposit_data */

const TONO_ICONO = { bien: '✓', mal: '✕', aviso: '!', sin_dato: '–' };

export function panelVerificador(datos) {
  const r = informe?.resultado;
  const lista = r?.valido ? `
    <ul class="d-lista">${r.controles.map(c => `
      <li class="d-control ${c.tono}">
        <span class="d-ico" aria-hidden="true">${TONO_ICONO[c.tono]}</span>
        <span><b>${escapar(c.titulo)}</b><span class="d-det">${escapar(c.detalle)}</span></span>
      </li>`).join('')}
    </ul>
    <p class="d-veredicto ${r.ok ? 'bien' : 'mal'}">${r.ok
      ? 'Los cinco controles, bien.'
      : 'No está bien del todo: mira lo marcado antes de depositar.'}</p>` : r ? `
    <p class="d-veredicto mal">${escapar(r.error)}</p>` : '';

  return `
    <section class="d-zona${r ? ' con-resultado' : ''}" aria-labelledby="pd-t">
      <label class="d-soltar" id="dSoltar">
        <input type="file" id="dFichero" accept=".json,application/json" class="visually-hidden">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
        <span class="d-tit" id="pd-t">${informe ? escapar(informe.nombre) : 'Arrastra aquí tu deposit_data'}</span>
        <span class="d-sub">${informe ? 'Suelta otro para volver a comprobar, o toca para elegirlo.'
          : 'O toca para elegirlo. Se lee aquí: no sale de tu ordenador.'}</span>
      </label>
      ${lista}
      <p class="d-firma">Comprueba la dirección de retirada, que sea uno, la clave, el importe y
        la red. <b>No comprueba la firma</b>: eso lo hace el launchpad.</p>
    </section>`;
}

/* ─────────────────────────────────────────────── los ganchos */

/**
 * Se vuelve a enganchar en cada repintado, como el resto: el HTML se regenera
 * entero cada 18 segundos.
 */
export function engancharAmpliar(raiz, datos, repintar) {
  raiz.querySelectorAll('.g-cabeza[data-paso]').forEach(b => {
    b.addEventListener('click', () => {
      abierto = b.getAttribute('aria-expanded') === 'true' ? '' : b.dataset.paso;
      repintar();
    });
  });

  raiz.querySelectorAll('.g-copiar').forEach(b => {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copiar);
        b.classList.add('copiado');
        b.setAttribute('aria-label', 'Copiado');
        setTimeout(() => { b.classList.remove('copiado'); b.setAttribute('aria-label', 'Copiar el comando'); }, 1600);
      } catch {
        // Sin portapapeles —http, permisos—: se selecciona para copiar a mano.
        const code = b.parentElement.querySelector('code');
        const r = document.createRange();
        r.selectNodeContents(code);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
    });
  });

  raiz.querySelectorAll('[data-marcar]').forEach(b => {
    b.addEventListener('click', () => {
      const base = baseDe(datos?.estado);
      const m = marcasGuardadas();
      const vigentes = m.base === base ? m : { base };
      vigentes[b.dataset.marcar] = !vigentes[b.dataset.marcar];
      escribir(CLAVE_MARCAS, JSON.stringify(vigentes));
      repintar();
    });
  });

  raiz.querySelectorAll('[data-nocoincide]').forEach(b =>
    b.addEventListener('click', () => { noCoincide.add(b.dataset.nocoincide); repintar(); }));
  raiz.querySelectorAll('[data-coincide]').forEach(b =>
    b.addEventListener('click', () => { noCoincide.delete(b.dataset.coincide); repintar(); }));

  const host = raiz.querySelector('#gHost');
  if (host) {
    host.addEventListener('input', () => escribir(CLAVE_HOST, host.value.trim()));
    host.addEventListener('change', () => repintar());
  }

  /* Un fichero soltado FUERA de la caja, el navegador lo abre y se va del
     panel. Se para una vez, y solo para ficheros. */
  if (!guardaVentana) {
    guardaVentana = true;
    const esFichero = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragover', ev => { if (esFichero(ev)) ev.preventDefault(); });
    window.addEventListener('drop', ev => { if (esFichero(ev)) ev.preventDefault(); });
  }

  const zona = raiz.querySelector('#dSoltar');
  const entrada = raiz.querySelector('#dFichero');
  const leerFichero = async fichero => {
    if (!fichero) return;
    // `File.text()`: el contenido se queda en esta página. Ver la cabecera.
    const texto = await fichero.text();
    informe = { nombre: fichero.name, resultado: verificarDeposito(texto, datos?.estado, fmt) };
    repintar();
  };
  if (entrada) entrada.addEventListener('change', () => leerFichero(entrada.files?.[0]));
  if (zona) {
    zona.addEventListener('dragover', ev => { ev.preventDefault(); zona.classList.add('encima'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
    zona.addEventListener('drop', ev => {
      ev.preventDefault();
      zona.classList.remove('encima');
      leerFichero(ev.dataTransfer?.files?.[0]);
    });
  }
}

/** Solo para las pruebas: vuelve al estado de una página recién abierta. */
export function _reiniciar() {
  abierto = null; noCoincide.clear(); informe = null;
}
