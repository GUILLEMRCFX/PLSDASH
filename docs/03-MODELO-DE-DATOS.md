# 03 · ONTOLOGÍA Y MODELO DE DATOS

**Qué entidades existen, qué significan, y cuáles de sus columnas mienten.**

**Versión:** 1.0 · 15 de septiembre de 2026
**Verificado contra D1 de producción ese mismo día.**
**Revisado contra el código el 20-sep-2026** — ver las notas ⚠ de las secciones 3 y 4.

**Depende de:** 01 Constitución · 02 Modelo de barridos
**Alimenta a:** 06 El panel · 08 Arquitectura

> Las cifras de volumen cambian cada hora. Lo que no cambia es **qué columnas
> están vivas, cuáles muertas y cuáles rotas** — eso es lo que hay que leer.

---

## 1. Las entidades

**Validador** — una clave de firma con 32.000.000 PLS depositados. Tiene un
índice asignado por la cadena (no correlativo), una pubkey, y tres estados
posibles: esperando, en cola, activo. Ver documento 02, sección 8.

**Barrido** — una retirada automática del excedente de un validador hacia la
wallet. Es **la unidad de ingreso real** del sistema. Identificado por su índice
de retirada global en la cadena.

**Snapshot** — una foto horaria del estado completo: validadores, nodo, salud,
precio.

**Evento** — algo que pasó y merece quedar registrado: una activación, un
barrido, un bloque propuesto.

**Aportación** — PLS que el propietario transfiere a la wallet desde fuera. Se
apunta a mano: la cadena no distingue una aportación propia de cualquier otra
entrada.

**Inversión** — una transacción de las wallets públicas clasificada como entrada
de dinero, swap, o descuadre.

---

## 2. Dónde vive cada cosa

🟢 **DECIDED** · Tres almacenes, cada uno con un propósito:

| Almacén | Qué guarda | Cadencia |
|---|---|---|
| **KV** (`PLSDASH_KV`) | El estado actual completo | Cada 3 min |
| **D1** (`validator-dashboard`) | Histórico y fuente de verdad | Horaria / por suceso |
| **localStorage** | Preferencias del navegador: tema, wallets, HIDE DUST | — |

🟢 **DECIDED** · **KV es lo de ahora, D1 es lo de siempre.** Si KV se pierde, se
regenera en tres minutos. Si D1 se pierde, el histórico no vuelve.

---

## 3. Esquema real de D1

Nueve tablas. Volumen a 15 de septiembre de 2026.

### `snapshots` — 910 filas, desde el 8 de agosto

Foto horaria. Una fila por hora en punto.

| Columna | Estado |
|---|---|
| `ts` (PK), `ganado`, `balance_total`, `activos` | ✅ vivas |
| `disco_pct`, `disco_libre_gb`, `temp_cpu`, `ram_pct` | ✅ vivas |
| `peers`, `sincronizado`, `epoch`, `salud` | ✅ vivas |
| `temp_nvme` | ✅ viva — 908 de 910 |
| `precio_pls` | ✅ viva desde el 16-ago — 703 de 910 |
| `pls_hora` | ⚠️ **NULL a propósito** desde el 19-ago — 257 antiguas |
| `apr` | ⚠️ **NULL a propósito** desde el 19-ago — 257 antiguas |
| `barrido_acum` | ❌ **muerta** — 0 de 910 |
| `ganado_real` | ❌ **muerta** — 0 de 910 |

🟢 **DECIDED** · `pls_hora` y `apr` van a NULL **a propósito**. Las fórmulas que
las llenaban estaban mal por los dos lados — ver documento 02, sección 4. No
intentar «arreglarlo»: el panel las calcula bien por su cuenta.

⚠️ **Trampa:** `snapshots.ganado` es el excedente **sin barrer**, no el total.

### `barridos` — 1.218 filas, 3.413.912 PLS

**La fuente de verdad de las ganancias.**

| Columna | Estado |
|---|---|
| `indice_retirada` (PK), `ts`, `validador`, `cantidad` | ✅ vivas |
| `es_bloque` | ✅ viva — 87 marcados |
| `bloque` | ✅ viva |
| `precio_pls` | 🟡 **se rellena desde el 21-sep-2026** — los 1.218 anteriores se quedan vacíos |

