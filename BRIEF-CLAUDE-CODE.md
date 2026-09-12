# Brief — PLSDASH

> Documento de traspaso. `README.md` describe **qué hay**; esto, **por qué es
> así**, qué trampas tiene y cómo se trabaja aquí.
>
> Empezó siendo un encargo de «lo que hay que construir». Está construido, así
> que ahora cuenta lo que se aprendió construyéndolo — que vale más que la
> descripción, porque la descripción se deduce del código y esto no.

**Última revisión: 8-sep-2026.** Si algo de aquí no cuadra con el código, manda
el código: ábrelo y corrige esto.

---

## Qué es esto

Un despliegue de Cloudflare Pages con dos mitades: la portada pública de
cartera (`/`) y el panel privado del validador (`/val/`, detrás de PIN).

Las tres preguntas que el panel tiene que responder en dos segundos:

1. **¿Está todo bien?** Si un validador cae, se pierde dinero cada minuto.
2. **¿Cuánto llevo ganado?**
3. **¿Voy bien?**

## El montaje

| Pieza | Dónde |
|---|---|
| Cuenta Cloudflare | `43fcbb2325e70c196b56d6759046fa55` |
| KV `PLSDASH_KV` | `05fb9dd64a104e48ab5f4d2f324efd9d` |
| D1 `validator-dashboard` | `8631f448-e656-4dca-b8a9-78fb7a8bb06a` (WEUR) |
| Proyecto Pages | `plsdash`, repo `GUILLEMRCFX/PLSDASH`, auto-deploy desde `main` |
| Estado actual del panel | KV, clave `validator:estado` |

**En el NUC** (servidor doméstico, Ubuntu 24.04), cron cada 3 minutos:

- **`collector.py`** — lee Lighthouse (`localhost:5052`) y Prometheus
  (`localhost:9099`) y compone el estado.
- **`push.py`** — publica en KV y guarda histórico en D1. Detecta eventos
  comparando con la ejecución anterior.

Los demás (`comprobar.py`, `explorador.py`, `validacion.py`,
`precio_y_bloques.py`) son herramientas de mano, no cron.

### Los validadores se descubren solos

`collector.py` lee los keystores de `/blockchain/validator_keys/keystore-*.json`
y saca las pubkeys del disco. **Antes era una lista fija y el undécimo se quedó
fuera sin que nadie lo notara**: los diez seguían saliendo bien.

### Tres estados, no dos

La beacon API se consulta **por pubkey**, y devuelve solo las que conoce: las
demás las omite, sin error de ninguna clase. Así que un validador recién
depositado desaparecía del panel durante las 12-18 h que tarda la cadena en
adoptarlo. El dato existía en el disco de la misma máquina —el keystore— y no
se estaba usando. Es la misma cuenta que hace Lighthouse al decir
`total_validators: 12, active_validators: 11`.

| estado | qué es | cómo se detecta |
|---|---|---|
| `esperando` | clave en el disco, la cadena no la conoce | las pubkeys locales que la beacon API no devuelve |
| `pendiente` | la cadena lo conoce, sin turno de activación | `status` empieza por `pending_` |
| activo | validando | `status` empieza por `active` |

Los campos que se publican: `total` (los que conoce la cadena), `pendientes`,
`esperando` y `claves` (= `total + esperando`). Un `esperando` va en `detalle`
con `indice: null`, sin balance y con `pendiente: true`.

⚠ **El dinero NO cuenta al que espera.** Un keystore no demuestra un depósito
—se generan antes de depositar—, así que `stake_total`, `balance_total` y
`ganado_total` siguen contando solo lo que la cadena confirma. De ahí que
`deposito = stake_total / total` siga dando 32M exactos, que es de donde salen
el objetivo del panel y el aviso de «ya tienes para uno entero».

**Desde cuándo espera** lo lleva `push.py`, no la cadena: recuerda entre
ejecuciones cuándo vio esa **pubkey** por primera vez y lo publica en
`en_cola_desde_ts`. Por pubkey y no por índice a propósito — el índice no existe
hasta que la cadena adopta el depósito, y llevarlo por índice pondría el reloj a
cero justo en ese momento.

Datos reales: activados el **7-ago-2026 a las 09:45 UTC**
(`ACTIVACION_TS = 1786095955`), 32.000.000 PLS por validador, wallet de retirada
`0x952E0311DdDCe7090d61a275f411a6ddF879BDc8`.

