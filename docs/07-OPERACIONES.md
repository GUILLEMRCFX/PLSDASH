# 07 · OPERACIONES

**Qué hacer cuando algo va mal, y cómo recuperar lo que no se regenera.**

**Versión:** 1.0 · 21 de septiembre de 2026

**Depende de:** 03 Modelo de datos · 08 Arquitectura
**Alimenta a:** nada. Es hoja.

> Este documento existe para leerse **el día malo**. Si algo de aquí hay que
> averiguarlo en el momento, es que está mal escrito.

---

## 1. Qué se pierde y qué no

| Si se pierde | ¿Vuelve? | Cómo |
|---|---|---|
| **KV** (`validator:estado`) | ✅ en 3 minutos | El cron del NUC lo reescribe solo |
| El sitio en Pages | ✅ | Está en git; Pages redespliega desde `main` |
| El NUC | ✅ el software | `nuc/` está en el repositorio. Las claves NO: ésas son el papel |
| **D1** (`validator-dashboard`) | ❌ **NO** | Es lo único irreemplazable. Ver el resto de este documento |

A 21-sep-2026 D1 guarda **1.434 barridos, 843 snapshots con precio, 291
eventos y 422 filas de histórico por validador**. Nada de eso se puede volver a
pedir: las retiradas se podrían releer de la cadena, pero el precio de cada
hora y la telemetría del nodo no los sirve nadie.

---

## 2. La copia de seguridad: Time Travel

🟢 **DECIDED · 21-sep-2026** · La copia es **Time Travel de D1**, que Cloudflare
mantiene solo. No se construye nada.

**Cómo funciona:** D1 guarda el histórico de cambios y permite volver a
cualquier instante de los **últimos 30 días**, sin haber configurado nada.

**Lo que NO cubre, y se acepta a sabiendas:**

- Vive **en la misma cuenta de Cloudflare**. No protege de perder el acceso a
  la cuenta.
- Son **30 días**. Un borrado que no se note en un mes no se puede deshacer.

Se descartaron un volcado por cron desde el NUC y una copia cifrada fuera: el
primero muere con el NUC —un disco, dos cosas— y el segundo añade una clave que
custodiar, y una copia que no puedes descifrar no es una copia. Si algún día el
histórico vale más que ese coste, ahí está la opción.

---

## 3. Cómo se restaura

> ⚠ **Sobre la procedencia de estos comandos.** Se ha confirmado contra la API
> de Cloudflare que Time Travel existe y expone `getBookmark()` y `restore()`.
> **La sintaxis exacta de `wrangler` NO se ha podido verificar** desde el
> entorno donde se escribió esto, ni ejecutar un restore de prueba. Antes de
> fiarte el día malo, haz el ensayo de la sección 4 — que es justo para eso.

`DB = validator-dashboard`, id `8631f448-e656-4dca-b8a9-78fb7a8bb06a`.

### Paso 1 · Mirar qué hay, sin tocar nada

```bash
npx wrangler d1 time-travel info validator-dashboard
```

Devuelve el *bookmark* actual y hasta dónde llega la retención.

Para un instante concreto:

```bash
npx wrangler d1 time-travel info validator-dashboard \
  --timestamp=2026-09-20T14:00:00Z
```

### Paso 2 · Anotar la huella ANTES

⚠ **No te saltes esto.** Sin una huella previa no hay forma de saber si la
restauración hizo lo que querías; solo de suponerlo.

```bash
npx wrangler d1 execute validator-dashboard --remote --command "
SELECT (SELECT COUNT(*) FROM barridos)  AS barridos,
       (SELECT COUNT(*) FROM barridos WHERE precio_pls IS NOT NULL) AS con_precio,
       (SELECT COUNT(*) FROM snapshots) AS snapshots,
       (SELECT COUNT(*) FROM eventos)   AS eventos,
       (SELECT COUNT(*) FROM validador_diario) AS val_diario,
       (SELECT MAX(ts) FROM barridos)   AS ultimo_barrido,
       (SELECT ROUND(SUM(cantidad),0) FROM barridos) AS pls_total"
```

Referencia del 21-sep-2026, tras sellar el precio del pasado:

| | |
|---|---|
| barridos | 1.434 |
| con precio | 1.154 |
| snapshots | 910+ |
| eventos | 291+ |
| validador_diario | 422+ |
| PLS totales barridos | 4.079.066 |

### Paso 3 · Restaurar

```bash
npx wrangler d1 time-travel restore validator-dashboard \
  --timestamp=2026-09-20T14:00:00Z
```

