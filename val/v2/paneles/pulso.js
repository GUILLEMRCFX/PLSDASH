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
 * el panel además solo se refresca cada 18 s. Echando la cuenta, entre las dos
 * cosas se van del orden de 30-45 s de cada 180 — un cuarto del ciclo. Sin
 * margen, el pulso se pondría naranja durante ese cuarto EN CADA PASADA, y en
 * dos días nadie miraría ya el color.
 *
 * (Los 30-45 s son una estimación de sobremesa, no una medida: lo que tarda el
 * recolector no se publica en ningún sitio. El margen se ha puesto en 60 s para
 * cubrirla con holgura. Si alguna vez se instrumenta el recolector, este número
 * se puede afinar con datos.)
 *
 * Con margen, «naranja» significa de verdad que algo pasa: son ya cuatro
 * minutos sin señal, más de una pasada perdida.
 *
 * El tramo entre que la cuenta llega a cero y se agota el margen se rotula
 * «llegando» y sigue en verde, porque eso es exactamente lo que está pasando.
 *
 * ## Cómo se usa
 *
 * `htmlPulso(datos, alFinal)` para pintarlo con el resto del panel. `alFinal`
 * es HTML que se cuela al final de su primera línea: lo usa «Resumen» para
 * meter ahí la palabra de estado. Sin esa ranura, el pulso y la palabra eran
 * dos hermanos de una fila flexible y la línea de tiempo se quedaba a media
 * anchura de la tarjeta — que es justo lo que hace que no se pueda leer de
 * reojo.
 *
 * `htmlPulso(datos)` a secas y `latir(raiz)` en
 * un intervalo de un segundo para que los dígitos corran. `latir` no repinta el
 * panel: reescribe solo este nodo, leyendo `Date.now()` en vivo y el
 * `generado_ts` que el propio nodo lleva guardado en su `dataset`. Así el
 * contador avanza segundo a segundo aunque los datos solo se recarguen cada 20.
 */

/** Cada cuánto empuja el NUC. Es el cron, y no se toca desde aquí. */
export const PERIODO_S = 180;

/** Margen antes de declararlo tarde. Ver la nota de arriba. */
export const GRACIA_S = 60;

/** La ventana entera que dibuja la línea de tiempo: plazo más margen. */
export const VENTANA_S = PERIODO_S + GRACIA_S;

/** Dónde cae el final del plazo dentro de esa ventana, en tanto por uno.
 *  Es la marca de la línea: a su izquierda el dato viene con tiempo, a su
 *  derecha está entrando, y pasada la línea entera es que no llega. */
export const MARCA = PERIODO_S / VENTANA_S;

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
  // Posición sobre la ventana entera —plazo más margen—, de 0 a 1. Es lo que
  // dibuja la línea de tiempo: el hueco recorrido a la izquierda del cursor es
  // tiempo transcurrido de verdad, no una barra de progreso decorativa.
  const avance = Math.max(0, Math.min(1, edad / VENTANA_S));

  if (falta > 0) {
    return {
      tarde: false, avance, eti: 'Dato nuevo en', resto: reloj(falta),
      aria: `Próximo dato del NUC en ${reloj(falta)}.`,
    };
  }
  if (edad <= VENTANA_S) {
    return {
      tarde: false, avance, eti: 'Dato nuevo', resto: 'llegando',
      aria: 'El NUC está en plazo; el dato nuevo está entrando.',
    };
  }
  return {
    tarde: true, avance: 1, eti: 'Sin señal desde hace', resto: reloj(edad),
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
export function htmlPulso(datos, alFinal = '') {
  const ts = Number(datos?.estado?.generado_ts) || 0;
  const p = estadoPulso(ts, Math.floor(Date.now() / 1000));
  return `
    <div class="pulso${p.tarde ? ' tarde' : ''}" id="pulso" data-ts="${ts}"
         role="status" aria-live="polite" aria-label="${p.aria}">
      <div class="pl-cab">
        <i class="luz" aria-hidden="true"></i>
        <span class="p-eti">${p.eti}</span>
        <b class="resto">${p.resto}</b>
        ${alFinal}
      </div>
      <!-- La línea de tiempo. Va oculta a los lectores de pantalla porque no
           añade nada a lo que la etiqueta de arriba ya dice en palabras: es la
           misma cuenta, dibujada. La marca es el final del plazo del cron.
           (Sin acentos graves aquí dentro: cerrarían la plantilla. Es la
           tercera vez que pasa; por eso queda escrito.) -->
      <div class="pl-linea" aria-hidden="true">
        <span class="pl-lleno" style="width:${(p.avance * 100).toFixed(1)}%"></span>
        <i class="pl-marca" style="left:${(MARCA * 100).toFixed(1)}%"></i>
      </div>
    </div>`;
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
  const lleno = el.querySelector('.pl-lleno');
  if (eti && eti.textContent !== p.eti) eti.textContent = p.eti;
  if (resto && resto.textContent !== p.resto) resto.textContent = p.resto;
  // El ancho se escribe cada segundo; la transición del CSS lo lleva de un
  // punto al siguiente para que avance liso en vez de a saltos de segundo.
  if (lleno) lleno.style.width = `${(p.avance * 100).toFixed(1)}%`;
  return p.tarde ? 'tarde' : 'ok';
}
