/**
 * Lo que pasa al añadir el validador 12.
 *
 * Todo lo de aquí son funciones puras: la salud, el desglose del saldo, los
 * nodos de la esfera y la línea temporal. Sin navegador, porque lo que hay que
 * comprobar son decisiones sobre datos, no píxeles.
 *
 *   node --import ./pruebas/resolver.mjs pruebas/doce-test.mjs
 */
import { saludGlobal } from '/val/v2/datos.js';
import { desglosarSaldo, depositadoEnAmpliaciones } from '/val/v2/paneles/aportaciones.js';
import { nodosDesde } from '/val/v2/escena/estado-escena.js';
import { hitosDesde, panelHitos } from '/val/v2/paneles/hitos.js';
import { panelValidadores } from '/val/v2/paneles/validadores.js';
import { tituloObjetivo } from '/val/v2/paneles/trayectoria.js';

let fallos = 0, pruebas = 0;
const ok = (que, real, esperado) => {
  pruebas++;
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallos++;
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${que}`
    + (bien ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`));
};
const okQue = (que, cond, detalle = '') => {
  pruebas++;
  if (!cond) { fallos++; console.log(`  FALLA ${que}${detalle ? ' · ' + detalle : ''}`); }
  else console.log(`  OK   ${que}`);
};

const AHORA = 1788000000;
const DIA = 86400;
const DEPOSITO = 32e6;

/** Un validador activo, activado hace `dias` días. */
const A = (indice, dias, ganado = 5000) => ({
  indice, estado: 'active_ongoing', pendiente: false, slashed: false,
  balance: DEPOSITO + ganado, ganado,
  activacion_ts: AHORA - dias * DIA,
});
/** Uno en cola: sin fecha de activación, porque aún no la tiene. */
const P = indice => ({
  indice, estado: 'pending_queued', pendiente: true, slashed: false,
  balance: DEPOSITO, ganado: 0,
  activacion_ts: null, activation_epoch: null,
});
/** Uno caído de verdad. */
const X = indice => ({
  indice, estado: 'exited_unslashed', pendiente: false, slashed: false,
  balance: DEPOSITO, ganado: 0, activacion_ts: AHORA - 30 * DIA,
});

const estadoCon = (detalle, extra = {}) => ({
  generado_ts: AHORA - 60, salud: 'ok',
  validadores: {
    total: detalle.length,
    activos: detalle.filter(d => d.estado.startsWith('active')).length,
    pendientes: detalle.filter(d => d.pendiente).length,
    slashed: 0,
    stake_total: DEPOSITO * detalle.length,
    detalle,
  },
  nodo: { sincronizado: true, optimistic: false },
  ...extra,
});

const ONCE = [...Array(10)].map((_, i) => A(109549 + i, 30)).concat([A(109876, 19, 3200)]);

console.log('\n=== 1. UN PENDIENTE NO ES UN AVISO ===');
{
  const datos = { sesion: true, ahoraS: AHORA, estado: estadoCon([...ONCE, P(110500)]) };
  const s = saludGlobal(datos);
  /* ⚠ LA COMPROBACIÓN QUE DA SENTIDO A TODO EL CAMBIO. Con la regla vieja
     —`activos < total`— esto devolvía AVISO durante las 12-18 h de la cola: el
     panel diciendo que algo va mal justo el día que amplías. */
  ok('el tono es de que todo va bien', s.tono, 'ok');
  ok('y la palabra también', s.palabra, 'OPERATIVO');
  okQue('pero se dice que hay uno en cola',
    /Un validador en cola de activación/.test(s.nota || ''), s.nota);
}
{
  // Y uno caído SÍ es un aviso: el cambio no puede haber apagado la alarma.
  const datos = { sesion: true, ahoraS: AHORA, estado: estadoCon([...ONCE.slice(0, 10), X(109876)]) };
  const s = saludGlobal(datos);
  ok('un caído sigue avisando', [s.palabra, s.tono], ['AVISO', 'aviso']);
  okQue('y dice que está fuera de servicio', /fuera de servicio/.test(s.nota || ''), s.nota);
}
{
  // Uno en cola y otro caído a la vez: manda el caído.
  const datos = { sesion: true, ahoraS: AHORA,
    estado: estadoCon([...ONCE.slice(0, 10), X(109876), P(110500)]) };
  ok('con uno caído y otro en cola, avisa', saludGlobal(datos).palabra, 'AVISO');
}

