/**
 * Pulso de datos — la cuenta atrás que también es la alarma.
 *
 * El NUC empuja su estado a KV cada 3 minutos (cron). Este contador va hacia
 * atrás desde `estado.generado_ts` hasta el siguiente empujón esperado. Cuando
 * la cuenta se agota y no ha entrado dato nuevo, **el mismo contador se
 * convierte en el aviso**: cambia de verde a naranja, acelera el latido y pasa
 * a contar hacia arriba desde la última señal.
 *
 * No hay un aviso aparte. Un elemento que cambia de estado se aprende una vez;
 * dos elementos —uno que cuenta y otro que avisa— obligan a mirar los dos y a
 * recordar cuál manda.
 *
 * ## Por qué hay margen de gracia
 *
 * `generado_ts + 180` es cuando el cron *arranca*, no cuando el dato *llega*:
 * entre medias el recolector consulta el beacon, el explorador y DexScreener, y
 * el panel además solo se refresca cada 15-20 s. Sin margen, el pulso se
 * pondría naranja en cada ciclo durante los segundos que tarda el relevo — un
 * 15-25% del tiempo — y en dos días nadie miraría ya el color.
 *
 * Con margen, «naranja» significa de verdad que algo pasa: son ya cuatro
 * minutos sin señal, más de una pasada perdida.
 *
 * El tramo entre que la cuenta llega a cero y se agota el margen se rotula
 * «llegando» y sigue en verde, porque eso es exactamente lo que está pasando.
 *
 * ## Cómo se usa
 *
 * `htmlPulso(datos)` para pintarlo con el resto del panel, y `latir(raiz)` en
 * un intervalo de un segundo para que los dígitos corran. `latir` no repinta el
 * panel: reescribe solo este nodo, leyendo `Date.now()` en vivo y el
 * `generado_ts` que el propio nodo lleva guardado en su `dataset`. Así el
 * contador avanza segundo a segundo aunque los datos solo se recarguen cada 20.
 */

/** Cada cuánto empuja el NUC. Es el cron, y no se toca desde aquí. */
export const PERIODO_S = 180;

/** Margen antes de declararlo tarde. Ver la nota de arriba. */
export const GRACIA_S = 60;

/** Segundos → «1:23» o «12:04». Siempre con dos dígitos de segundos. */
function reloj(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * El estado del pulso en un instante dado.
 *
 * Pura y exportada a propósito: es la única regla que decide si esto es un
 * contador o una alarma, y se prueba sin DOM.
 *
 * @param {number|null} generadoTs  `estado.generado_ts`, en segundos.
 * @param {number}      ahoraS      Instante actual, en segundos.
 * @returns {{tarde:boolean, eti:string, resto:string, aria:string}}
 */
export function estadoPulso(generadoTs, ahoraS) {
  const ts = Number(generadoTs);
  if (!Number.isFinite(ts) || ts <= 0) {
    return {
      tarde: true, eti: 'Sin contacto', resto: '—',
      aria: 'Sin contacto con el NUC: no hay marca de tiempo del último dato.',
    };
  }

  const edad = ahoraS - ts;
  const falta = PERIODO_S - edad;

  if (falta > 0) {
    return {
      tarde: false, eti: 'Dato nuevo en', resto: reloj(falta),
      aria: `Próximo dato del NUC en ${reloj(falta)}.`,
    };
  }
  if (edad <= PERIODO_S + GRACIA_S) {
    return {
      tarde: false, eti: 'Dato nuevo', resto: 'llegando',
      aria: 'El NUC está en plazo; el dato nuevo está entrando.',
    };
  }
  return {
    tarde: true, eti: 'Sin señal desde hace', resto: reloj(edad),
    aria: `El NUC no reporta desde hace ${reloj(edad)}. Lo que ves es el último dato bueno.`,
  };
}

/**
 * El nodo del pulso, listo para incrustar.
 *
 * `aria-live="polite"` y no `assertive`: el cambio a naranja merece anunciarse,
 * pero no interrumpir a media frase — el dato de la pantalla sigue siendo
 * válido, solo es viejo.
 */
export function htmlPulso(datos) {
  const ts = Number(datos?.estado?.generado_ts) || 0;
  const p = estadoPulso(ts, Math.floor(Date.now() / 1000));
  return `
    <p class="pulso${p.tarde ? ' tarde' : ''}" id="pulso" data-ts="${ts}"
       role="status" aria-live="polite" aria-label="${p.aria}">
      <i class="luz" aria-hidden="true"></i>
      <span class="p-eti">${p.eti}</span>
      <b class="resto">${p.resto}</b>
    </p>`;
}

/**
 * Un tic. Reescribe solo el nodo del pulso.
 *
 * @returns {'ok'|'tarde'|null} el estado tras el tic, o `null` si el pulso no
 *   está en pantalla. Quien lo llame puede comparar con el tic anterior y
 *   repintar cuando cambie: el resto del panel —la palabra de estado, la
 *   franja de alerta— solo se recalcula cada 18 s, y sin ese aviso habría
 *   hasta 18 segundos con el pulso en naranja y la cabecera diciendo
 *   «OPERATIVO» en verde. Es la misma contradicción que se arregló entre el
 *   pulso y `saludGlobal()`, pero por retraso en vez de por umbral.
 */
export function latir(raiz = document) {
  const el = raiz.querySelector('#pulso');
  if (!el) return null;

  const p = estadoPulso(Number(el.dataset.ts), Math.floor(Date.now() / 1000));
  el.classList.toggle('tarde', p.tarde);
  el.setAttribute('aria-label', p.aria);

  // Solo se tocan los nodos que cambian. Reescribir el `innerHTML` entero
  // reiniciaría la animación del latido en cada segundo y el punto se quedaría
  // congelado a mitad de onda.
  const eti = el.querySelector('.p-eti');
  const resto = el.querySelector('.resto');
  if (eti && eti.textContent !== p.eti) eti.textContent = p.eti;
  if (resto && resto.textContent !== p.resto) resto.textContent = p.resto;
  return p.tarde ? 'tarde' : 'ok';
}