---

## Las trampas

Esto es lo que de verdad hay que leer antes de tocar nada. Cada una costó
tiempo, y varias pasaron desapercibidas porque **el síntoma era plausible**.

### De los datos

**Las bajadas de balance son barridos del protocolo, nunca datos corruptos.**
Cada ~8,1 h el protocolo retira el sobrante de los 32M a la wallet y el
contador vuelve a cero. `snapshots.ganado` **no es lo ganado**: es el excedente
sin barrer. La ganancia real son las retiradas acumuladas más ese excedente, y
la reconcilia `/api/val/ganancia` contra la cadena. Si ves una serie que baja,
no la «arregles».

**Los índices de validador no son correlativos. Nunca uses rangos.** El
undécimo recibió el **109876**, no el 109559: entre un depósito y el siguiente
entraron cientos de validadores más en la cola. Cualquier cosa del tipo
`109549..109559` deja fuera al undécimo y no da ningún error.

**`pls_hora` y `apr` son `NULL` a propósito.** Hasta el 18-ago-2026 el
recolector publicaba `pls_hora = ganado_total / horas_activo` y el APR derivado.
Mal por los dos lados: el numerador es el excedente, que vuelve a cero cada
8,1 h —medido en D1: `0,217 → 0 → 0,029 → 0,061 → 0,09 → 0,119`, y el cero es
justo después del barrido— y el denominador eran las horas desde la activación
más antigua del grupo, que se diluye en cuanto uno lleva once días y otro unas
horas. El APR se calcula ahora en `aprValidadorHora()`, ponderando por
validador-hora.

**`daily.ganado_dia` y `ganado_acum` están rotos.** Guardan el excedente que
había a medianoche, no lo ganado en la jornada: para el 15-ago-2026 anotan `0`
cuando el día real fueron 68.253 PLS. `diarioReal()` recompone los días desde la
serie en vez de leer esa columna.

**`validador_diario` no tiene lector, y no se borra.** Su único consumidor era
`/api/val/validadores`, retirado con el v1. Se conserva a sabiendas: es el
**único** histórico por validador y por día que existe —`snapshots` solo guarda
agregados del grupo y KV solo el instante actual— y borrarla es irreversible.
`push.py` la sigue llenando sin coste. Cambiar código muerto por dato perdido es
un mal trato. **Saldrá como muerta en cualquier auditoría automática. No lo
está: es un archivo.**

**El precio de un día pasado no se puede reconstruir.** No hay serie histórica
por token en ninguna parte. Si no se guarda cuando pasa, se pierde —
`barridos.precio_pls` se quedó a `NULL` en 484 filas y ya no vuelve. Por eso
`snapshots.precio_pls` se escribe en cada snapshot y las aportaciones guardan el
precio al apuntarlas. Un `NULL` ahí es un hueco honesto; un cero sería mentira.

**`eventos` lleva un índice único con `COALESCE`**, y no es adorno:

```sql
CREATE UNIQUE INDEX ix_eventos_unico
  ON eventos (ts, tipo, COALESCE(validador, -1));
```

En SQLite dos `NULL` no se consideran iguales a efectos de índice único, y
`validador` es `NULL` en todos los barridos: un índice sobre la columna a pelo
habría dejado pasar justo el duplicado que hubo que limpiar.

**Las tres direcciones de stablecoin de `functions/api/inversiones.js` están sin
verificar contra el explorador.** El modo de fallo sí está garantizado: se
comprueba dirección **y** símbolo, así que una dirección mala manda esa entrada
a descuadres —visible y arreglable— y nunca produce un importe en dólares
inventado. Pero mientras no se confirmen, los resúmenes semanales pueden estar
cortos.

> El `PRECIO_SACRIFICIO` **sí** está confirmado: **0,0001 $**, comprobado contra
> el gráfico de WPLS/DAI. Estuvo un tiempo a 0,001 —un cero de menos, tecleado a
> mano en la tabla de ajustes— y el panel daba −98,6 % y ×70 donde debía dar
> −85,7 % y ×7,0. Un factor de diez en la cifra de cabecera que nadie vio porque
> un campo de texto acepta lo que le pongas. Hoy es una constante y hay una
> prueba que exige que viva en un solo sitio.

