# 08 · ARQUITECTURA

**Cómo viaja un dato desde la cadena hasta la pantalla.**

**Versión:** 1.0 · 15 de septiembre de 2026

**Depende de:** 03 Modelo de datos · 04 Infraestructura · 05 Dependencias
**Alimenta a:** 09 Seguridad

---

## 1. El recorrido completo

```
La cadena            El NUC                  Cloudflare           El navegador
──────────           ──────                  ──────────           ────────────
beacon API     →  collector.py   
Prometheus     →  (compone)      
                       ↓
                   push.py       →  KV   (estado, 3 min)  →  el panel lee
                                 →  D1   (histórico, 1 h)  →  Functions leen

DexScreener    ←──────────────────  /api/precio  ←────────────  portada y panel
explorador     ←──────────────────  Functions
```

🟢 **DECIDED** · **Tres capas que no se saltan:**

| Capa | Qué hace | Qué no hace |
|---|---|---|
| **datos** | busca, reconcilia, calcula | no toca el DOM ni Three.js |
| **estado** | publica un objeto plano | no calcula |
| **escena / vista** | pinta | no busca ni calcula |

La esfera recibe números normalizados de 0 a 1. **Nunca hace `fetch`, nunca sabe
qué es un barrido, nunca calcula un APR.** Por eso se puede probar con datos
falsos sin tocar nada más.

---

## 1 bis. Dónde vive cada pieza

Los identificadores del despliegue. No son credenciales —las dos que sí lo son,
`VAL_PIN` y `VAL_SESSION_SECRET`, son *secrets* de Pages y no están en el
repositorio—, pero sin ellos no se puede tocar nada desde fuera del panel de
Cloudflare.

| Pieza | Dónde |
|---|---|
| Cuenta Cloudflare | `43fcbb2325e70c196b56d6759046fa55` |
| KV `PLSDASH_KV` | `05fb9dd64a104e48ab5f4d2f324efd9d` |
| D1 `validator-dashboard` | `8631f448-e656-4dca-b8a9-78fb7a8bb06a` (WEUR) |
| Proyecto Pages | `plsdash`, repo `GUILLEMRCFX/PLSDASH`, auto-deploy desde `main` |
| Estado actual del panel | KV, clave `validator:estado` |

**En el NUC** (Ubuntu 24.04), cron cada 3 minutos: `collector.py` compone el
estado y `push.py` lo publica. Los demás (`comprobar.py`, `explorador.py`,
`validacion.py`, `precio_y_bloques.py`) son herramientas de mano, no cron.

---

## 2. El reparto de escrituras

| Qué | Dónde | Cada cuánto |
|---|---|---|
| Estado completo | KV | 3 min |
| Snapshot | D1 | 1 hora |
| Cierre diario | D1 | 1×/día |
| Barridos y eventos | D1 | cuando ocurren |

**Total:** ~505 escrituras KV al día, sobre 1.000 de cuota.

---

## 3. Los endpoints

Bajo `/api/`, como Cloudflare Pages Functions.

**Público:**
- `/api/precio` — precio de PLS unificado, con caché de borde 60 s y KV como
  último precio bueno
- `/api/portfolio/[code]` — carteras guardadas en la nube
- `/api/inversiones` — historial de inversiones de las wallets

**Tras el guardia de sesión (`/api/val/*`):**
`auth`, `logout`, `estado`, `historico`, `ganancia`, `eventos`, `aportaciones`

⚠ Aquí figuraba también `ajustes`, y **ya no existe**: se retiró con el precio
de entrada editable, que pasó a ser una constante del código. La tabla `ajustes`
sí sigue en D1, huérfana, esperando a la migración aparcada.

🟢 **DECIDED** · La cookie de sesión es `Path=/`, así que cubre todo el panel sin
configuración extra.

⚠️ **`ganancia.js` es la pieza más compleja del proyecto** — 489 líneas de
reconciliación de barridos. Si algo falla con error de CPU, empezar por ahí.

---

## 4. La lógica compartida

🟢 **DECIDED** · `val/compartido/ganancias.js` contiene las funciones que
calculan dinero: `gananciaAcumulada`, `diarioReal`, `ritmoDiario`,
`referenciaGrupo`, `ganadoEntre`, `aprValidadorHora`.