🟢 **RESUELTO 21-sep-2026 · hacia delante.** `/api/val/ganancia` sella cada barrido nuevo con el precio que `snapshots` registró en su misma hora (±90 min). No es una estimación: es una lectura que este proyecto ya tenía guardada. Si no hay ninguna cerca, se queda a NULL — un hueco es la respuesta correcta.

🟡 **Lo pasado sigue abierto, y NO es irrecuperable.** `snapshots.precio_pls` existe desde el 16-ago, así que buena parte de los 1.218 barridos anteriores se podría sellar con un precio real. No se ha hecho: reescribir el pasado es una decisión del propietario, y el sellado lleva una ventana de 7 días que se lo impide al código.

El panel enseña las dos cifras por separado y no las mezcla: «≈ X $» es todo lo
generado al precio de **hoy**, y «Valor al cobrarlo» solo suma los barridos
sellados y dice **sobre cuántos de cuántos**. Con el PLS moviéndose un 47 % en
cinco días, presentar una como la otra sería una distorsión real.

**No borrar esa columna**, y ahora por el motivo evidente: **se está
rellenando**. Hasta el 21-sep el motivo bueno era que fuese el destino del
arreglo pendiente.

⚠ **Y la migración aparcada la borraba.** `migraciones/001-limpieza.sql` llevaba
un `DROP COLUMN precio_pls` escrito el 23-ago, cuando la columna estaba muerta.
Se ha retirado esa línea el 21-sep. La lección es del fichero entero: **una
migración aparcada envejece contra el código**, y antes de ejecutarla hay que
comprobar una por una que cada columna sigue muerta hoy.

⚠ **Aquí ponía otra razón y era falsa:** «la nombra `ganancia.js` en su INSERT,
borrarla deja el endpoint en 500». Comprobado el 20-sep-2026 — el INSERT real
es `(indice_retirada, ts, validador, cantidad, bloque, es_bloque)` y **no la
nombra**. Borrarla no rompería nada hoy. Lo que rompería es la posibilidad de
arreglarlo.

### `eventos` — 291 filas

| Columna | Estado |
|---|---|
| Todas | ✅ vivas |

**Tipos que el sistema escribe**, a 20-sep-2026:

| Quién | Tipos |
|---|---|
| `push.py` | `activacion`, `recuperacion`, `caida`, `aviso`, `slash`, `reinicio`, `desync`, `resync` |
| `/api/val/ganancia` | `barrido`, `bloque` |

⚠ La versión anterior de este documento listaba solo `activacion`, `barrido`,
`bloque` y una `recuperacion` histórica. Eso era una **foto de lo que había en
la tabla** el 15-sep, no de lo que el sistema puede escribir — y las dos cosas
se leían igual. Los `aviso` de validador esperando, por ejemplo, son
posteriores.

⚠️ **Dato histórico mal etiquetado:** el evento del 18-ago-2026 dice
«Validadores recuperados» cuando fue la **activación del 109876**. `push.py`
distinguía por recuento, y una activación tiene la forma exacta de una
recuperación. Corregido desde entonces — el del 110855 (11-sep) ya dice
«Validador 110855 activado» — pero el histórico quedó mal.

🟢 **DECIDED** · Son unos 6 sucesos al día. **No es un feed en vivo**, es un
registro.

**Índice crítico:**
```sql
CREATE UNIQUE INDEX ix_eventos_unico
  ON eventos (ts, tipo, COALESCE(validador, -1))
```
El `COALESCE` es imprescindible: `validador` es NULL en todos los barridos, y en
SQLite los NULL no se consideran iguales entre sí. Un UNIQUE normal habría
protegido solo los bloques.

### `daily` — 38 filas

**La tabla más rota del proyecto.** Ningún panel la usa: los dos recalculan
desde `snapshots` y `barridos`.