console.log('\n=== 2. EN LA ESFERA, EL PENDIENTE LATE ===');
{
  const nodos = nodosDesde([...ONCE, P(110500)], { 109549: 3, 109550: 1 });
  ok('hay doce nodos', nodos.length, 12);
  const p = nodos.find(n => n.indice === 110500);
  /* ⚠ Sin `pendiente`, este nodo salía con `activo: false` y la intensidad del
     suelo: exactamente igual que uno muerto. Y es lo contrario. */
  ok('el pendiente va marcado', p.pendiente, true);
  ok('y no como activo, que no lo es', p.activo, false);
  okQue('los demás no laten', nodos.filter(n => n.pendiente).length === 1);
  const vivo = nodos.find(n => n.indice === 109549);
  ok('un activo no se marca pendiente', vivo.pendiente, false);
}
{
  // El respaldo: un recolector viejo no manda `pendiente`, pero sí el estado.
  const nodos = nodosDesde([{ indice: 1, estado: 'pending_initialized' }], {});
  ok('se deduce del estado si falta el campo', nodos[0].pendiente, true);
}

console.log('\n=== 3. EL DEPÓSITO NO ES DINERO QUE SE VA ===');
{
  const datos = {
    estado: estadoCon(ONCE),
    ganancia: { saldo_wallet: 40e6, total: 60e6 },
    aportaciones: { total_pls: 12e6, aportaciones: [{ id: 1 }] },
  };
  /* Once validadores: uno se activó después del primero, así que es una
     ampliación pagada desde esta wallet. 1 × 32M. */
  ok('se cuenta la ampliación', depositadoEnAmpliaciones(datos), 32e6);
  const d = desglosarSaldo(datos);
  // saldo 40 − ganado 60 − aportado 12 + depositado 32 = 0
  ok('y la cuenta cuadra', Math.round(d.resto), 0);
  ok('el depósito se enseña aparte', d.depositado, 32e6);
  okQue('así que no queda nada como «salido»', !d.restoVisible, String(d.resto));
}
{
  // Con el 12 en cola, el dinero ya ha salido de la wallet: dos ampliaciones.
  const datos = {
    estado: estadoCon([...ONCE, P(110500)]),
    ganancia: { saldo_wallet: 8e6, total: 60e6 },
    aportaciones: { total_pls: 12e6, aportaciones: [{ id: 1 }] },
  };
  ok('el que está en cola también cuenta', depositadoEnAmpliaciones(datos), 64e6);
  ok('y la cuenta sigue cuadrando', Math.round(desglosarSaldo(datos).resto), 0);
}
{
  // Sin datos de validadores no se descuenta nada: el lado seguro es volver al
  // comportamiento de antes, no inventarse un descuento.
  ok('sin detalle no se descuenta', depositadoEnAmpliaciones({ estado: {} }), 0);
}