### Del código

**Un dato que legítimamente no existe, metido en una conversión que da por hecho
que sí, mata al recolector entero.** Ha pasado dos veces con la misma forma:
`epoch_a_fecha(2^64-1)` lanzaba `OverflowError`, e `int(d["indice"])` lanza
`TypeError` cuando el validador aún no tiene índice. Ninguna de las dos está
envuelta en su bucle, así que la excepción sube hasta arriba y **no se publica
nada** — el panel se queda DESFASADO durante toda la espera, que es justo
cuando más se mira. Antes de meter un campo nuevo que pueda venir a `None`,
buscar todos los `int(...)`, `round(...)` y rebanadas que lo tocan; el que se
escapó la segunda vez estaba en `imprimir_resumen`, o sea en `--resumen`, que es
lo primero que se ejecuta a mano cuando algo va raro.

**Una comilla inversa dentro de un comentario que vive dentro de una plantilla
ha tumbado la página nueve veces.** La comilla cierra la plantilla, el resto del
fichero se lee como código y el módulo revienta con un error que no señala al
comentario. Pasa sobre todo en comentarios HTML (`<!-- … -->`) y GLSL dentro de
literales. `pruebas/sintaxis-test.mjs` lo caza.

**Un dato codificado en el TAMAÑO de algo en 3D compite con la perspectiva, y
la perspectiva suele ganar.** Los nodos de la esfera cifran los bloques
propuestos en su tamaño. Medido en píxeles, la diferencia entre el validador
con 0 bloques y el que tiene 13 era de **1,17×**, enterrada bajo un **1,61×**
que solo dependía de en qué cara de la esfera hubiera caído el nodo —la cámara
está a 3,05 y la esfera tiene radio 1—. El ruido era tres veces y media la
señal. Antes de calibrar nada que se dibuje en perspectiva, **medir primero
cuánto ruido mete la profundidad**, con una pasada de control en la que todos
los elementos valen lo mismo. Se corrige escalando el quad por su propia
profundidad (`COMPENSA_PROF`).

**Una escala normalizada por el máximo se degrada sola.** La misma esfera
dividía los bloques por el máximo del grupo: con un rango de 1 a 7, un bloque
de diferencia movía 1/7 de la escala; con 0 a 13 mueve 1/13; con 5 a 30 movería
1/30. Cuanto más tiempo lleva el sistema funcionando, menos se distingue nada,
y toca recalibrar cada pocos meses. Comparar contra la **mediana** del grupo no
tiene ese problema y además no se lo lleva por delante un caso con suerte. Y el
suelo para que el mínimo siga viéndose va en la GEOMETRÍA, no en el mapeo del
dato: puesto en el mapeo se comía el 28 % de la escala antes de empezar.

**`Number(null)` es `0`, no `NaN`.** Un `.sort((a, b) => Number(a.indice) -
Number(b.indice))` con un índice ausente no deja el elemento donde estaba: lo
manda al principio. En la esfera, eso metía al validador nuevo en la primera
posición y movía de sitio a los once que ya estaban, sin que hubiera pasado
nada. Donde un campo pueda faltar, el comparador tiene que decirlo a mano
(`d.indice == null ? Infinity : Number(d.indice)`).

**Una llave `}` de más o de menos en CSS no da error de sintaxis.** El navegador
cierra el bloque por su cuenta y sigue, así que lo que se ve es que una regla
deja de aplicarse en un sitio y aparece en otro. Al quitar un `@media` obsoleto
se quedó una llave suelta y una línea del panel encogió de 475 a 392 px sin que
nada se quejara. La suite cuenta llaves ignorando cadenas y comentarios.

**Un endpoint puede estar vivo sin que su URL aparezca en ningún fichero.** El
v1 pedía `api('/validadores')`, con un ayudante que concatenaba por dentro: el
literal «api/val/validadores» no existía en el repositorio y un `grep` no lo
encontraba jamás. Se borraron dos endpoints por muertos y hubo que restaurarlos.
Peor todavía el de logout: la llamada iba en un `try/catch`, así que sin
endpoint el botón seguía navegando y la cookie no se borraba — **parecía** que
cerrabas sesión.
**Antes de borrar cualquier endpoint, pasa `pruebas/rutas-test.mjs`**, que
reconstruye las URL como las reconstruye el navegador.

