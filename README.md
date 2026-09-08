# PLSDASH

Dos cosas en un mismo despliegue de Cloudflare Pages:

- **La portada pública** (`/`) — un seguidor de cartera de **PulseChain**. Pegas
  una o varias direcciones públicas y ves tus tokens, sus precios, el valor
  total y de dónde salió el dinero. Sin conectar la wallet: solo lectura.
- **El panel privado del validador** (`/val/`) — monitorización de los
  validadores propios, detrás de un PIN. Sustituye a Grafana.

Sin build. HTML, CSS y JavaScript a pelo; los módulos del panel se importan por
ruta fija y el navegador los carga tal cual están en el repositorio.

---

## Estado a 8-sep-2026

Lo que conviene saber antes de leer nada más:

- **El panel v1 ya no existe.** Eran 2.017 líneas en `val/index.html` con su
  propio PIN y su propia copia de la lógica. Se retiró el 8-sep-2026. Hoy
  `val/index.html` es una redirección a `/val/v2/`, y el panel es el v2.
- **Once validadores**, no diez, y **sus índices no son correlativos**: el
  undécimo recibió el **109876**, no el 109559. Ver la sección de trampas.
- La documentación de trabajo —las trampas de los datos, las decisiones y lo
  que queda pendiente— está en **`BRIEF-CLAUDE-CODE.md`**. Este fichero
  describe *qué hay*; aquél, *por qué es así*.

---

## La portada pública

| | |
|---|---|
| **Multi-wallet** | con etiquetas, y un interruptor por wallet para que sume o no en los totales |
| **Vistas** | Cartera (combinada o por wallet) · Historial · Inversiones |
| **Tokens personalizados** | pega un contrato `0x…` y se valida contra DexScreener |
| **Polvo** | las posiciones por debajo de 1 $ se pliegan. Es un filtro de vista, nunca de contabilidad: el total se calcula sobre la cartera entera y se dice cuánto se esconde |
| **Sin login** | el portfolio se sincroniza con un código en `plsdash.com/p/<code>`. `localStorage` es caché; **Cloudflare KV** es la fuente de verdad |
| **Datos en vivo** | cada 30 s |

### El interruptor «cuenta en los totales»

Cada chapita de wallet lleva un interruptor. Apagado, esa wallet sale del número
grande, de la tabla, del historial y de Inversiones a la vez.

**Añadir una wallet y contarla son dos cosas distintas, y confundirlas rompe la
clasificación en silencio.** El conjunto de wallets tuyas es lo que convierte un
envío de una a otra en «traspaso entre tus propias wallets» en vez de «salió de
la wallet sin recibir nada». Por eso `/api/inversiones` recibe **dos** listas:

- `w=` — **todas** tus wallets. Define qué es tuyo y manda la siembra.
- `ver=` — solo las que cuentan. Filtra qué se dibuja, y nada más.

Si se mandara solo la segunda, cada movimiento interno hacia una wallet apagada
aparecería como dinero saliendo. El estado se guarda como `cuenta !== false`, no
`=== true`: las carteras guardadas antes de que el campo existiera no lo llevan,
y con `=== true` se abriría la portada en 0,00 $ sin haber tocado nada.

### La pestaña Inversiones

Responde a «¿cuánto dinero de fuera he metido y en qué se convirtió?». La
distinción que la ordena entera: **un swap de PLS por HEX no es invertir, es
mover lo que ya tenías.** La clasificación se hace por TRANSACCIÓN, no por
transferencia:

```
sale nada, entra algo   →  ENTRADA. Dinero de fuera.
sale algo, entra algo   →  MOVIMIENTO. Un swap.
sale algo, no entra     →  descuadre.
```

Eso es exacto y no necesita ninguna regla de reparto: la propia transacción dice
qué salió y qué entró. Por eso **no hay** notas de procedencia del tipo «este
swap salió del ingreso del 12 de agosto» — harían falta reglas para repartir, y
una regla se equivoca.

