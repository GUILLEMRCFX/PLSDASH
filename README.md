# PLSDASH

Portfolio tracker en tiempo real para **PulseChain**. Pega una o varias
direcciones de wallet públicas y mira todos tus tokens, su precio, el valor por
token y el valor total de la cartera — sin conectar la wallet (solo lectura de
direcciones públicas).

> Compite en calidad con plsfolio.com. Identidad: escudo con el espectro de
> marca pink → violet → cyan sobre fondo plum-black, y el valor total como
> única cifra con protagonismo.

## Características

- **Multi-wallet** con etiquetas (Main, Cold, …) y vistas *Combinado* / *Por wallet*.
- **Tokens personalizados**: pega un contrato `0x…` y se valida contra DexScreener.
- **HIDE DUST**: esconde de la lista las posiciones que valen menos de 1 $
  (umbral en `UMBRAL_DUST_USD`). Es por valor de la posición, no por precio
  unitario. **Filtro de vista, nunca de contabilidad**: el total, el cambio del
  periodo y las estadísticas se siguen calculando sobre la cartera entera, y
  bajo la lista se dice cuánto se está escondiendo. Se recuerda entre visitas.
- **Datos en vivo** cada 30s: balances on-chain + precios y logos oficiales.
- **Código de portfolio (sin login)**: sincroniza entre dispositivos vía
  `plsdash.com/p/<code>`. `localStorage` es caché; **Cloudflare KV** es la
  fuente de verdad.