**`_routes.json` no controla qué se sirve como estático.** Decide dónde corre el
runtime de Functions, nada más. Lo demuestra el propio repositorio:
`/val/v2/paneles/*` está en `exclude` y el navegador lo descarga en cada carga.
Igual `pruebas/`, `nuc/` y `migraciones/`: son descargables. No hay credenciales
en ellos —el NUC las lee de su `.env`— pero conviene saberlo.

**La regla del navegador para `[hidden]` es
`[hidden]:not([hidden="until-found"])`**: dos atributos, así que le gana a una
clase pero pierde contra un id. En cuanto `#v-esfera` se llevó su propio
`display`, la esfera dejó de esconderse y seguía dibujándose al pie de las otras
pestañas, gastando GPU en algo que nadie miraba.

**`input[type=range]` no mueve el tirador de 0 % a 100 %** del ancho: lo mueve
entre los centros de las posiciones extremas, con medio tirador de margen a cada
lado. Una marca colocada con `left: X%` queda hasta 10 px del tirador que dice
marcar.

**En iOS, Safari y la app instalada tienen cachés separadas.** Entró la hoja
nueva en la app y se quedó la vieja en Safari: marcado nuevo maquetado con
reglas viejas. `_headers` ya manda `no-cache` y aun así ocurrió, así que
`vigilarHoja()` en `val/v2/index.html` lo detecta y vuelve a pedir la hoja.

**`env(safe-area-inset-*)` puede devolver 0 en una PWA instalada.** Por eso las
áreas seguras van con `max(…, suelo)` y no a pelo.

**`scrollend` no siempre llega.** Puede no dispararse nunca si el desplazamiento
acaba fuera del hilo principal, así que el temporizador de reposo va **siempre**
y `scrollend` solo sirve para expandir antes.

### De las pruebas

**Espera activa para lo positivo, espera fija para lo negativo.** Un
`waitForTimeout` fijo acierta con la máquina descansada y falla una de cada tres
cuando va cargada —`vault-test` estuvo así semanas—. Pero a algo que **no** debe
ocurrir no se le puede esperar: ahí hay que dar tiempo de sobra y comprobar que
no pasó.

**Playwright prueba las rutas de la ÚLTIMA registrada a la primera.** El comodín
va primero para que el caso concreto le gane; al revés se lo come y la vista
recibe `{}`.

**Una prueba que no falla al romper lo que vigila no vale.** Antes de dar una por
buena, rómpela a propósito y mira que se pone roja **por el motivo correcto**.

**Y una prueba que grita en todo lo que mira no la mira nadie.** La primera
versión del detector de comillas inversas señalaba 38 ficheros sanos llenos de
JSDoc correctos.

---

## Decisiones tomadas, para no volver a discutirlas

- **Nada de números vivos escritos a fuego.** El v1 tenía
  `const V11 = 32_000_000`: el día que cambie el depósito, miente y nadie se
  entera. El depósito se calcula (`stake_total / total`) y el objetivo es
  `total + 1`. La detección de depósitos de validador en Inversiones busca la
  **forma** —varios envíos iguales al mismo destino— y no la cifra, justamente
  por esto. Un hecho cerrado del pasado sí puede ser constante: el precio del
  sacrificio ocurrió una vez.
- **El deslizador del simulador va en dólares, no en euros.** El v1 dividía
  euros entre un precio en dólares, o sea daba por hecho que 1 € = 1 $. Hacerlo
  bien exige un tipo de cambio real: otra fuente que se cae y hay que vigilar.
- **Sin bloqueo por intentos de PIN**, decisión explícita: el panel no está
  enlazado y es de solo lectura. Lo cubre una regla de Cloudflare sobre
  `/api/val/auth`, configurada fuera del repositorio. **El PIN de 4 dígitos se
  queda como está.**
- **El color nunca viaja solo.** Verde y naranja se distinguen mal bajo
  deuteranopía, así que todo estado lleva su palabra al lado.
- **La esfera es decoración con dato**, y el mismo dato está en la tabla de
  Validadores, que sí se puede leer y recorrer.

### Lo que se descartó, y por qué

- **Efectividad y atestaciones perdidas** — engañosas tal y como se presentaban
  en el v1, y el coste de lo fallado era del orden de milésimas del total. (Las
  cifras exactas estaban en una prueba que se perdió; el motivo de descartarlo
  no depende de ellas.)