console.log('\n=== 4. LA LÍNEA TEMPORAL ===');
{
  const { hitos, enCola } = hitosDesde([...ONCE, P(110500)], 0);
  ok('dos hitos con fecha', hitos.length, 2);
  ok('el primero, diez de golpe', hitos[0].indices.length, 10);
  ok('el segundo, uno solo', hitos[1].indices.length, 1);
  ok('y ese uno es el 109876', hitos[1].indices, [109876]);
  /* El orden es cronológico y el acumulado se lee de un vistazo: es la
     pregunta que dispara el panel —«¿cuántos había entonces?»—. */
  ok('acumulado 10 y 11', hitos.map(h => h.acumulado), [10, 11]);
  okQue('el primero es más antiguo', hitos[0].ts < hitos[1].ts);
  ok('el que espera va aparte, sin fecha', enCola.map(d => d.indice), [110500]);
}
{
  const html = panelHitos({ estado: estadoCon([...ONCE, P(110500)]) });
  okQue('se enseña «10 validadores»', /10 validadores/.test(html), '');
  okQue('y el hito abierto de la cola', /en cola/.test(html), '');
  okQue('con el índice del que espera', /110500/.test(html), '');
}
{
  // Todos en cola —el primer depósito de todos— no revienta ni miente.
  const html = panelHitos({ estado: estadoCon([P(1), P(2)]) });
  okQue('sin ninguna activación, se dice', /en cola|Ninguna activación/.test(html), '');
}

console.log('\n=== 5. EL RECIÉN LLEGADO NO ARRASTRA AL GRUPO ===');
{
  /* ⚠ ÉSTA ES LA COMPROBACIÓN QUE DISCRIMINA, y los números están elegidos para
     que discrimine. El riesgo que se vigila no es que el recién llegado salga
     marcado: es que ARRASTRE LA MEDIA HACIA ABAJO y TAPE a un rezagado de
     verdad, dejando a todos pareciendo mejores de lo que son.

     Diez a 5.000, un rezagado a 3.900 y uno en cola con 0:

       · bien (el de la cola fuera): referencia 4.890 → umbral 4.157 → 3.900
         cae por debajo y se marca. ✓
       · mal (el de la cola dentro): referencia 4.445 → umbral 3.778 → 3.900
         se salva y el rezagado pasa desapercibido.

     O sea que si alguien mete al pendiente en la comparación, esta prueba se
     pone roja. Con un rezagado más exagerado no lo haría. */
  const sanos = [...Array(10)].map((_, i) => A(109549 + i, 30, 5000));
  const cojo = A(109876, 30, 3900);
  const datos = {
    ahoraS: AHORA,
    estado: estadoCon([...sanos, cojo, P(110500)]),
    ganancia: { ciclos: [{ ts: AHORA - 3600 }], por_validador: {} },
    eventos: [{ ts: AHORA - 7200, tipo: 'aviso', validador: 110500,
                titulo: 'Validador 110500 en cola de activacion' }],
  };
  const html = panelValidadores(datos);
  okQue('el que espera se rotula como tal', /en cola de activación/.test(html), '');
  okQue('y se dice desde cuándo', /esperando 2 h/.test(html), '');
  okQue('el rezagado de verdad SIGUE saliendo pese al recién llegado',
    /rezagado/.test(html), 'el pendiente ha tapado al rezagado');
  okQue('y el pendiente no se cuenta como problema',
    !new RegExp('vfila mal[^>]*>\\s*<span class="v-id">110500').test(html), '');
}
{
  // Y sin ningún rezagado, no se inventa uno.
  const sanos = [...Array(11)].map((_, i) => A(109549 + i, 30, 5000));
  const datos = {
    ahoraS: AHORA, estado: estadoCon([...sanos, P(110500)]),
    ganancia: { ciclos: [{ ts: AHORA - 3600 }], por_validador: {} }, eventos: [],
  };
  okQue('con todos iguales, ninguno es rezagado',
    !/rezagado/.test(panelValidadores(datos)), '');
}

console.log('\n=== 6. EL QUE ESPERA A ENTRAR EN LA CADENA ===');
/* El estado un paso ANTES de la cola: hay keystore en el NUC y la beacon API
   no devuelve nada para esa pubkey. Hasta el 10-sep-2026 el recolector lo
   descartaba y el panel no tenía absolutamente nada que enseñar durante las
   12-18 h que tarda la cadena en adoptar el depósito. */
