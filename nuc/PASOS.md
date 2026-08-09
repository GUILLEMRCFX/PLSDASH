# Qué hacer, en orden

Cuatro pasos. Los dos primeros son los que importan; los otros dos pueden
esperar.

---

## Paso 1 — Copiar los archivos al NUC

**Mientras la rama no esté fusionada hay que pedirla por su nombre**: un
`git clone` a secas trae `main`, donde esta carpeta todavía no existe.

```bash
rm -rf /tmp/plsdash
git clone -b claude/lo-pillas-hqchw0 \
  https://github.com/GUILLEMRCFX/PLSDASH.git /tmp/plsdash
cp /tmp/plsdash/nuc/*.py /home/guillem/
```

Una vez fusionada la rama a `main`, el `-b ...` sobra.

## Paso 2 — Comprobar que todo responde

```bash
cd /home/guillem
python3 comprobar.py
```

Imprime una línea por cosa comprobada y, al final, tu ganancia real. **Pégame
esa salida**: dice de un vistazo qué funciona y qué no.

No modifica nada, solo lee. Se puede ejecutar cuantas veces se quiera.

## Paso 3 — Enganchar el precio y los bloques en `push.py`

Esto es lo único urgente de verdad: **el precio de PLS no se puede recuperar
después**. Cada hora que pasa sin guardarlo es una hora perdida para siempre
de cara a la fiscalidad.

Tres cambios, detallados en `INTEGRACION.md`:

1. `from precio_y_bloques import precio_pls, revisar_bloques`
2. Añadir `precio_pls()` a la lista de columnas del `INSERT INTO snapshots`
3. Llamar a `revisar_bloques(d1)` al final del ciclo

## Paso 4 — Rate limiting y subdominio

Cuando quieras. Ninguno bloquea nada.

- **Rate limiting**: Cloudflare → Security → WAF → Rate limiting rules.
  10 peticiones por minuto a `/api/val/auth`, bloqueo de 10 min.
- **Subdominio**: crea `val.plsdash.com` apuntando al proyecto de Pages y
  luego define la variable de entorno `VAL_HOST=val.plsdash.com`. Hasta que
  esa variable exista el panel sigue en `plsdash.com/val/` y nada cambia.

---

# Cómo saber que está terminado

## La comprobación de fondo

`comprobar.py` termina imprimiendo la ganancia real. **Ese número tiene que
ser el mismo que muestra el panel.** Si coinciden, toda la cadena funciona:
recolección, barridos, almacenamiento, reconciliación y cálculo.

Si el panel muestra una cifra parecida al excedente sin barrer —unos 29.000
PLS frente a los ~171.000 reales— es que la reconciliación no está llegando.

## Señales de que algo va mal

| Lo que ves | Qué significa |
|---|---|
| «El NUC no reporta desde hace X min» | La máquina o el cron están parados |
| «Datos rechazados, no es el NUC» | El nodo responde pero sus lecturas no pasan la validación |
| Ganancia ≈ excedente sin barrer | La reconciliación con la cadena no funciona |
| «red sin medir» en Propuestas | Falta publicar `red_validadores_activos` (paso 2b) |
| «suelo: falta lo barrido...» | Normal si el explorador no responde; se cae a los snapshots |

## Lo que solo el tiempo confirma

Tres cosas necesitan días de funcionamiento, no una comprobación:

- **Que `daily` cierre bien cada jornada.** El panel ya no depende de
  `daily.ganado_dia` —lo recompone de la serie—, pero conviene que la tabla
  acabe siendo correcta.
- **La frecuencia real de bloques.** Hay un descuadre sin resolver: se
  observaron 4 bloques donde 10 de 109.600 predicen 1 (probabilidad del 2,3%).
  Con una semana de contador real se sabrá si el modelo está mal o fue azar.
- **El runway de disco.** Necesita varios días de `disco_pct` para que la
  tendencia signifique algo.

## Lo que queda pendiente y no es urgente

- `daily.ganado_dia` sigue guardando el excedente a medianoche en vez de lo
  ganado en el día. El panel ya no lo usa, pero la tabla queda mal para quien
  la consulte directamente.
- Los barridos anteriores al arranque del recolector solo los ve el
  explorador. Si algún día falla, la cifra del panel baja a ser un suelo y lo
  dice.