- **Comparativa de percentil contra la red** — pediría datos de 109.000
  validadores. Se sustituyó por la comparación contra la media propia.
- **Modo kiosco** — no hay monitor dedicado.
- **Panel de concentración de riesgo** y **coste de apagón** — no cambian; van
  como nota fija y como campo del registro.
- **Animación de pulso / latido ECG** — rechazada por poco profesional. (El
  pulso de datos que hay hoy es otra cosa: dice si el NUC reporta.)

---

## Cómo se trabaja aquí

### Reglas de proceso — han costado seis veces

> **Todos los commits subidos ANTES de abrir el PR. Y PR abierto es PR cerrado:
> lo que venga después va en uno nuevo.**

Se saltó seis veces, y cada una costó un día de desconcierto mirando producción
y preguntándose por qué no cambiaba nada: los commits añadidos después de que el
PR se fusionara se quedaron huérfanos, y el trabajo parecía desplegado sin
estarlo. Si hay que añadir algo, se abre otro PR.

- **Todos los PR contra `main`.** Nada de encadenar uno sobre otro.
- **Si un cambio retira la única alternativa a algo, va en su propio commit**,
  para poder revertir solo eso. Así se hizo al retirar el v1: la puerta en un
  commit, el borrado en otro.
- **Antes de dar algo por bueno visualmente**, ábrelo, hazte captura a 1440 y a
  390 y **mírala tú**. Las dos correcciones de la puerta del PIN —el `⌫` que
  Inter no tiene y salía como un rectángulo tachado, y el aro de foco que hacía
  parecer pulsado el «1»— salieron de mirar la captura, no de mandarla.
- **Si algo cuesta caro, dilo con el dato medido.** Y si no se ha podido medir,
  dilo también: es mejor que un número inventado.

### La suite

```bash
./pruebas/correr.sh              # todo
./pruebas/correr.sh wallets      # solo lo que case
```

Sale con 0 solo si pasa todo, así que vale para un gancho de pre-push. Ocho
ficheros, ~208 comprobaciones; cuatro no necesitan navegador.

**Vive dentro del repositorio a propósito.** Estuvo en el directorio de trabajo
de la sesión y se perdió entera **dos veces** al reiniciarse el contenedor; la
segunda se llevó trabajo del mismo día. Una prueba que no está en el repositorio
no existe.

### Convenciones

- Vanilla HTML/CSS/JS, sin frameworks y sin build.
- Comentarios en español, y los `⚠` marcan las trampas: **ésos no se borran**.
  Cuentan qué fallo real hizo nacer la línea de al lado.
- Auto-deploy al fusionar en `main`.

---

## Lo que queda pendiente

| | |
|---|---|
| **Verificar las tres direcciones de stablecoin** de `inversiones.js` contra el explorador | lo más urgente: afecta a cifras que se enseñan |
| **Confirmar el contrato de depósito** de validador | convertiría el «probablemente» de los depósitos agrupados en una certeza |
| **La migración `001-limpieza.sql` está APARCADA** | no ejecutarla sin avisar. Lleva su propio orden obligatorio: fusionar, desplegar, comprobar, y solo entonces ejecutar — al revés deja `/api/val/ganancia` en 500 |
| **La tabla `ajustes` quedó huérfana** en D1 al retirar el precio de entrada editable | borrarla es una migración, y la migración está aparcada |
| **Gráfica de recompensas** | aplazada de mutuo acuerdo |
| **Bloquear de verdad `nuc/` y `pruebas/`** | `_routes.json` no lo hace; falta averiguar cuál es la forma correcta en Pages |
| **Pruebas perdidas y no reconstruidas** | las que dependían de una fixture grande con datos reales de D1: `paneles-test`, `paneles34`, `paneles5678`, `pestanas`, `carga-test`, `nav-test`, y las de la portada `frontend`, `logos`, `polvo`, `iphone`. De `esfera-test` se recuperó la calibración en `esfera-calibracion-test.mjs`. Anotadas en `pruebas/README.md` |
| **`vault-test` intermitente** | falló una vez de siete en la comprobación del fogonazo y no se ha podido reproducir. Lleva volcado de estado al fallar para saber de qué lado está |