De las entradas, solo las de **stablecoin** cuentan en dólares (un USDC es un
dólar, así que no hace falta precio histórico de nada). Las de **PLS nativo** se
enseñan sin convertir y se avisa de que no cuentan en el resumen semanal:
convertirlas pediría el precio de aquel día, y no lo tenemos. Todo lo demás va a
descuadres.

**Los envíos repetidos se agrupan.** Con validadores puestos, «lo que no cuadra»
se llenaba de trece líneas idénticas. Se funden en una que dice qué son —
*«Probablemente depósitos de validador»*— cuántos, cuánto cada uno y a dónde
fueron. La detección **no busca 32.000.000 PLS**: busca la forma —varios envíos
de PLS nativo, misma cantidad, mismo destino, sin recibir nada— porque un número
escrito a fuego miente el día que el depósito cambie. Y dice «probablemente»
porque es una deducción, no una lectura del contrato de depósito.

### The Vault (`vault.js`)

La tarjeta del valor total es una puerta: arrastrarla a la derecha descubre una
nube de partículas que se carga con el recorrido (canvas 2D, sin librerías). Al
completar los 244 px, fogonazo y salto a `/val/`.

**No autentica.** El gesto solo navega; el PIN lo pide el panel.

- 30 px de zona muerta, que se descuentan del recorrido.
- El progreso está atado al dedo. Nada se anima solo.
- Soltar antes del final la devuelve a su sitio.
- El bucle solo corre mientras hay gesto: en reposo no queda ni un `rAF`.
- Exige puntero pulsado (`ev.buttons` en cada `pointermove`) — sin eso, en
  escritorio bastaba pasar el ratón por encima para abrirla.
- Con `prefers-reduced-motion`, ni partículas ni fogonazo.

Se desactiva borrando su `<script>` de `index.html`. No toca nada más.

---

## El panel del validador (`/val/`)

`/val/` redirige a `/val/v2/`, que es el panel. La redirección **tiene que
seguir existiendo**: es a donde lleva el Vault, donde está la regla de
limitación de peticiones y lo que hay en los marcadores.

### La puerta

Sin sesión, `/val/v2/` pide el PIN ahí mismo: teclado de cuatro dígitos con los
colores del tema elegido. El PIN va a `/api/val/auth`, la sesión es una cookie
firmada con HMAC-SHA256 (30 días, `Path=/`) y la guardia es
`functions/api/val/_middleware.js`. En `val/v2/puerta.js` no hay criptografía:
es un teclado y un `fetch`.

**El cierre de sesión mira la respuesta.** Si el servidor no confirma que ha
borrado la cookie, no se navega: el botón lo dice y deja reintentar. El v1 hacía
`try { fetch } catch {}` y navegaba pasase lo que pasase — veías que salías y la
cookie seguía puesta.

Si la sesión caduca **con el panel abierto**, vuelve la puerta. Antes eso dejaba
el panel puesto con «SIN SESIÓN» en una esquina y los números congelados: parece
que va y no va.

### Las cinco pestañas

| Pestaña | Responde a | Paneles |
|---|---|---|
| **Resumen** | ¿cuánto llevo y va todo bien? | ganancia acumulada, pulso de datos y estado, ritmo por periodos, desglose del saldo, precio de PLS |
| **Ganancias** | ¿de dónde sale y hacia dónde va? | ganancias con la franja de 30 días, ciclo de barrido, «Si PLS valiera otra cosa», aportaciones |
| **Validadores** | ¿cuál de ellos está raro? | tabla por validador, trayectoria hacia el siguiente |
| **Nodo** | ¿cómo está la máquina y qué ha pasado? | salud del nodo, estado global, registro de vida |
| **Esfera** | — | la visualización en WebGL |

El reparto es por pregunta, no por «cuántos paneles caben en cada una».

### Los cinco temas

`Núcleo` (cian y naranja) · `Menta` · `Pulso` (el rosa de la portada) · `Ámbar` ·
`Papel`. Se eligen en el engranaje de la barra y se guardan en `localStorage`
bajo `plsdash:tema` — es una preferencia del aparato, no un dato: que el móvil
vaya en Papel y el escritorio en Núcleo es una ventaja.

