# Brief para Claude Code — Validator Dashboard

> Pega esto al iniciar la sesión de Claude Code. Contiene todo el contexto necesario.

---

## Qué vamos a construir

Un panel privado de monitorización de 10 validadores de PulseChain, alojado en el subdominio `val.plsdash.com`, dentro del ecosistema PLSDASH.

Sustituye a Grafana, que es ilegible y no responde a las preguntas reales del propietario.

**Las tres preguntas que el panel debe responder en dos segundos:**
1. ¿Está todo bien? (si un validador cae, se pierde dinero cada minuto)
2. ¿Cuánto llevo ganado?
3. ¿Voy bien? (efectividad real, no solo "activo")

---

## Estado actual: qué YA está hecho

**No hay que rehacer nada de esto. Funciona y está en producción.**

### En el NUC (servidor doméstico, Ubuntu 24.04)

Dos scripts en `/home/guillem/`:

- **`collector.py`** — lee la API de Lighthouse (`localhost:5052`) y Prometheus (`localhost:9099`), compone un JSON con el estado completo.
- **`push.py`** — publica ese JSON en Cloudflare KV y guarda histórico en D1. Detecta eventos comparando con la ejecución anterior.

Cron activo: `*/3 * * * *` → se ejecuta cada 3 minutos.

### En Cloudflare

| Recurso | ID / valor |
|---|---|
| Account ID | `43fcbb2325e70c196b56d6759046fa55` |
| KV namespace | `PLSDASH_KV` → `05fb9dd64a104e48ab5f4d2f324efd9d` |
| D1 database | `validator-dashboard` → `8631f448-e656-4dca-b8a9-78fb7a8bb06a` (región WEUR) |
| Proyecto Pages | `plsdash` (repo `GUILLEMRCFX/PLSDASH`, auto-deploy desde `main`) |

**Clave de KV donde vive el estado actual:** `validator:estado`

---

## Estructura de datos

### KV — clave `validator:estado`

JSON completo, se sobrescribe cada 3 minutos. Estructura real:

```json
{
  "version": 1,
  "generado": "2026-08-08T14:22:48+00:00",
  "generado_ts": 1786198968,
  "salud": "ok",
  "validadores": {
    "total": 10,
    "activos": 10,
    "slashed": 0,
    "balance_total": 320010277.79,
    "stake_total": 320000000,
    "ganado_total": 10277.79,
    "activacion_utc": "2026-08-07T09:45:55+00:00",
    "horas_activo": 28.62,
    "pls_hora": 359.1,
    "pls_dia": 8618.4,
    "apr_pct": 0.983,
    "detalle": [
      {
        "indice": 109549,
        "pubkey": "0xb31fec38...",
        "pubkey_corta": "0xb31fec…a875cc",
        "estado": "active_ongoing",
        "balance": 32001034.05,
        "ganado": 1034.05,
        "slashed": false,
        "activation_epoch": 319720
      }
    ]
  },
  "nodo": {
    "sincronizado": true,
    "optimistic": false,
    "head_slot": 10241312,
    "sync_distance": 0,
    "epoch_actual": 320041,
    "epoch_finalizada": 320039,
    "peers": 70,
    "version": "Lighthouse-Pulse/v2.5.1",
    "uptime_horas": 41.2,
    "ram_total_gb": 62.6,
    "ram_libre_gb": 55.0,
    "ram_usada_pct": 11.9,
    "disco_total_gb": 1832.0,
    "disco_libre_gb": 697.5,
    "disco_usado_pct": 61.9,
    "temp_cpu": 45.0,
    "temp_nvme": 40.9,
    "carga_1m": 0.5,
    "carga_pct": 2.1
  }
}
```

**Valores posibles de `salud`:** `ok` · `aviso` · `critico` · `sin_datos`

### D1 — tablas del histórico