| Columna | Estado |
|---|---|
| `fecha` (PK), `salud`, `disco_pct` | ✅ vivas |
| `minutos_caido` | ✅ **viva desde sep-2026** — 7 minutos registrados |
| `ganado_acum` | ❌ **roto** · ya no se escribe desde el 20-sep-2026 |
| `ganado_dia` | ❌ **roto** — 24 de 38 valen 0 · ya no se escribe |
| `bloques` | ❌ **muerta** — suma 0 con 87 bloques reales |
| `apr_medio` | ❌ dejó de escribirse — 11 de 38 |

⚠️ **La causa de `ganado_acum`, localizada:** `push.py` guarda ahí
`validadores.ganado_total`, que es el excedente **sin barrer**. Cae en picado con
cada barrido, así que el «acumulado» sube y baja. Y como `ganado_dia` se calcula
como `max(0, diferencia)`, sale 0 los días en que el acumulado bajó.

🟢 **DECIDED · 20-sep-2026 · `push.py` ha DEJADO DE ESCRIBIR las dos.** No se
arreglan: no las lee nadie —los paneles recomponen los días con `diarioReal()`,
que es la cuenta buena— y seguir fabricando cada día un número que sabemos falso
es el principio P1 en silencio. Que no se enseñe no lo hace menos falso, lo hace
menos visible. Es el mismo camino que ya siguieron `apr_medio` y `bloques`.

**Las filas viejas se quedan como están:** son historia, mala pero historia, y
esta tabla dice lo que valen.

### `validador_diario` — 422 filas, 12 validadores

Histórico diario por validador: balance, ganado, estado.

🟢 **DECIDED** · **Ya no tiene lector** — el endpoint que la leía murió con el
v1. **Pero NO se borra.** Es el único histórico por validador y por día que
existe, y borrarlo es irreversible. Saldrá marcada como muerta en cualquier
análisis automático: **es un archivo, no código muerto.**

### `aportaciones` — 1 fila

PLS aportados desde fuera por el propietario. Se apunta a mano, y el servidor
guarda el precio del momento. Si se apunta con retraso, la fila queda sin precio
y lo dice: el precio de aquel día no se puede reconstruir.

### `inversiones` — 338 filas

Transacciones de las wallets públicas, clasificadas por forma: entrada de
stablecoin, swap, o descuadre. Clave primaria `(wallet, tx)`.

### `ajustes` — 1 fila

Clave/valor. Hoy solo `PRECIO_SACRIFICIO`.

### `meta` — 17 claves

Estado de los procesos de siembra. Cursores de paginación del explorador **por
wallet y por flujo**, más `barridos_siembra_completa` y `eventos_hasta_ts`.

⚠️ **Hay cursores de tres wallets**, no dos:
`0x2378…95d2`, `0x952e…bdc8` y `0xcb37f5…043f`.

---

## 4. Resumen: qué creer y qué no

**Fuente de verdad:**
- Ganancias → `barridos`
- Estado actual → KV
- Telemetría del nodo → `snapshots`

**No usar nunca:**
- `daily.ganado_dia`, `daily.ganado_acum`, `daily.bloques`
- `snapshots.barrido_acum`, `snapshots.ganado_real`
- `snapshots.pls_hora`, `snapshots.apr`

**No borrar aunque parezca muerto:**
- `barridos.precio_pls` — es el destino del arreglo pendiente, no porque nadie la nombre (no la nombra nadie)
- `validador_diario` — archivo irreemplazable
- `daily.minutos_caido` — resucitada

---

## 5. Preguntas abiertas

- 🔴 **¿Qué es `0xcb37f5e9384ae883a623157f3f101dc9d5a1043f`?** Tiene cursores de
  siembra en `meta`, así que en algún momento fue una wallet consultada. No está
  documentada en ningún sitio.
- ¿Se arregla `daily`, o se retira? Nadie la lee y la causa está localizada.
  Arreglarla no da nada nuevo; retirarla deja la tabla sin sentido.
- ¿Se rellena `barridos.precio_pls` desde ahora? Cada día que pasa es histórico
  que no vuelve — el mismo error que ya se cometió con el precio en `snapshots`.
- ¿Se corrige el evento mal etiquetado del 18-ago, o se deja como está con una
  nota?
- La migración `001-limpieza.sql` lleva desde el 25-ago sin ejecutar. Borra las
  cuatro columnas muertas confirmadas. ¿Se ejecuta o se retira del plan?
