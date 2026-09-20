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
`auth`, `logout`, `estado`, `historico`, `ganancia`, `eventos`, `aportaciones`,
`ajustes`

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