```sql
snapshots (
  ts INTEGER PRIMARY KEY,     -- unix, uno por hora
  ganado REAL, balance_total REAL, activos INTEGER,
  pls_hora REAL, apr REAL,
  disco_pct REAL, disco_libre_gb REAL,
  temp_cpu REAL, temp_nvme REAL, ram_pct REAL,
  peers INTEGER, sincronizado INTEGER, epoch INTEGER,
  salud TEXT
)

daily (
  fecha TEXT PRIMARY KEY,     -- YYYY-MM-DD
  ganado_dia REAL, ganado_acum REAL, apr_medio REAL,
  salud TEXT, disco_pct REAL,
  bloques INTEGER DEFAULT 0, minutos_caido INTEGER DEFAULT 0
)

eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  tipo TEXT NOT NULL,         -- activacion|bloque|caida|recuperacion|reinicio|desync|resync|slash|aviso
  titulo TEXT NOT NULL,
  detalle TEXT, pls REAL, validador INTEGER
)

validador_diario (
  fecha TEXT, indice INTEGER,
  balance REAL, ganado REAL, estado TEXT,
  PRIMARY KEY (fecha, indice)
)
```

Índice existente: `idx_eventos_ts` sobre `eventos(ts DESC)`.

---

## Lo que hay que construir

### 1. Pages Functions (backend)

Nuevas funciones en `/functions/api/val/`:

**`auth.js`** — valida el PIN
- Recibe POST con el PIN
- Compara contra la variable de entorno `VAL_PIN` (a configurar en Cloudflare, NO en el repo)
- Devuelve un token de sesión firmado (o cookie httpOnly) con caducidad razonable
- **Bloqueo tras 5 intentos fallidos** (guardar contador en KV con TTL)
- **CRÍTICO:** si el PIN es incorrecto, los datos NUNCA salen del servidor

**`estado.js`** — estado actual
- Requiere sesión válida
- Lee la clave `validator:estado` de KV
- Devuelve el JSON tal cual

**`historico.js`** — series temporales
- Requiere sesión válida
- Consulta D1 según el parámetro `rango` (24h / 7d / 30d / todo)
- Devuelve datos agregados listos para graficar

**`eventos.js`** — registro de vida
- Requiere sesión válida
- Últimos N eventos de la tabla `eventos`, orden descendente

### 2. Frontend

Nueva página en el repo, servida en `val.plsdash.com`.

**Pantalla de PIN** → **Dashboard con 4 pestañas**

#### Pestaña RESUMEN

- **Estado global** — frase clara arriba del todo: "10 de 10 validando · sin incidencias en 14 días"
- **Total ganado** — desde el inicio, en PLS y equivalente en dólares
- **Ritmo actual** — PLS/hora
- **Efectividad** — con la media histórica propia al lado como contexto
- **LÍNEA DE HITOS** *(elemento firma, único con protagonismo visual)* — una sola línea temporal con: posición actual → validador #11 (faltan 32M PLS) → break-even (recuperar los 320M invertidos). Calculado al ritmo actual.
- **Franja de 30 días** — 30 cuadrados, uno por día, verde/ámbar/rojo según `daily.salud`
- **Registro de vida** — timeline de eventos con coste integrado ("nodo reiniciado · caído 4 min · −191 PLS")
- **Gráfica de recompensas** — pestañas 24h / 7d / 30d
- **Propuestas de bloque** — total + probabilidad de la siguiente ("~5 días · 10 de 109.559 validadores")

#### Pestaña VALIDADORES

- Total en staking
- Coste de lo fallado (atestaciones perdidas → PLS)
- Detalle de los 10: índice, clave abreviada, efectividad, ganado, balance

#### Pestaña NODO

- Estado de sincronización (peers, slot, epoch, verified)
- Recursos: temperatura CPU, carga, RAM, disco
- **Runway de disco** — frase dentro de la tarjeta: "crece ~14 GB/semana · prune hacia marzo 2027" (calcular con la tendencia de `snapshots.disco_pct`)
- **Nota de exposición** — aviso fijo: punto único de fallo, coste por hora caído

#### Pestaña HERRAMIENTAS

- **Simulador de precio PLS** — slider. Muestra valor del stake, ganado hasta hoy y proyección a 1 año
- **Escenarios de crecimiento** — comparador: solo reinvertir / +50 € mes / +150 € mes → días hasta el validador #11
- **Fiscalidad** — ganado en el año natural, valor medio de adquisición, botón exportar CSV
- **Control de avisos** — ver y activar/desactivar qué alertas llegan

---

## Diseño

Hereda la identidad de PLSDASH.

