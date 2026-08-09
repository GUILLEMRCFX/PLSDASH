# Integración en `push.py` (NUC)

Tres cambios. El módulo `precio_y_bloques.py` va en la misma carpeta que
`push.py` (`/home/guillem/`).

## 0. Antes de nada

El esquema de D1 ya está migrado (hecho el 2026-08-08):

```sql
ALTER TABLE snapshots ADD COLUMN precio_pls REAL;
CREATE TABLE meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL, actualizado INTEGER);
```

No hay que volver a ejecutarlas.

---

# ⚠️ Antes de desplegar la validación: leer esto

Lo que el 8-ago se tomó por datos corruptos **eran barridos de saldo
legítimos**. El protocolo retira el excedente sobre los 32M a la wallet de
retirada cada ~9 h; el balance vuelve a 32.000.000 exactos por validador y
`ganado` (que es `balance − stake`) empieza de cero otra vez. Después la
acumulación sigue al ritmo normal de ~2.890 PLS/h, que es lo que delata que no
era ruido: una API rota no produce una progresión aritmética perfecta.

Consecuencias que **siguen pendientes** y que esta validación no arregla:

- **El panel muestra mal la ganancia.** «Ganado desde el inicio» enseña solo el
  saldo sin barrer. La ganancia real es la suma de lo barrido más lo actual.
  Con dos barridos observados, la cifra real ronda los 90.000 PLS frente a los
  ~29.000 que muestra.
- De esa cifra cuelgan los hitos, el break-even, la proyección y **la
  fiscalidad**, que es la que más importa: hacienda cuenta lo retirado.
- El invariante correcto no es «ganado solo sube» sino «barrido acumulado +
  saldo actual solo sube». Falta llevar ese acumulado.

Lo de aquí abajo ya es seguro de desplegar: reconoce los barridos y no los
rechaza. Pero no resuelve el cálculo de la ganancia real.

---

# Validación (`validacion.py`)

Dos barreras contra datos imposibles, después de que el 8-ago a las 19:00 la
tubería escribiera `ganado=0` con los diez validadores activos y `salud="ok"`.

## A. En `collector.py`, antes de devolver el estado

```python
from validacion import validar, marcar_sin_datos

motivos = validar(estado)
if motivos:
    for m in motivos:
        print(f"[collector] estado descartado: {m}")
    estado = marcar_sin_datos(estado, motivos)

return estado
```

## B. En `push.py`, antes de escribir nada

```python
from validacion import admisible, ultimo_ganado_conocido

if estado.get("salud") == "sin_datos":
    print("[push] estado no fiable, no se escribe nada en esta pasada")
    return
```

**Importante: cuando el estado no es fiable no se escribe *ni KV ni D1*.**

La instrucción original era no escribir el snapshot de D1, pero escribir KV con
`salud="sin_datos"` y `ganado=0` sería peor que no hacer nada: el panel lee KV
para el estado actual y enseñaría **0 PLS ganados** en el número principal. Al
no tocar KV, el panel sigue mostrando el último dato bueno y, como
`generado_ts` deja de avanzar, a los 15 minutos salta solo el aviso de «El NUC
no reporta desde hace X min». Esa ruta ya está construida y probada.

## C. En `push.py`, antes del `INSERT INTO snapshots`

```python
ultimo = ultimo_ganado_conocido(d1)
ok, motivo = admisible(ultimo, ganado, slashed=v.get("slashed", 0))
if not ok:
    print(f"[push] snapshot rechazado: {motivo}")
else:
    d1("INSERT INTO snapshots (...) VALUES (...)", [...])
```

Las recompensas acumuladas solo suben. Una bajada real solo puede venir de una
penalización, y una penalización de verdad también mueve el campo `slashed`:
si baja sin que nadie esté penalizado, el dato está mal y no entra.

## Qué rechaza exactamente `validar()`

Solo actúa si hay validadores `active_ongoing` y llevan más de una hora
activos; antes de eso un `ganado` a cero es legítimo. Cumplido eso, rechaza:

| Motivo | Por qué |
|---|---|
| `ganado_total` ausente, cero o negativo | Con validadores activos horas, imposible |
| `balance_total` == `stake_total` exacto | Es la firma de `effective_balance` |
| `balance` == 32.000.000 clavado en algún validador | La misma firma, uno a uno |
| `ganado_total` ≠ suma del detalle (±0,01) | Uno de los dos está mal y no se sabe cuál |

Comprobado contra la fila corrupta real (la caza por tres motivos a la vez) y
contra las seis filas buenas del 8-ago, más los casos de validador recién
activado y de nodo aún sincronizando, que **no** deben rechazarse.

## 1. Importar

```python
from precio_y_bloques import precio_pls, revisar_bloques
```

## 2. Guardar el precio en cada snapshot

Donde se compone el `INSERT INTO snapshots`, añadir la columna:

```python
precio = precio_pls()   # None si DexScreener no responde

d1(
    "INSERT INTO snapshots ("
    "  ts, ganado, balance_total, activos, pls_hora, apr,"
    "  disco_pct, disco_libre_gb, temp_cpu, temp_nvme, ram_pct,"
    "  peers, sincronizado, epoch, salud, precio_pls"
    ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [ts, ganado, balance_total, activos, pls_hora, apr,
     disco_pct, disco_libre_gb, temp_cpu, temp_nvme, ram_pct,
     peers, sincronizado, epoch, salud, precio],
)
```

`precio_pls()` devuelve `None` si falla, y `None` se guarda como `NULL`. Es
deliberado: un hueco se ve y se puede rellenar desde otra fuente, mientras que
un `0` de relleno se confunde con un precio real y contamina la fiscalidad sin
dejar rastro.

## 2b. Publicar el tamaño de la red

El panel estima cada cuánto le toca proponer con `mis_validadores / red`. Ese
número estaba a fuego en el frontend y la red crece, así que conviene medirlo.

En `collector.py`, junto al resto del bloque `nodo`, y añadirlo al JSON que va
a KV como `red_validadores_activos`:

```python
def red_validadores_activos():
    """Validadores ACTIVOS de la red. None si el nodo no responde.

    Filtrado por estado a propósito: el registro completo incluye pendientes
    de activar y ya salidos, y las propuestas solo se reparten entre activos.
    """
    try:
        r = requests.get(
            "http://localhost:5052/eth/v1/beacon/states/head/validators",
            params={"status": "active_ongoing"},
            timeout=30,
        )
        r.raise_for_status()
        return len(r.json()["data"])
    except Exception as e:
        print(f"[red] no se pudo contar la red: {e}")
        return None
```

Mientras no llegue, el panel usa 109.600 —el registro completo medido el
9-ago-2026— y lo marca como «red sin medir».

**Descuadre pendiente:** en la ventana del 7 al 9 de agosto se observaron 4
bloques donde este modelo predice 1 (probabilidad del 2,3%). Puede ser que los
activos sean bastantes menos que el registro, que las retiradas grandes no sean
todas propuestas, o azar con una muestra de cuatro. No está resuelto.

## 3. Revisar bloques en cada ejecución

Al final del ciclo, después de escribir el snapshot:

```python
revisar_bloques(d1)
```

Se apoya en la tabla `meta` para recordar la última epoch revisada, así que es
seguro llamarlo en cada pasada del cron. Devuelve cuántos bloques nuevos ha
anotado, por si se quiere registrar en el log.

---

## Qué hace exactamente la detección de bloques

1. Lee la epoch de cabeza y trabaja solo con epochs **ya terminadas**. En la
   epoch en curso todavía quedan slots por llegar, y darla por revisada
   marcaría como perdido un bloque que aún no se ha propuesto.
2. Para cada epoch pendiente pide
   `/eth/v1/validator/duties/proposer/{epoch}` y se queda con los slots
   asignados a los índices 109549–109558.
3. **Confirma que el bloque existe** pidiendo la cabecera del slot. Estar
   asignado no es haber propuesto: si el slot se perdió no hay bloque, y
   anotarlo apuntaría una recompensa que nunca se cobró.
4. Pide la recompensa real a `/eth/v1/beacon/rewards/blocks/{slot}` (en Gwei,
   se convierte a PLS). Si el nodo no sirve ese endpoint, el bloque se
   registra igualmente pero sin cifra.
5. Inserta el evento en `eventos` y suma 1 a `daily.bloques`.
6. Guarda la última epoch revisada en `meta`.

### Sobre los huecos

Cada ejecución revisa como mucho `MAX_EPOCHS_POR_RUN` (20) epochs, y siempre
empieza por **las más antiguas pendientes**. Tras un apagón largo la cola se
recupera en varias pasadas sin saltarse ninguna epoch. Con el cron cada 3 min
y epochs de 5,33 min (32 slots × 10 s), el ritmo de recuperación es de ~20
epochs cada 3 minutos: unas 6 horas de parón se recuperan en menos de 10
minutos.

Si una epoch falla (el nodo no responde), el bucle se detiene ahí y guarda
hasta la última epoch completada, de modo que el siguiente run la reintenta en
vez de saltársela.

### Bloques anteriores a la puesta en marcha

En el primer arranque no se intenta reconstruir el pasado: el nodo solo guarda
estados recientes y las epochs viejas no responderían. Los bloques ya
propuestos antes de activar esto hay que traerlos del explorador a mano.

Por los datos de `snapshots` hay al menos uno: entre las 17:00 y las 18:00 UTC
del 8-ago-2026 las recompensas subieron 8.607 PLS en una hora, contra los
~2.950 PLS/h del resto de intervalos. Ese salto tiene toda la pinta de ser una
propuesta de bloque.
