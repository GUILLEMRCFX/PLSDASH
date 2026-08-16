# Integración en `push.py` (NUC)

> **Si vienes solo a activar el precio, haz «Subir el precio al NUC» y nada
> más.** Lo de abajo es contexto y cosas ya hechas.

---

# Subir el precio al NUC — pasos cortos

`push.py` vive en `/home/guillem/` del NUC, no en este repo, así que no puedo
verlo: **los pasos van anclados a texto que buscar, no a números de línea.**

Hoy `snapshots.precio_pls` está a `NULL` en las 197 filas que hay. No es que
falle: es que el `INSERT` todavía no lleva la columna. Esto lo arregla.

### 1. Copiar el módulo

```bash
scp nuc/precio_y_bloques.py guillem@NUC:/home/guillem/
```

### 2. Probarlo suelto, antes de tocar `push.py`

```bash
ssh guillem@NUC
cd /home/guillem && python3 -c "from precio_y_bloques import precio_pls; print(precio_pls())"
```

Tiene que imprimir un número, tipo `3.1e-05`. Si imprime `None`, para aquí: han
fallado los dos caminos (la Function y DexScreener) y no tiene sentido seguir.
Si antes del número imprime `la Function no respondió …; voy a DexScreener`, el
precio es bueno igual —está usando el respaldo— pero avísame.

### 3. Importar en `push.py`

Busca la zona de `import` de arriba del todo y añade:

```python
from precio_y_bloques import precio_pls
```

⚠ **Solo `precio_pls`.** No importes ni llames a `revisar_bloques`: `/api/val/ganancia`
ya registra los bloques desde Cloudflare y saldrían duplicados, cada copia con
un `ts` distinto.

### 4. Pedir el precio justo antes de escribir

Busca `INSERT INTO snapshots`. En la línea de **encima**, añade:

```python
precio = precio_pls()   # None si fallan la Function y DexScreener → NULL
```

### 5. Meter la columna en ese mismo `INSERT`

Tres retoques en la misma sentencia:

1. En la lista de columnas, añade `precio_pls` al final.
2. En el `VALUES`, añade **un `?` más**.
3. En la lista de parámetros, añade `precio` al final.

Debe quedar así (15 columnas → 16):

```python
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

**Cuenta los `?`: tienen que ser 16, los mismos que columnas y que parámetros.**
Si no cuadran, D1 rechaza la fila entera y se pierde el snapshot completo, no
solo el precio.

### 6. Esperar al cron

Los snapshots son horarios, en punto. La siguiente fila ya debería llevar
precio; no hace falta reiniciar nada si el cron llama al script.

### 7. Comprobar que ha entrado

```sql
SELECT ts, datetime(ts,'unixepoch'), precio_pls
FROM snapshots ORDER BY ts DESC LIMIT 3;
```

La fila de arriba tiene que traer un número. Si sigue `NULL`, mira el log del
cron: `precio_pls()` deja dicho por cuál de los dos caminos ha fallado.

---

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

# Validación (`validacion.py`)

Lo que el 8-ago se tomó por datos corruptos **eran barridos de saldo
legítimos**: el protocolo retira el excedente sobre los 32M cada ~8,1 h y
`ganado` vuelve a cero. Las guardias de monotonía que hubo aquí están
retiradas — habrían congelado la tubería cada ocho horas.

El panel ya calcula la ganancia real (barridos + excedente) por su cuenta
desde Cloudflare, así que esto no le hace falta para dar la cifra buena.


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
from validacion import revisar_snapshot, registrar_descarte

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
ok, motivo = revisar_snapshot(d1, ts, ganado)
if not ok:
    print(f"[push] snapshot rechazado: {motivo}")
    registrar_descarte(d1, motivo)
else:
    d1("INSERT INTO snapshots (...) VALUES (...)", [...])
```

**Una bajada de `ganado` no se rechaza.** Cada ~8,1 h el protocolo retira el
excedente sobre los 32M a la wallet y el contador vuelve a cero: es el
funcionamiento normal de la cadena. Lo único que corta esta guardia es una
subida disparatada —más de 8 veces el ritmo típico—, que sí delata una lectura
mala. El listón está en 8x y no en 3x porque una propuesta de bloque real ya
triplica el ritmo de esa hora.

## Qué rechaza exactamente `validar()`

Solo actúa si hay validadores `active_ongoing` y llevan más de una hora
activos; antes de eso un `ganado` a cero es legítimo. Cumplido eso, rechaza:

| Motivo | Por qué |
|---|---|
| `ganado_total` ausente o negativo | Un excedente negativo es imposible |
| `ganado_total` ≠ suma del detalle (±0,01) | Uno de los dos está mal y no se sabe cuál |

Ni `ganado_total` a cero ni `balance_total` igual al stake se rechazan: ambos
son exactamente lo que deja un barrido recién hecho.

Comprobado contra la fila corrupta real (la caza por tres motivos a la vez) y
contra las seis filas buenas del 8-ago, más los casos de validador recién
activado y de nodo aún sincronizando, que **no** deben rechazarse.

## 1. Importar

```python
from precio_y_bloques import precio_pls
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
un `0` de relleno se confunde con un precio real y deforma la gráfica de
evolución sin dejar rastro.

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

Mientras no llegue, el panel usa 46.905 —los activos medidos en el nodo el
9-ago-2026— y lo marca como «red sin medir».

Ese número resolvió un descuadre: con el registro completo (109.600) salían 4
bloques observados donde el modelo predecía 1, probabilidad del 2,3%. Con los
activos se esperan 2,5 y ver 4 tiene un 24% de probabilidad. Azar normal.

## 3. Revisar bloques en cada ejecución — ❌ NO SE INTEGRA

> **No llames a `revisar_bloques()`.** `/api/val/ganancia` ya registra los
> bloques desde Cloudflare, reconciliados contra la cadena. Si además los
> anotara el NUC saldrían duplicados, y cada copia con un `ts` distinto, que es
> peor que no tenerlos: el contador de bloques quedaría inflado y el registro
> de vida con eventos repetidos.
>
> El código se queda en el módulo por si algún día se decide al revés, pero hoy
> **no se llama**. Lo que sigue describe qué haría, no qué hay que hacer.

Al final del ciclo, después de escribir el snapshot, haría falta:

```python
revisar_bloques(d1)   # ← NO
```

Se apoya en la tabla `meta` para recordar la última epoch revisada, así que
sería seguro llamarlo en cada pasada del cron. Devuelve cuántos bloques nuevos
ha anotado, por si se quisiera registrar en el log.

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