const PKL = '0xb7c31d55aa0099887766554433221100ffeeddccbbaa99887766554433221100aa';
/** Uno con clave en disco y sin respuesta de la cadena. */
const E = (pk = PKL, desde = null) => ({
  indice: null, pubkey: pk, pubkey_corta: `${pk.slice(0, 8)}…${pk.slice(-6)}`,
  estado: 'esperando', pendiente: true, esperando: true,
  balance: null, ganado: null, slashed: false,
  activacion_ts: null, activation_epoch: null, en_cola_desde_ts: desde,
});

/* `total` cuenta SOLO lo que la cadena conoce — de ahí sale
   `deposito = stake_total / total`— y `claves` lo que hay en el disco. */
const conEspera = (enCadena, esperan) => ({
  generado_ts: AHORA - 60, salud: 'ok',
  validadores: {
    total: enCadena.length,
    activos: enCadena.filter(d => d.estado.startsWith('active')).length,
    pendientes: enCadena.filter(d => d.pendiente).length,
    esperando: esperan.length,
    claves: enCadena.length + esperan.length,
    slashed: 0,
    stake_total: DEPOSITO * enCadena.length,
    detalle: [...enCadena, ...esperan],
  },
  nodo: { sincronizado: true, optimistic: false },
});

{
  const estado = conEspera(ONCE, [E()]);
  const s = saludGlobal({ sesion: true, ahoraS: AHORA, estado });
  ok('nada va mal por esperar', [s.palabra, s.tono], ['OPERATIVO', 'ok']);
  okQue('y se dice con esas palabras',
    /Un validador esperando a entrar en la cadena/.test(s.nota || ''), s.nota);
  okQue('sin llamarlo «en cola», que es otra cosa',
    !/en cola/.test(s.nota || ''), s.nota);
}
{
  // Las dos esperas a la vez, que es lo que pasa si amplías de dos en dos.
  const s = saludGlobal({ sesion: true, ahoraS: AHORA,
    estado: conEspera([...ONCE, P(110500)], [E()]) });
  okQue('las dos esperas se distinguen en la misma frase',
    /esperando a entrar en la cadena/.test(s.nota) && /en cola de activación/.test(s.nota),
    s.nota);
  ok('y sigue sin ser un aviso', s.tono, 'ok');
}
{
  // Un caído de verdad manda sobre las dos.
  const s = saludGlobal({ sesion: true, ahoraS: AHORA,
    estado: conEspera([...ONCE.slice(0, 10), X(109876)], [E()]) });
  ok('un caído sigue mandando', s.palabra, 'AVISO');
}

{
  const nodos = nodosDesde(conEspera(ONCE, [E()]).validadores.detalle, {});
  ok('la esfera enseña doce nodos', nodos.length, 12);
  /* ⚠ EL ORDEN IMPORTA MÁS DE LO QUE PARECE. Las posiciones se reparten por el
     orden del array, y `Number(null)` es 0 —no NaN—: sin ordenar a propósito,
     el nodo nuevo se colaba en la PRIMERA posición y movía de sitio a los once
     que ya estaban, sin que hubiera pasado nada. */
  ok('y el que espera va el último', nodos[11].indice, null);
  ok('los once de siempre no se mueven', nodos[0].indice, 109549);
  ok('el que espera late', nodos[11].pendiente, true);
  ok('marcado como lo que es', nodos[11].esperando, true);
  ok('y no como activo', nodos[11].activo, false);
  okQue('con su pubkey para poder nombrarlo', /…/.test(nodos[11].pubkeyCorta || ''), '');
  okQue('los demás no laten', nodos.filter(n => n.pendiente).length === 1);
}

{
  const { hitos, enCola, esperando } = hitosDesde(conEspera(ONCE, [E()]).validadores.detalle, 0);
  ok('los hitos con fecha no cambian', hitos.length, 2);
  ok('el que espera va aparte de la cola', esperando.length, 1);
  ok('y la cola sigue vacía', enCola.length, 0);
  const html = panelHitos({ estado: conEspera(ONCE, [E()]) });
  okQue('la línea temporal lo enseña', /esperando a entrar en la cadena/.test(html), '');
  okQue('llamándolo por su clave, que es lo único que tiene',
    /0xb7c31d/.test(html), '');
}