**Nunca duplicar esa lógica.** Costó tres rondas afinar la reconciliación de
barridos, y dos copias divergen en cuanto alguien toca una.

⚠️ Cuando existían dos paneles, había una prueba que comparaba las cifras de los
dos con los mismos datos y exigía cero diferencias en 76 elementos. Ese es el tipo
de prueba que hace falta si alguna vez vuelve a haber dos consumidores.

---

## 5. Cómo se descubren los validadores

🟢 **DECIDED** · **Nada de índices. Nunca.**

```
keystores del disco  →  pubkeys  →  beacon API por pubkey  →  índices reales
```

⚠️ La beacon API **omite las pubkeys que no conoce sin dar error**. Doce
preguntadas, once respondidas: la que falta está esperando. Cruzar las dos listas
es lo que detecta ese estado.

Esto es lo que hace que ampliar no exija tocar código.

---

## 6. Decisiones de implementación que conviene no revisar

| Decisión | Por qué |
|---|---|
| **Módulos ES nativos con importmap** | Sin build, sin bundler, sin configuración de Pages que romper |
| **Three.js a pelo** | 165 KB frente a ~500 con React |
| **Canvas 2D para el Vault** | Sin librerías, módulo independiente |
| **Fuentes alojadas en el repositorio** | Son variables: 69 KB los dos frente a 207. Y permiten revisar capturas sin depender de Google |
| **`ON CONFLICT DO NOTHING` sin objetivo explícito** | Se traga los choques de unicidad pero deja salir un `NOT NULL` |
| **Un solo contexto de WebGL** | La esfera de la pantalla de carga se muda al panel en vez de crearse dos veces |

---

## 7. Trampas de implementación ya pagadas

⚠️ **Comillas inversas dentro de comentarios en plantillas.** Han tumbado la
página **nueve veces**. `node --check` no las caza: valida como script clásico y
el fallo solo aparece al compilar como módulo. Hay una prueba que importa los 22
módulos.

⚠️ **Una llave `}` de más en CSS no es un error de sintaxis.** Cierra un bloque
antes de tiempo y desplaza todo lo posterior en silencio. Hay una comprobación
que cuenta llaves.

⚠️ **`addEventListener('input', fn)` pasa el evento como primer argumento.** En
cuanto `fn` acepta un parámetro, el evento entra por él.

⚠️ **Los literales de URL no se pueden buscar con `grep`** si se componen al
vuelo. Dos endpoints se dieron por muertos y estaban vivos. Hay una prueba que
reconstruye las URL como el navegador.

⚠️ **`bind()` en D1 devuelve una sentencia nueva**, no muta la preparada. Un doble
de pruebas que la comparta convierte un lote de tres en tres veces la última.

⚠️ **Un dato que legítimamente no existe, metido en una conversión que da por
hecho que sí, mata al recolector entero.** Ha pasado dos veces con la misma
forma: `epoch_a_fecha(2^64-1)` lanzaba `OverflowError`, e `int(d["indice"])`
lanza `TypeError` cuando el validador aún no tiene índice. Ninguna de las dos
está envuelta en su bucle, así que la excepción sube hasta arriba y **no se
publica nada** — el panel se queda DESFASADO durante toda la espera, que es
justo cuando más se mira. Antes de meter un campo nuevo que pueda venir a
`None`, buscar todos los `int(...)`, `round(...)` y rebanadas que lo tocan; el
que se escapó la segunda vez estaba en `imprimir_resumen`, o sea en
`--resumen`, que es lo primero que se ejecuta a mano cuando algo va raro.

⚠️ **`Number(null)` es `0`, no `NaN`.** Un `.sort((a, b) => Number(a.indice) -
Number(b.indice))` con un índice ausente no deja el elemento donde estaba: lo
manda al principio. En la esfera, eso metía al validador nuevo en la primera
posición y movía de sitio a los once que ya estaban, sin que hubiera pasado
nada. Donde un campo pueda faltar, el comparador tiene que decirlo a mano
(`d.indice == null ? Infinity : Number(d.indice)`).