- **Mobile-first**, accesible, con estados de carga / vacío / error claros.

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | HTML + CSS + JS vanilla (sin build) — `index.html` |
| Hosting | Cloudflare Pages |
| Backend | Cloudflare Pages Functions (`/functions`) + Cloudflare KV |
| Precios + logos | [DexScreener API](https://docs.dexscreener.com) |
| Balances | PulseChain RPC (`https://rpc.pulsechain.com`) + explorer Blockscout (`https://api.scan.pulsechain.com`) |

## Estructura

```
/index.html                          → la app completa (HTML+CSS+JS)
/functions/api/portfolio/[code].js   → Pages Function: GET/PUT del portfolio en KV
/functions/api/precio.js             → Pages Function: el precio de PLS, para todos
/_routes.json                        → las Functions sólo corren en /api/*
/_redirects                          → /p/<code> sirve index.html (SPA)
/README.md
```

## Cómo funciona el "código de portfolio"

- Sin código → la app funciona en **modo local** (`localStorage`) y ofrece
  *"Crear mi portfolio en la nube"*.
- Al crearlo se genera un código base62 de 10 caracteres (no adivinable) y la
  config se guarda en KV. La URL pasa a `plsdash.com/p/<code>`.
- Se puede **personalizar** el código (ej. `/p/guillem`); si ya existe en KV se
  rechaza y se pide otro (la comprobación usa `GET` → `404` = libre).
- **Privacidad honesta**: quien tenga el código puede ver y editar ese
  portfolio. Trátalo como un enlace privado (las wallets ya son públicas).

## API (Pages Function)

`/functions/api/portfolio/[code].js`, binding KV `PLSDASH_KV`:

- `GET /api/portfolio/<code>` → JSON guardado, o `404` (con cuerpo `null`) si no existe.
- `PUT /api/portfolio/<code>` → guarda `{ wallets, customTokens, hidden, ... }`.
  Valida que sea JSON con forma razonable y < 100KB. Maneja CORS.

### `GET /api/precio` — el precio de PLS, en un solo sitio

`/functions/api/precio.js`. Lo consumen la portada, `/val/` y `push.py` en el
NUC, para que los tres enseñen la misma cifra del mismo instante en vez de tres
lecturas sueltas de DexScreener.

Devuelve el bloque entero del par de WPLS con más liquidez **donde WPLS es el
token base** (`priceUsd` es el precio de la base: en un par HEX/WPLS traería el
del HEX):

```json
{ "disponible": true, "obsoleto": false, "precio": 0.000031, "cambio24": -3.4,
  "par": "0x…", "logo": "https://…", "simbolo": "WPLS", "nombre": "Wrapped Pulse",
  "ts": 1786899601 }
```

No solo el precio: la portada saca de ese mismo par el logo del PLS y el
`pairAddress`, que es lo que alimenta el gráfico en vivo y el cambio a 7d/30d.

**Dos capas de caché.** `caches.default` a 60 s es el camino caliente. KV
(`precio:pls`) guarda el **último precio bueno** y se reescribe como mucho cada
5 min — el plan gratuito son 1.000 escrituras/día y escribir en cada fallo de
caché de 60 s daría 1.440.

**Cuando DexScreener falla** se sirve ese último precio bueno con `obsoleto:
true` y `edad_s`. Si no hay ni fuente ni respaldo, **`503` con `disponible:
false`** — nunca un cero de relleno. Ese 503 es lo que hace que la portada
vuelva a pedir WPLS en su lote y que el NUC llame a DexScreener por su cuenta.

## Validator Dashboard (`/api/val/*`)

Panel privado de monitorización de validadores, servido en `val.plsdash.com`.
Contexto completo en `BRIEF-CLAUDE-CODE.md`.

- `POST /api/val/auth` → `{ pin }`. Si coincide con el secret `VAL_PIN`, emite
  cookie de sesión firmada (HMAC-SHA256, 30 días). Sin bloqueo por intentos
  fallidos (decisión explícita: subdominio no enlazado, panel de solo lectura).
- `GET /api/val/estado` → JSON de KV (`validator:estado`) tal cual.
- `GET /api/val/historico?rango=24h|7d|30d|todo` → series de D1 (`snapshots`
  para 24h, `daily` para el resto).
- `GET /api/val/eventos?limit=N&tipos=caida,slash` → últimos N eventos de D1
  (`eventos`, por defecto 15, máx 100). `tipos` filtra por tipo de evento y se
  usa para localizar el último incidente sin traerse todo el registro.
- `GET /api/val/validadores` → histórico de `validador_diario` agregado por
  fecha y por validador. Es la base de la media histórica de efectividad.

### The Vault (`vault.js`)

Easter egg de la portada. La tarjeta del valor total es una puerta:
arrastrarla a la derecha descubre debajo una nube de partículas que forma una
esfera y se carga con el recorrido (canvas 2D, sin librerías). Al completar
los 244px, fogonazo blanco y salto a `/val/`.

**No autentica.** El gesto solo navega; el PIN lo sigue pidiendo el dial de
`/val/`, que es el único sitio que habla con `/api/val/auth` — y por eso la
regla `val-auth-brute-force` de Cloudflare sigue cubriendo la única puerta.

- 30px de zona muerta antes de responder, que se descuentan del recorrido.
- El progreso está atado al dedo (`x / 244`); nada se anima solo. A la mitad
  aparecen los rayos y a partir del 75% el núcleo blanco.
- El centro de la esfera va en `cx = x`, pegado al borde de la tarjeta, para
  que se vea desde el primer píxel de rendija y no solo al final.
- Soltar antes del final devuelve la tarjeta a su sitio. Al volver desde
  `/val/` aparece siempre cerrada: no se recuerda ningún estado.
- El bucle de animación solo corre mientras hay gesto. En reposo no queda ni
  un `requestAnimationFrame` pendiente.
- El arrastre exige puntero pulsado (`ev.buttons` en cada `pointermove`). Sin
  eso, en escritorio bastaba pasar el ratón por encima para abrirla.
- Con `prefers-reduced-motion` no hay partículas ni fogonazo: la tarjeta se
  desliza y ya está.
- La densidad de partículas baja en pantalla estrecha y con `devicePixelRatio`
  alto (de 420 a 156 en un móvil de densidad ×3).

Se desactiva borrando la etiqueta `<script src="/vault.js">` de `index.html`.
No toca nada más de la página: envuelve el hero al arrancar y todo lo suyo
vive dentro de ese envoltorio.

### Notas sobre los datos

- **El ritmo de recompensas no se toma de `pls_dia`.** Ese campo es la media
  desde la activación e incluye el periodo en que los validadores aún estaban
  en cola, así que subestima el ritmo real hasta 10× durante las primeras
  semanas. El panel lo mide sobre días cerrados de `daily` y, mientras no los
  haya, sobre `snapshots`, marcándolo como provisional.
- **`snapshots.ganado` NO es lo ganado**, es el excedente sin barrer: cada
  ~8,1 h el protocolo retira el sobrante sobre los 32M a la wallet y el
  contador vuelve a cero. La ganancia real son las retiradas acumuladas más
  ese excedente, y la calcula `/api/val/ganancia` contra la cadena.
- **`snapshots.precio_pls`** guarda el precio de PLS en cada snapshot horario,
  para poder ver su evolución. No se puede reconstruir después: ninguna API
  sirve el precio de una hora concreta pasado el momento. `NULL` significa que
  fallaron los dos caminos —`/api/precio` y DexScreener directo— un hueco
  honesto, nunca un cero.
- **`barridos`** es la fuente de verdad de las retiradas, y de ella salen los
  totales, el contador de bloques y la gráfica por ciclos.
- **`meta`** lleva los cursores: hasta dónde llega la siembra de `barridos` y
  hasta qué instante se han pasado los barridos al registro de vida.

El código del NUC que alimenta ambas cosas está en `nuc/`, con las
instrucciones de integración en `nuc/INTEGRACION.md`.

Todas menos `/auth` pasan por `functions/api/val/_middleware.js`, que exige
cookie de sesión válida antes de ejecutar la Function.

**Secrets necesarios en Cloudflare** (Settings → Environment variables → *Secret*,
nunca en el repo):

| Variable | Uso |
|---|---|
| `VAL_PIN` | PIN de acceso al panel |
| `VAL_SESSION_SECRET` | Firma HMAC de la cookie de sesión |

**Bindings necesarios** (Settings → Functions):

| Variable | Recurso |
|---|---|
| `PLSDASH_KV` | KV namespace (el mismo que usa `portfolio`) |
| `VALIDATOR_DB` | D1 database `validator-dashboard` |

### Subdominio `val.plsdash.com`

`functions/_middleware.js` reparte por hostname, así que un solo proyecto de
Pages sirve los dos sitios:

| Petición | Resultado |
|---|---|
| `val.plsdash.com/` | el panel (`/val/index.html`) |
| `val.plsdash.com/val/` | redirige a `/` |
| `val.plsdash.com/api/val/*` | pasa |
| `plsdash.com/val/*` | **404** |
| `plsdash.com/api/val/*` | **404** |
| `*.pages.dev` | todo pasa, para poder probar |

**Se activa con la variable de entorno `VAL_HOST`** (valor:
`val.plsdash.com`). Mientras no exista, el middleware no cambia nada y el
panel sigue en `plsdash.com/val/`.

> ⚠ **Antes de definir `VAL_HOST`, cambiar `destino` en `vault.js`.** El
> Easter egg de la portada navega a `/val/`, y esa ruta devuelve 404 desde
> `plsdash.com` en cuanto el subdominio entra en vigor: el gesto llevaría a
> una página en blanco. Basta con apuntar `destino` a
> `https://val.plsdash.com/`. Ya no hay nada de cookies que resolver aquí —
> desde que el Vault dejó de autenticar, no abre sesión.

Las rutas que pasan por Functions están en `_routes.json`; una ruta nueva del
panel hay que añadirla ahí o se servirá sin pasar por el filtro.

## Deploy en Cloudflare Pages

### 1. Crear el KV namespace

Con [Wrangler](https://developers.cloudflare.com/workers/wrangler/) instalado
(`npm i -g wrangler` y `wrangler login`):

```bash
wrangler kv namespace create PLSDASH_KV
# Anota el "id" que devuelve.
# (opcional, para `wrangler pages dev` local) namespace de preview:
wrangler kv namespace create PLSDASH_KV --preview
```

### 2. Crear el proyecto Pages y bindear el KV

En el **dashboard de Cloudflare → Workers & Pages → Create → Pages**:

1. Conecta este repositorio de GitHub.
2. Build settings: **sin** comando de build, *output directory* = `/` (raíz).
3. Tras el primer deploy: **Settings → Functions → KV namespace bindings**
   → *Add binding*:
   - **Variable name:** `PLSDASH_KV`
   - **KV namespace:** el creado en el paso 1.
4. Repite el binding para *Production* y *Preview* si usas ambos entornos.

> El binding **debe** llamarse exactamente `PLSDASH_KV` (es el nombre que usa la
> Function).

### 3. Dominio

Apunta `plsdash.com` al proyecto en **Custom domains**.

## Desarrollo local

Sirve las Functions y el KV localmente con Wrangler:

```bash
# Usa el namespace de preview creado arriba (sustituye <preview-id>):
wrangler pages dev . --kv PLSDASH_KV

# Alternativa con id explícito:
# wrangler pages dev . --kv PLSDASH_KV=<preview-id>
```

Abre la URL que imprime Wrangler (normalmente `http://localhost:8788`).
El frontend habla con `/api/portfolio/<code>`, servido por la Function local.

> Sin Wrangler, abrir `index.html` directamente funciona en **modo local**
> (localStorage); la sincronización en la nube necesita las Functions + KV.

## Notas técnicas

- **Descubrimiento de tokens:** se usa el explorer Blockscout
  (`?module=account&action=tokenlist`) para listar los PRC-20 de cada wallet con
  balance y metadatos en una sola llamada. Fallback: si el explorer falla, los
  *custom tokens* se leen por RPC (`balanceOf` selector `0x70a08231`,
  `decimals` selector `0x313ce567`). Ampliable a una lista de tokens populares.
- **PLS nativo** vía `eth_getBalance`; su precio **no** sale del lote, sino de
  `/api/precio` — la Function que lo sirve para todo PLSDASH (portada, panel de
  validador y el recolector del NUC), para que los tres enseñen la misma cifra.
  Si la Function no contesta, WPLS vuelve al lote como antes: es un respaldo,
  no un segundo camino.
- **Rate limits:** el resto de precios se piden en lotes de 30 (endpoint
  multi-token de DexScreener) y se cachean ~25s para respetar el límite de 300
  req/min.
- **Logos:** se usa `pairs[].info.imageUrl`; si falta o falla la carga, se cae a
  un avatar generado (gradiente derivado del address + inicial del símbolo).
- Se respeta `prefers-reduced-motion`.