{
  // Once iguales: así el «1 con aviso» que se vigila abajo solo puede venir
  // del que espera, que es justo lo que hay que descartar.
  const iguales = [...Array(11)].map((_, i) => A(109549 + i, 30, 5000));
  const datos = {
    ahoraS: AHORA,
    estado: conEspera(iguales, [E(PKL, AHORA - 3 * 3600)]),
    ganancia: { ciclos: [{ ts: AHORA - 3600 }], por_validador: {} },
    eventos: [],
  };
  const html = panelValidadores(datos);
  okQue('la tabla lo enseña', /esperando a entrar en la cadena/.test(html), '');
  okQue('y desde cuándo, del campo del recolector',
    /esperando a entrar en la cadena · 3 h/.test(html), '');
  okQue('sin repetir «esperando» dos veces en la misma nota',
    !/esperando a entrar en la cadena · esperando/.test(html), '');
  /* ⚠ SIN ENLACE. El explorador indexa por índice y éste no tiene: el enlace
     sería `/validator/null` y llevaría a un 404. Se pinta como `div`. */
  okQue('sin enlace al explorador, que sería un 404',
    !/validator\/null/.test(html), 'hay un enlace a /validator/null');
  okQue('y no como fila enfocable', /<div class="vfila espera"/.test(html), '');
  okQue('no se le inventa un balance', !/>0<\/span>\s*<span class="v-nota espera/.test(html), '');
  okQue('y no cuenta como problema', !/1 con aviso/.test(html), '');
}
{
  // El de verdad: que no tape a un rezagado, igual que el de la cola.
  const sanos = [...Array(10)].map((_, i) => A(109549 + i, 30, 5000));
  const cojo = A(109876, 30, 3900);
  const html = panelValidadores({
    ahoraS: AHORA, estado: conEspera([...sanos, cojo], [E()]),
    ganancia: { ciclos: [{ ts: AHORA - 3600 }], por_validador: {} }, eventos: [],
  });
  okQue('el rezagado de verdad SIGUE saliendo', /rezagado/.test(html), '');
}

{
  /* ⚠ EL OBJETIVO NO PUEDE PARPADEAR. `total` son los que conoce la cadena, así
     que sin sumar el que espera el título decía «Validador #12» mientras el
     #12 estaba entrando, y saltaba a #13 al adoptarlo. */
  ok('el objetivo cuenta el que ya has depositado',
    tituloObjetivo(conEspera(ONCE, [E()])), 'Validador #13');
  ok('y no cambia cuando la cadena lo adopta',
    tituloObjetivo(conEspera([...ONCE, P(110500)], [])), 'Validador #13');
  ok('sin nadie esperando, como siempre',
    tituloObjetivo(conEspera(ONCE, [])), 'Validador #12');
}

{
  /* El dinero: si has depositado, la wallet bajó 32M. Sin contarlo, el panel
     diría que se han ido 32M — el fallo que ya se arregló para los de la cola,
     un paso antes. */
  const datos = {
    estado: conEspera(ONCE, [E()]),
    ganancia: { saldo_wallet: 8e6, total: 60e6 },
    aportaciones: { total_pls: 12e6, aportaciones: [{ id: 1 }] },
  };
  ok('el que espera cuenta como depósito', depositadoEnAmpliaciones(datos), 64e6);
  ok('y la cuenta cuadra', Math.round(desglosarSaldo(datos).resto), 0);
  okQue('así que nada aparece como «salido»', !desglosarSaldo(datos).restoVisible, '');
}

console.log('\n' + '='.repeat(52));
console.log(fallos ? `FALLAN ${fallos} de ${pruebas}` : `TODO CORRECTO (${pruebas})`);
process.exit(fallos ? 1 : 0);