El tema son **papeles**, no colores: `--dato`, `--bien`, `--acento`, `--vidrio`.
El color nunca viaja solo — todo estado lleva su palabra al lado, porque verde y
naranja se distinguen mal bajo deuteranopía.

La esfera no lee CSS, así que `aplicarTema()` emite un evento
`plsdash:tema` que `escena/esfera.js` escucha.

### La pantalla de carga

La esfera **naciendo**: nace a pantalla completa y al terminar se muda al hueco
de su pestaña. Tres fases, y son tres por un motivo:

- **entrada** — duración fija, se ve siempre entera.
- **espera** — sostenible indefinidamente. Si los datos no han llegado, esto es
  lo que se ve; si ya estaban, dura cero.
- **salida** — duración fija, también entera.

Suelo de 1.600 ms (400 con `prefers-reduced-motion`). Por debajo de ~1,2 s la
animación se lee como un parpadeo.

**La esfera se entrega, no se destruye y se rehace.** `esfera.mudar()` traslada
el `<canvas>` a la pestaña conservando el contexto: si se crearan dos, habría
dos compilaciones de shaders —708 ms medidos cada una por software—.

### La barra de navegación

Píldora flotante abajo en móvil (≤819 px), arriba en escritorio. Translúcida con
desenfoque real. Al desplazar se contrae —las etiquetas desaparecen, quedan los
iconos— y se expande cuando el desplazamiento **para**, no cuando se levanta el
dedo: en iOS el dedo se levanta y la inercia sigue. Se usa `scrollend` cuando
está, y **siempre** un temporizador de reposo de 140 ms, porque `scrollend`
puede no llegar nunca si el desplazamiento acaba fuera del hilo principal.

### Las aportaciones

Lo que has puesto de tu bolsillo se apunta a mano en la pestaña Ganancias, y
**el precio lo pone el servidor** pidiéndoselo a `/api/precio` en ese instante.
No se calcula después: el precio de un día pasado no se puede reconstruir —no
hay serie histórica por token en ninguna parte del proyecto—. Si en ese momento
no hay precio, se guarda `NULL` y se dice. Un precio inventado sería peor.

Junto a ellas, `/api/val/ganancia` devuelve `saldo_wallet`: el saldo real de la
wallet de retirada, o sea el dinero que de verdad ha llegado.

---

## Estructura