⚠️ **Un dato codificado en el TAMAÑO de algo en 3D compite con la perspectiva, y
la perspectiva suele ganar.** Medido en píxeles, la diferencia entre el
validador con 0 bloques y el que tenía 13 era de **1,17×**, enterrada bajo un
**1,61×** que solo dependía de en qué cara de la esfera hubiera caído el nodo.
El ruido era tres veces y media la señal. Antes de calibrar nada que se dibuje
en perspectiva, **medir primero cuánto ruido mete la profundidad**. Se corrige
escalando el quad por su propia profundidad (`COMPENSA_PROF`).

⚠️ **Una escala normalizada por el máximo se degrada sola.** Con un rango de 1 a
7 bloques, uno de diferencia movía 1/7 de la escala; con 0 a 13 mueve 1/13; con
5 a 30 movería 1/30. Cuanto más tiempo lleva el sistema funcionando, menos se
distingue nada. Comparar contra la **mediana** del grupo no tiene ese problema
y además no se lo lleva por delante un caso con suerte. Y el suelo para que el
mínimo siga viéndose va en la GEOMETRÍA, no en el mapeo del dato: puesto en el
mapeo se comía el 28 % de la escala antes de empezar.

⚠️ **`_routes.json` no controla qué se sirve como estático.** Decide dónde corre
el runtime de Functions, nada más. Lo demuestra el propio repositorio:
`/val/v2/paneles/*` está en `exclude` y el navegador lo descarga en cada carga.
Igual `pruebas/`, `nuc/`, `migraciones/` y `docs/`: son descargables. No hay
credenciales en ellos —el NUC las lee de su `.env`, y las IP y la parte de
seguridad se quedan fuera del repositorio a propósito— pero conviene saberlo
antes de mover nada más ahí dentro. Ver incógnita T4 del documento 27.

⚠️ **La regla del navegador para `[hidden]` es
`[hidden]:not([hidden="until-found"])`**: dos atributos, así que le gana a una
clase pero pierde contra un id. En cuanto `#v-esfera` se llevó su propio
`display`, la esfera dejó de esconderse y seguía dibujándose al pie de las otras
pestañas, gastando GPU en algo que nadie miraba.

⚠️ **`input[type=range]` no mueve el tirador de 0 % a 100 %** del ancho: lo mueve
entre los centros de las posiciones extremas, con medio tirador de margen a cada
lado. Una marca colocada con `left: X%` queda hasta 10 px del tirador que dice
marcar.

⚠️ **En iOS, Safari y la app instalada tienen cachés separadas.** Entró la hoja
nueva en la app y se quedó la vieja en Safari: marcado nuevo maquetado con
reglas viejas. `_headers` ya manda `no-cache` y aun así ocurrió, así que
`vigilarHoja()` en `val/v2/index.html` lo detecta y vuelve a pedir la hoja.

⚠️ **`env(safe-area-inset-*)` puede devolver 0 en una PWA instalada.** Por eso
las áreas seguras van con `max(…, suelo)` y no a pelo.

⚠️ **`scrollend` no siempre llega.** Puede no dispararse nunca si el
desplazamiento acaba fuera del hilo principal, así que el temporizador de reposo
va **siempre** y `scrollend` solo sirve para expandir antes.

---

## 8. Las pruebas

🟢 **DECIDED** · Viven en `pruebas/` **dentro del repositorio**, con
`./pruebas/correr.sh`. Dos veces se perdieron al reiniciarse el contenedor.

Unas 350 comprobaciones. Las de lógica pura corren sin navegador; las de vista con
Playwright.

🟢 **DECIDED** · **Una prueba se verifica al revés:** se rompe el código a
propósito y tiene que ponerse roja. Una prueba que pasa siempre no prueba nada.

---

## 9. Preguntas abiertas

- ¿Merece la pena una prueba que compare el panel contra sí mismo entre
  despliegues, para detectar cambios no intencionados de cifras?
- La capa de datos asume un solo propietario. ¿Qué habría que cambiar si alguna
  vez hubiera más? Ver documento 27, incógnita N1.
- `ganancia.js` son 489 líneas. ¿Se parte, o la complejidad es inherente?