| Elemento | Valor |
|---|---|
| Fondo | `#0e0715` (plum-black) |
| Superficies | `#170e22` / `#1d1330` |
| Líneas | `#2a1c3d` |
| Gradiente | `linear-gradient(120deg, #ff5ca8, #a855f7 55%, #22d3ee)` |
| Texto | `#f6f1fb` · atenuado `#9d8bb8` · apagado `#6b5a86` |
| Semáforo | ok `#38d98a` · aviso `#f5b544` · error `#ff5c7a` |
| Display y números | Space Grotesk |
| Datos técnicos | JetBrains Mono (claves, slots, hashes) |

### Principios de diseño — respetar estrictamente

- **Móvil primero.** Se abre principalmente desde iPhone. Diseñar a 390px y escalar.
- **El gradiente con cuentagotas.** Solo en: número principal, línea de hitos, barras de gráfica y precio del simulador. **Nada más brilla.**
- **Animación mínima y con propósito.** Transición suave al cambiar de pestaña y poco más. Respetar `prefers-reduced-motion`.
- **Jerarquía por tamaño y peso**, no por color ni efectos.
- **Tono profesional y sobrio.** Nada de efectos llamativos, pulsos, latidos ni decoración gratuita. El propietario rechazó explícitamente ese tipo de recursos.
- **Existe una maqueta HTML de referencia** que el propietario aprobó. Pedírsela antes de empezar el frontend.

---

## Seguridad

Tres capas:

1. **Subdominio no anunciado** — `val.plsdash.com` no se enlaza desde `plsdash.com`
2. **Cloudflare Access (Zero Trust)** — muro previo por email, opcional, decidir al final
3. **PIN de 4 dígitos** — validado en servidor, guardado como variable de entorno, con bloqueo por intentos

**Regla no negociable:** el PIN se valida en la Pages Function. Nunca en el frontend. Si es incorrecto, los datos no salen del servidor.

El PIN lo configurará el propietario como variable de entorno en Cloudflare. **No pedírselo ni escribirlo en el código.**

---

## Detalles a tener en cuenta

**Datos reales actuales** (para calibrar el diseño con cifras verosímiles):
- Validadores propios: se descubren leyendo los keystores del disco. Los
  índices NO son correlativos (el undécimo recibió el 109876, no el 109559)
- Activados el 7 ago 2026 a las 09:45 UTC
- 320.000.000 PLS en staking (32M por validador)
- ~10.500 PLS ganados en las primeras 29 horas
- APR real ≈ 0,98% (bajo, pero es pronto y aún no ha tocado proponer bloques)
- Wallet de retirada: `0x952E0311DdDCe7090d61a275f411a6ddF879BDc8`
- Disco al 61,9%, crece con la cadena

**Cálculos que el frontend debe derivar:**
- Efectividad por validador → comparar su `ganado` contra el máximo del grupo
- Días hasta el validador #11 → `32.000.000 / pls_dia`
- Break-even → `320.000.000 / pls_dia`
- Runway de disco → tendencia de `disco_pct` en `snapshots`
- Probabilidad de bloque → `10 / total_validadores_red` (~109.559)

**Convenciones del repo PLSDASH:**
- Vanilla HTML/CSS/JS, sin frameworks
- Commits: `feat:` `fix:` `style:` `refactor:` `docs:` `chore:`
- Auto-deploy al hacer push a `main`

---

## Orden de trabajo sugerido

1. Pages Functions con validación de PIN (probar con curl antes de tocar UI)
2. Endpoints de estado, histórico y eventos
3. Pantalla de PIN
4. Pestaña Resumen (la más importante)
5. Resto de pestañas
6. Configurar el subdominio en Cloudflare
7. Cloudflare Access (opcional, al final)

---

## Lo que NO hay que hacer

Funciones descartadas explícitamente por el propietario y sus motivos:

- **Modo pantalla / kiosco** — no hay monitor dedicado, no se usaría
- **Panel de concentración de riesgo** — el contenido no cambia; va como nota fija en la pestaña Nodo
- **Panel de coste de apagón** — redundante; se integra como campo del registro de eventos
- **Comparativa de percentil contra la red** — requeriría datos de 109.000 validadores. Sustituido por comparación contra la media histórica propia
- **Animación de pulso / latido ECG** — rechazado por poco profesional
