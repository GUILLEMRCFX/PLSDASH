# PLSDASH

Portfolio tracker en tiempo real para **PulseChain**. Pega una o varias
direcciones de wallet públicas y mira todos tus tokens, su precio, el valor por
token y el valor total de la cartera — sin conectar la wallet (solo lectura de
direcciones públicas).

> Compite en calidad con plsfolio.com. Diseño de firma: una línea de **latido
> (ECG)** bajo el valor total, con el espectro de marca pink → violet → cyan.

## Características

- **Multi-wallet** con etiquetas (Main, Cold, …) y vistas *Combinado* / *Por wallet*.
- **Tokens personalizados**: pega un contrato `0x…` y se valida contra DexScreener.
- **Mostrar/ocultar** tokens (los ocultos no cuentan en el total).
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
- **PLS nativo** vía `eth_getBalance`; su precio se toma de **WPLS** en DexScreener.
- **Rate limits:** los precios se piden en lotes de 30 (endpoint multi-token de
  DexScreener) y se cachean ~25s para respetar el límite de 300 req/min.
- **Logos:** se usa `pairs[].info.imageUrl`; si falta o falla la carga, se cae a
  un avatar generado (gradiente derivado del address + inicial del símbolo).
- Se respeta `prefers-reduced-motion`.
