/**
 * PLSDASH v2 — capa de datos.
 *
 * Un solo sitio donde se habla con la red. Los paneles reciben un objeto ya
 * montado y no saben de `fetch`, de sesiones ni de qué endpoint falló: así
 * pintar es una función del estado y se puede probar con datos de mentira sin
 * levantar nada.
 *
 * Los endpoints son los que ya existen; aquí no se inventa ninguno.
 *
 *   /api/val/estado                → JSON de KV: validadores + nodo + salud
 *   /api/val/historico?rango=serie → [{ts, ganado}] toda la serie
 *   /api/val/historico?rango=24h   → snapshots de las últimas 24 h
 *   /api/val/historico?rango=todo  → tabla `daily` (trae `minutos_caido`)
 *   /api/val/ganancia              → barridos reconciliados contra la cadena
 *   /api/val/eventos?limit=60      → registro de vida (activacion, barrido, bloque)
 *   /api/precio                    → precio de PLS (ver functions/api/precio.js)
 *
 * Ninguno bloquea a los demás: se piden en paralelo y lo que falle se anota en
 * `fallos` para que el panel lo diga en vez de enseñar un hueco mudo.
 */

const API = '/api/val';

/** Unix ts de la activación de los validadores. Mismo valor que usa /val/. */
export const ACTIVACION_TS = 1786095955;

async function pedir(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) {
    const e = new Error(`${url} → ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

/**
 * Trae todo lo que necesitan los paneles.
 *
 * @returns {object} { estado, serie, snapshots24h, daily, ganancia, precio,
 *                     fallos:string[], sesion:boolean, ahoraS:number }
 */
export async function cargarTodo() {
  const peticiones = {
    estado:       `${API}/estado`,
    serie:        `${API}/historico?rango=serie`,
    snapshots24h: `${API}/historico?rango=24h`,
    daily:        `${API}/historico?rango=todo`,
    ganancia:     `${API}/ganancia`,
    eventos:      `${API}/eventos?limit=60`,
    precio:       '/api/precio',
  };

  const nombres = Object.keys(peticiones);
  const res = await Promise.allSettled(nombres.map(n => pedir(peticiones[n])));

  const salida = {
    estado: null, serie: [], snapshots24h: [], daily: [], ganancia: null,
    eventos: [], precio: null,
    fallos: [],
    // Un 401 en los endpoints del panel no es «está roto»: es «no has metido
    // el PIN». Son dos mensajes muy distintos y confundirlos manda a mirar el
    // NUC cuando lo único que falta es entrar por /val/.
    sesion: true,
    ahoraS: Math.floor(Date.now() / 1000),
  };

  res.forEach((r, i) => {
    const nombre = nombres[i];
    if (r.status === 'rejected') {
      if (r.reason?.status === 401) salida.sesion = false;
      salida.fallos.push(nombre);
      return;
    }
    const v = r.value;
    if (nombre === 'estado' || nombre === 'ganancia' || nombre === 'precio') salida[nombre] = v;
    else if (nombre === 'eventos') salida.eventos = v.eventos || [];
    else salida[nombre] = v.datos || [];
  });

  return salida;
}

/**
 * Temperatura del NVMe.
 *
 * No está en el estado de KV —`estado.nodo` no la trae— y sí en `snapshots`,
 * así que sale de la última fila de las 24 h. Se busca hacia atrás porque las
 * dos únicas filas con huecos de la tabla podrían ser las últimas.
 */
export function tempNvme(snapshots24h = []) {
  for (let i = snapshots24h.length - 1; i >= 0; i--) {
    const t = Number(snapshots24h[i].temp_nvme);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Salud del sistema en una palabra.
 *
 * ⚠ NO basta con `estado.salud`. Lo avisa el propio `functions/api/val/estado.js`:
 *   ese campo se queda congelado en «ok» si el recolector deja de correr, así
 *   que un panel que lo pinte a secas diría «Todo bien» con el NUC apagado —
 *   que es peor que no tener panel. Por eso lo primero que se mira aquí es la
 *   edad de `generado_ts`, y solo si el dato es fresco se hace caso del resto.
 *
 * El orden importa: de más grave a menos.
 */
export function saludGlobal(datos) {
  const { estado, ahoraS } = datos;

  if (!datos.sesion) {
    return { palabra: 'SIN SESIÓN', tono: 'aviso', nota: 'Entra por /val/ para abrir sesión.' };
  }
  if (!estado) {
    return { palabra: 'SIN DATOS', tono: 'critico', nota: 'El panel no ha podido leer el estado.' };
  }

  const edadMin = (ahoraS - Number(estado.generado_ts || 0)) / 60;
  if (!Number.isFinite(edadMin) || edadMin > 15) {
    const txt = edadMin > 120 ? `${Math.round(edadMin / 60)} h` : `${Math.round(edadMin)} min`;
    return { palabra: 'DESFASADO', tono: 'critico', desfasado: true,
             nota: `El NUC no reporta desde hace ${txt}. Lo que ves es el último dato bueno.` };
  }

  if (estado.salud === 'sin_datos') {
    return { palabra: 'SIN DATOS', tono: 'critico',
             nota: 'El nodo responde pero sus lecturas no se admiten.' };
  }

  const n = estado.nodo || {};
  if (n.sincronizado === false) {
    return { palabra: 'CRÍTICO', tono: 'critico', nota: 'El nodo no está sincronizado.' };
  }

  const v = estado.validadores || {};
  const fuera = Number(v.total) - Number(v.activos);
  if (fuera > 0) {
    return { palabra: 'AVISO', tono: 'aviso',
             nota: fuera === 1
               ? 'Un validador fuera de servicio.'
               : `${fuera} validadores fuera de servicio.` };
  }
  if (estado.salud === 'aviso' || n.optimistic) {
    return { palabra: 'AVISO', tono: 'aviso',
             nota: n.optimistic ? 'Cabeza optimistic: aún sin verificar.' : 'El recolector avisa.' };
  }

  return { palabra: 'OPERATIVO', tono: 'ok', nota: null };
}

/**
 * Disponibilidad real, de `daily.minutos_caido`.
 *
 * No es lo mismo que el uptime del NUC: un reinicio limpio pone `uptime_horas`
 * a cero sin que se haya perdido una sola atestación, y al revés, un NUC
 * encendido pero con el cliente caído acumula uptime sin validar nada. Esto
 * mide lo segundo, que es lo que de verdad cuesta dinero.
 *
 * @returns {object|null} { pct, minutosCaidos, dias } o null si no hay días.
 */
export function disponibilidad(daily = []) {
  if (!daily.length) return null;
  const minutosCaidos = daily.reduce((a, d) => a + (Number(d.minutos_caido) || 0), 0);
  const minutosTotales = daily.length * 1440;
  return {
    pct: (1 - minutosCaidos / minutosTotales) * 100,
    minutosCaidos,
    dias: daily.length,
  };
}
