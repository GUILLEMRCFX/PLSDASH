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