o, si tienes el bookmark del paso 1:

```bash
npx wrangler d1 time-travel restore validator-dashboard \
  --bookmark=<bookmark>
```

⚠ **La restauración es EN SITIO, sobre la misma base.** No existe «restaurar a
una copia»: Time Travel mueve la base que tienes. Por eso importa lo siguiente.

⚠ **Y es reversible, mientras no pasen 30 días.** El estado de *antes* de
restaurar sigue dentro de la ventana, así que si te equivocas de instante
puedes volver hacia delante con otro `restore`. **Anota el bookmark de antes de
restaurar**: es tu camino de vuelta.

### Paso 4 · Comprobar la huella DESPUÉS

El mismo `SELECT` del paso 2. Tiene que dar lo que esperabas del instante
elegido, no lo que esperabas a secas.

### Paso 5 · Comprobar que el panel va

Abrir `/val/v2/` y mirar que las ganancias salen. Si `/api/val/ganancia` diera
500, el sospechoso número uno es una columna que la restauración devolvió a un
esquema anterior — ver el documento 03.

---

## 4. El ensayo, que hay que hacer UNA vez

> **Una copia que nunca se ha probado a restaurar no es una copia.** Y esto no
> se puede ensayar el día que hace falta.

El ensayo seguro **no es restaurar a ayer**: es restaurar **al instante actual**.
Ejercita exactamente la misma máquina —credenciales, permisos, comando, tiempo
que tarda— y el estado final es el mismo que el inicial, así que no hay nada
que perder.

```bash
# 1 · huella antes (el SELECT del paso 2, guárdala)
# 2 · bookmark de ahora
npx wrangler d1 time-travel info validator-dashboard
# 3 · restaurar a ESE bookmark, o sea a donde ya estás
npx wrangler d1 time-travel restore validator-dashboard --bookmark=<el de arriba>
# 4 · huella después: tiene que ser IDÉNTICA
```

**Qué se aprende:** si el comando existe tal cual, si tu sesión de `wrangler`
tiene permisos, cuánto tarda, y qué imprime. Que es todo lo que no quieres
descubrir el día malo.

**Qué NO se aprende:** que los datos de hace tres días sigan ahí. Para eso hay
que restaurar de verdad a un instante pasado, y eso sí mueve la base — hazlo
solo con el bookmark de vuelta anotado.

🔴 **PENDIENTE: el ensayo no se ha hecho.** No se pudo ejecutar desde el
entorno donde se escribió este documento: `wrangler` no está y el token de
Cloudflare no sale de ahí. **Cuando se haga, anotar aquí la fecha y lo que
imprimió**, y quitar este aviso.

---

## 5. Otras operaciones

### Ejecutar una migración

Las migraciones viven en `migraciones/`. **Leer siempre la cabecera antes**:
llevan su propio orden obligatorio.

```bash
npx wrangler d1 execute validator-dashboard --remote \
  --file=migraciones/00X-....sql
```

⚠ **Una migración aparcada envejece contra el código.** La 001 lleva sin
ejecutarse desde el 25-ago y ya contenía un `DROP COLUMN precio_pls` que hoy
destruiría datos vivos —se retiró el 21-sep—. Antes de ejecutar cualquier
migración vieja, comprobar **columna por columna** que sigue siendo cierta.

### Si el panel se queda DESFASADO

Dice que el NUC no reporta desde hace más de 15 minutos. Por orden:

1. ¿Está el NUC encendido y con red?
2. `python3 nuc/collector.py --resumen` — si falla, el problema es de lectura
   del nodo, no de publicación.
3. `python3 nuc/push.py --dry --verbose` — si falla aquí, es Cloudflare o el
   `.env`.
4. Mirar el cron.

### Si `/api/val/ganancia` da 500

Es la pieza más compleja del proyecto. Sospechosos por orden: una columna que
no está donde se espera, el explorador sin responder, o un tiempo de CPU
agotado por una siembra demasiado larga.

---

## 6. Preguntas abiertas

- El ensayo de restauración sigue sin hacerse (sección 4).
- ¿Merece la pena que el panel diga en algún sitio cuándo fue la última copia
  buena? Con Time Travel no hay «última copia» que enseñar —es continuo—, así
  que la pregunta se cae sola. Con un volcado por cron sí haría falta.
- Los 280 barridos anteriores al 16-ago no tienen precio y no lo tendrán:
  son anteriores al primer snapshot con precio guardado.