```
index.html                        la portada entera (HTML + CSS + JS)
vault.js                          el Easter egg de la tarjeta
404.html                          rescate de rutas: guarda el camino y va a /

val/index.html                    redirección a /val/v2/  (aquí vivía el v1)
val/compartido/ganancias.js       la lógica de ganancias. La importan 11 módulos
val/v2/index.html                 el panel: marcado, pestañas y arranque
val/v2/puerta.js  puerta.css      el PIN y el cierre de sesión
val/v2/datos.js                   la única capa que habla con la red
val/v2/paneles/                   un módulo por panel + estilo.css + tema + nav
val/v2/carga/                     la pantalla de carga (esfera naciendo)
val/v2/escena/                    la esfera en WebGL
val/v2/vendor/three.module.js     three.js, sin tocar

functions/api/portfolio/[code].js GET/PUT del portfolio en KV
functions/api/precio.js           el precio de PLS, para todos
functions/api/inversiones.js      el historial de inversiones (bloque 7)
functions/api/val/                el panel: auth, logout, estado, histórico,
                                  eventos, ganancia, aportaciones + guardia

pruebas/                          la suite. `./pruebas/correr.sh`
migraciones/001-limpieza.sql      aparcada, ver el brief
nuc/                              lo que corre en el servidor doméstico
_headers _routes.json             caché y enrutado de Functions
```

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JS vanilla, **sin build** |
| Hosting | Cloudflare Pages (auto-deploy desde `main`) |
| Backend | Pages Functions + KV + D1 |
| 3D | three.js (`val/v2/vendor/`) |
| Precios y logos | [DexScreener](https://docs.dexscreener.com) |
| Balances e historial | PulseChain RPC + explorador Blockscout |
| Datos del validador | el NUC de casa → KV y D1 |

---

## La API

### Portada

**`GET|PUT /api/portfolio/<code>`** — binding KV `PLSDASH_KV`. `GET` devuelve el
JSON guardado o `404` con cuerpo `null`. `PUT` valida forma y tamaño (<100 KB).
El código es base62 de 10 caracteres, o uno personalizado; quien lo tenga puede
ver y editar ese portfolio, así que es un enlace privado.

**`GET /api/inversiones?w=…&ver=…&tz=…`** — el historial de inversiones. `tz` es
`getTimezoneOffset()`: el día y la semana se cuentan **en la hora del usuario**,
porque un ingreso a las 00:30 en España son las 22:30 UTC del día anterior.

Se siembra **por tandas con cursor**: traerse el historial completo de una wallet
activa en una sola invocación termina en 524 sin haber escrito nada. Cada llamada
trae como mucho dos páginas por dirección y por flujo, guarda lo traído y deja el
cursor donde se quedó. Mientras queda historia, la respuesta lleva
`sembrando: true` y el panel lo dice. Cinco flujos, cada uno con su cursor:
`token-transfers` y `transactions` en los dos sentidos, más
`internal-transactions` entrantes.

> ⚠ **Van con `?filter=to|from`, y eso es lo que antes faltaba.** Sin filtro el
> endpoint devolvía cero. Y no vale con `filter=to`: para distinguir una compra
> de un swap hace falta ver también lo que sale, por eso son dos llamadas por
> fuente.

### `GET /api/precio` — el precio de PLS, en un solo sitio

Lo consumen la portada, el panel y `push.py` en el NUC, para que los tres enseñen
la misma cifra del mismo instante en vez de tres lecturas sueltas de DexScreener.

Devuelve el bloque entero del par de WPLS con más liquidez **donde WPLS es el
token base** (`priceUsd` es el precio de la base: en un par HEX/WPLS traería el
del HEX). De ahí salen también el logo del PLS y el `pairAddress`, que alimenta
el gráfico y el cambio a 7 d / 30 d.

```json
{ "disponible": true, "obsoleto": false, "precio": 0.000031, "cambio24": -3.4,
  "par": "0x…", "logo": "https://…", "simbolo": "WPLS", "ts": 1786899601 }
```

**Dos capas de caché.** `caches.default` a 60 s es el camino caliente; KV
(`precio:pls`) guarda el último precio bueno y se reescribe como mucho cada
5 min — el plan gratuito son 1.000 escrituras/día y escribir en cada fallo de
caché de 60 s daría 1.440.

**Cuando DexScreener falla** se sirve el último precio bueno con `obsoleto: true`
y `edad_s`. Sin fuente ni respaldo, **`503` con `disponible: false`** — nunca un
cero de relleno. Ese 503 es lo que hace que la portada vuelva a pedir WPLS en su
lote: es un respaldo, no un segundo camino.

### Panel del validador — `/api/val/*`

Todas menos `/auth` pasan por `_middleware.js`, que exige cookie válida antes de
ejecutar nada: sin sesión, los datos no llegan a leerse.

| Endpoint | Qué hace |
|---|---|
| `POST /auth` | `{ pin }` contra el secret `VAL_PIN`. Emite la cookie |
| `POST /logout` | borra la cookie. Es `httpOnly`, el frontend no puede |
| `GET /estado` | el JSON de KV (`validator:estado`) tal cual |
| `GET /historico?rango=` | `24h · 7d · 30d · todo · serie · precio` |
| `GET /eventos?limit=&tipos=` | registro de vida, filtrable por tipo |
| `GET /ganancia` | retiradas reconciliadas contra la cadena + `saldo_wallet` |
| `GET|POST|DELETE /aportaciones` | lo aportado a mano |

> **Sin bloqueo por intentos fallidos**, decisión explícita del propietario: el
> panel no está enlazado desde ningún sitio y es de solo lectura. La protección
> contra fuerza bruta es una regla de Cloudflare sobre `/api/val/auth`,
> configurada en el panel de Cloudflare — **no la busques en el repositorio, no
> está aquí**.

---

## Despliegue

**Secrets** (Settings → Environment variables → *Secret*, nunca en el repo):

| Variable | Uso |
|---|---|
| `VAL_PIN` | PIN de acceso al panel |
| `VAL_SESSION_SECRET` | firma HMAC de la cookie |

**Bindings** (Settings → Functions):

| Variable | Recurso |
|---|---|
| `PLSDASH_KV` | KV namespace |
| `VALIDATOR_DB` | D1 `validator-dashboard` |

Build settings: **sin** comando de build, *output directory* = `/`.

### `_routes.json` y `_headers`

`_routes.json` decide **dónde corre el runtime de Functions**. Los `exclude`
—`/val/v2/paneles/*`, `/pruebas/*`…— no impiden que esos ficheros se sirvan como
estáticos; solo evitan invocar Functions ahí. Ver la sección de trampas del
brief.

`_headers` pone `no-cache` a `/val/v2/*` y a `/val`: son módulos ES que se
importan por ruta fija, y quedarse con una copia vieja de uno mientras se sirve
el `index.html` nuevo deja la página cargando pero con media API inexistente.
`vendor/` sí es inmutable: `three.module.js` pesa 1,3 MB y solo cambia si se
sube de versión a mano.

### El subdominio `val.plsdash.com`

**No está implementado.** El README anterior describía un
`functions/_middleware.js` que repartía por hostname; ese fichero no existe en el
repositorio. El panel se sirve hoy desde `plsdash.com/val/`.

Si algún día se hace, hay que cambiar `destino` en `vault.js` **antes**: el
gesto navega a `/val/`, y esa ruta devolvería 404 desde `plsdash.com` en cuanto
el subdominio entrara en vigor.

Tampoco existe `_redirects`. Las rutas tipo `/p/<code>` las rescata `404.html`,
que guarda el camino en `sessionStorage` y redirige a `/`.

## Desarrollo local

```bash
./pruebas/correr.sh          # toda la suite (levanta su propio servidor)
node pruebas/servidor.js     # solo el sitio, en http://127.0.0.1:8899
```

El servidor de pruebas imita a Pages en lo que importa: sirve los ficheros tal
cual y devuelve `404.html` para lo que no existe. **Las Functions no corren**:
las pruebas que las tocan importan el módulo y le pasan una D1 de mentira, que
es más rápido y más exacto que levantar `wrangler`.

Con Functions y KV de verdad:

```bash
wrangler pages dev . --kv PLSDASH_KV
```

## Notas técnicas de la portada

- **Descubrimiento de tokens** por el explorador
  (`?module=account&action=tokenlist`), que lista los PRC-20 con balance y
  metadatos en una sola llamada. Si falla, los tokens personalizados se leen por
  RPC (`balanceOf` `0x70a08231`, `decimals` `0x313ce567`).
- **PLS nativo** por `eth_getBalance`; su precio sale de `/api/precio`.
- **Sin precio, fuera**, y se descarta al construir la lista, no al pintarla. Un
  token sin precio en PulseChain es un airdrop de estafa: no tiene mercado
  porque no tiene pool, y cualquiera puede mandarlo a cualquier wallet. El
  precio de mercado hace de prueba de que el token existe. **Coste aceptado**:
  si un token legítimo se queda sin pool, desaparece sin dejar rastro.
- **Lotes de 30** para los precios (endpoint multi-token de DexScreener),
  cacheados ~25 s.
- **Logos**: `pairs[].info.imageUrl`; el explorador es el respaldo para los que
  no tienen el perfil reclamado; y si no, un avatar generado del address.
- **Números a la inglesa, fechas en español.** Mezclarlos se veía: en la misma
  tarjeta salía «4,000 PLSX» y «$1200», porque el español no agrupa los números
  de cuatro cifras.
- Se respeta `prefers-reduced-motion` en todo.
