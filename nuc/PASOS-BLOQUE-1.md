# NUC · pasos del bloque 1

Cuatro pasos, en este orden. El orden importa: los dos primeros son de la web y
el tercero borra columnas que el código de hoy todavía nombra.

---

## Paso 0 — Antes de nada, fusiona y espera al despliegue

Comprueba que `plsdash.com` carga y que `/val/` enseña las ganancias. Si eso
falla, **para aquí**: la migración de la base de datos daría el mismo síntoma y
no sabrías cuál de las dos cosas fue.

---

## Paso 1 — La migración de D1

Desde tu máquina, con `wrangler`:

```bash
wrangler d1 execute validator-dashboard --remote --file=migraciones/001-limpieza.sql
```

O pégalo en la consola de D1 del panel de Cloudflare. El fichero lleva escrito
qué borra cada línea y por qué.

**Después, comprueba que sigue habiendo datos:**

```sql
SELECT COUNT(*) FROM snapshots;   -- 355 o más
SELECT COUNT(*) FROM barridos;    -- 484 o más
SELECT COUNT(*) FROM daily;       -- 15 o más
```

---

## Paso 2 — Actualizar los scripts del NUC

`push.py` y `collector.py` cambian los dos.

```bash
rm -rf /tmp/plsdash
git clone https://github.com/GUILLEMRCFX/PLSDASH.git /tmp/plsdash
cp /tmp/plsdash/nuc/*.py /home/guillem/
```

**Prueba en seco antes de dejarlo suelto:**

```bash
cd /home/guillem
python3 push.py --dry
```

No escribe nada. Enseña qué haría. Si sale un error de columna, es que el
paso 1 no se ha ejecutado.

---

## Paso 3 — Comprobar que los minutos caídos se miden

Esto es lo único nuevo del bloque, así que conviene mirarlo de frente.

**Primero, qué está raspando Prometheus:**

```bash
curl -s 'http://localhost:9099/api/v1/query?query=up' \
  | python3 -m json.tool | grep -E '"job"|"instance"|"value"'
```

Sale una línea por objetivo. `1` es arriba, `0` es abajo.

**Y ahora la medida de un día cerrado** (cambia la fecha por la de ayer):

```bash
cd /home/guillem
python3 -c "
import push
print('minutos caidos ayer:', push.minutos_caidos('2026-08-22'))
"
```

- Un número → se está midiendo. `0` significa que no hubo caídas ese día, y
  ahora eso es un hecho medido y no un cero por omisión.
- `None` → Prometheus no cubre ese día. `push.py` conservará lo que hubiera en
  vez de escribir un cero, que se leería como «no hubo caídas».

**Si te salen objetivos que no quieres que cuenten** (un exportador de prueba,
algo que apagas a ratos), acótalo en `~/.validator-dashboard.env`:

```
PROM_UP=up{job=~"node|lighthouse"}
```

Sin esa línea valen todos y manda el peor, que es lo más conservador.

---

## Paso 4 (opcional pero recomendado) — Rellenar los días ya pasados

`push.py` mide al cerrar cada día, así que **los 15 días que ya están en la
tabla se quedan a 0**, y un 0 sin medir se lee igual que «no hubo caídas». Si la
retención de tu Prometheus llega —15 días es lo que trae de fábrica—, se pueden
rellenar de una pasada.

**Primero mira qué saldría, sin escribir nada:**

```bash
cd /home/guillem
python3 -c "
import push
cfg = push.cargar_env()
filas = push.d1_filas(push.d1_query(cfg, 'SELECT fecha FROM daily ORDER BY fecha'))
for f in filas:
    print(f['fecha'], push.minutos_caidos(f['fecha']))
"
```

Los que salgan `None` están fuera de la retención y hay que dejarlos como
están. **Si los números tienen sentido**, escríbelos:

```bash
cd /home/guillem
python3 -c "
import push
cfg = push.cargar_env()
filas = push.d1_filas(push.d1_query(cfg, 'SELECT fecha FROM daily ORDER BY fecha'))
for f in filas:
    m = push.minutos_caidos(f['fecha'])
    if m is None:
        print(f['fecha'], 'sin medida, se deja'); continue
    push.d1_query(cfg, 'UPDATE daily SET minutos_caido=? WHERE fecha=?', [m, f['fecha']])
    print(f['fecha'], '→', m, 'min')
"
```

Los días que se queden sin medida seguirán contando como 0 en el porcentaje de
disponibilidad. Es lo que hay: nadie guardó ese dato cuando pasó.

---

## Lo que esta medida NO ve, para que conste

- **Atestaciones perdidas con la máquina encendida.** Prometheus aquí solo tiene
  métricas de `node_exporter` y del beacon; efectividad de atestación no hay en
  ninguna parte. Esto mide «el exportador no respondía», que es la mejor señal
  disponible, no la única que existiría.
- **Las caídas del propio Prometheus.** Si el que se cayó fue él, en esa ventana
  no hay muestras y la media sale de las que sí existen. Su propia caída es
  invisible para él.

Los dos límites están escritos también en el código, junto a la función.

---

## Y una cosa que sigue rota, aunque no toque en este bloque

`daily.ganado_acum` **no es un acumulado**. Guarda `validadores.ganado_total`,
que es lo generado *y todavía no barrido*: cuando el protocolo barre un
validador, esa cifra cae en picado. Por eso sube y baja —20.728 → 13.861 →
12.897 → 22.019— y por eso `ganado_dia = max(0, diferencia)` sale **0 en 9 de
los 15 días** y doble en los otros 6.

No se ve en pantalla porque los paneles ya no se fían: recalculan el día desde
`snapshots`. Pero la tabla miente, y si algún día alguien la cree, se llevará el
disgusto. Queda anotado para cuando toque.
