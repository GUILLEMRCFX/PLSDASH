# 27 · DECISIONES, SUPUESTOS E INCÓGNITAS

**El registro. Tan importante como la constitución.**

**Versión:** 1.0 · 15 de septiembre de 2026

**Depende de:** todos los demás
**Alimenta a:** todos los demás

> Aquí se consolidan las preguntas abiertas de cada documento. Si una decisión no
> está escrita aquí, dentro de seis meses nadie recordará por qué se tomó — ni
> por qué se descartó la alternativa.

---

## PARTE 1 · DECISIONES TOMADAS

### Arquitectura

| Decisión | Cuándo | Por qué |
|---|---|---|
| **Sin build, HTML plano** | ago-2026 | Poner `dist` como salida tumbaría el sitio público entero. Permitió descartar React. |
| **Three.js a pelo, no R3F** | ago-2026 | 165 KB frente a ~500. La escena es un objeto que no muta; R3F brilla cuando el árbol cambia con el estado. |
| **Sin GSAP** | ago-2026 | Las transiciones son interpolaciones de uniforms dentro del bucle de render: 30 líneas. |
| **El NUC empuja, Cloudflare no pregunta** | ago-2026 | El nodo no expone nada a internet. |
| **Cron a 3 minutos** | ago-2026 | 480 escrituras/día sobre 1.000 de cuota KV. A 1 minuto se agotaría. |
| **KV para lo de ahora, D1 para lo de siempre** | ago-2026 | KV se regenera en 3 min; D1 no vuelve. |

### Modelo de datos

| Decisión | Cuándo | Por qué |
|---|---|---|
| **`pls_hora` y `apr` a NULL** | 19-ago-2026 | Las dos fórmulas estaban mal por numerador y denominador. Una cifra falsa es peor que un hueco. |
| **Índice único con `COALESCE`** | ago-2026 | `validador` es NULL en los barridos y en SQLite los NULL no son iguales entre sí. Un UNIQUE normal solo habría protegido los bloques. |
| **`validador_diario` no se borra** | sep-2026 | Sin lector, pero es el único histórico por validador y día. Irreversible. |
| **El depósito de un validador esperando no se suma al capital** | sep-2026 | Un keystore no demuestra depósito. Sumarlo envenenaría el APR y el titular. |

### Producto

| Decisión | Cuándo | Por qué |
|---|---|---|
| **Cinco pestañas + esfera propia** | sep-2026 | Reparto equilibrado: de 454–2.252 px a 887–1.242 px a 390 px. |
| **La esfera no es navegación** | ago-2026 | En 390 px, elegir un validador girando una esfera es peor que tocar una fila. |
| **Malla Voronoi, no geodésica** | ago-2026 | La geodésica hace muaré y deja costura en el ecuador. Y una malla irregular dice «red». |
| **Sin bloom** | ago-2026 | Con el resplandor dentro de cada primitiva, el postprocesado lo aplica dos veces: negro a gris. |
| **Cinco temas de color** | sep-2026 | Disuelve el problema de tener tres paletas: pasan a ser opciones. |
| **Desglose base/suerte, no ranking** | ago-2026 | La base por ciclo varía 2,2 % entre validadores. Un ranking sería una tabla de suerte. |
| **El Vault es puerta, no cerradura** | ago-2026 | Autenticar en la portada pública no aportaba nada; el PIN ya está en `/val/`. |
| **Registro manual de aportaciones** | sep-2026 | La cadena no distingue una aportación propia. Exacto porque tú sabes lo que mandaste. |
| **Historial de inversiones sin regla de reparto** | sep-2026 | Clasificar por transacción, no por transferencia: la propia transacción dice si es entrada o swap. Sin notas de procedencia no hay regla que equivocarse. |

### Proceso

| Decisión | Cuándo | Por qué |
|---|---|---|
| **Todos los commits antes de abrir el PR** | sep-2026 | Seis veces se perdió trabajo por añadir commits después de fusionar. |
| **PR abierto es PR cerrado** | sep-2026 | Lo que venga después va en uno nuevo. |
| **Todos los PR contra `main`** | sep-2026 | Encadenarlos hizo imposible saber qué estaba desplegado. |
| **La suite vive en el repositorio** | sep-2026 | Dos veces se perdieron pruebas al reiniciarse el contenedor. |
| **Si un cambio retira la única alternativa a algo, va en su propio commit** | sep-2026 | Para poder revertir solo eso. Al retirar el v1: la puerta en un commit, el borrado en otro. |
| **Lo visual se mira antes de mandarlo** | sep-2026 | Captura a 1440 y a 390, mirada por quien la hace. Las dos correcciones de la puerta del PIN salieron de mirar la captura, no de mandarla. |

### Interfaz

| Decisión | Cuándo | Por qué |
|---|---|---|
| **Nada de números vivos escritos a fuego** | sep-2026 | El v1 tenía `const V11 = 32_000_000`. El depósito sale de `stake_total / total` y el objetivo de `total + 1`. La detección de depósitos en Inversiones busca la **forma**, no la cifra. Un hecho cerrado del pasado sí puede ser constante: el precio del sacrificio ocurrió una vez. |
| **El color nunca viaja solo** | ago-2026 | Verde y naranja se distinguen mal bajo deuteranopía: todo estado lleva su palabra al lado. |
| **La esfera es decoración con dato** | ago-2026 | El mismo dato está en la tabla de Validadores, que sí se puede leer y recorrer con teclado. |

---

## PARTE 2 · DECISIONES SUPERADAS

**No volver a proponer esto.** Cada una se descartó con motivo.

| Se descartó | Por qué | Cuándo |
|---|---|---|
| **React + R3F + Drei + GSAP** | 3× de descarga para una escena de un objeto, y obliga a un build que pone en riesgo el sitio público. | ago-2026 |
| **Esfera geodésica** | Muaré a densidad alta y costura visible en el ecuador. | ago-2026 |
| **Bloom / postprocesado** | Duplicaba el resplandor. Brillo medio 19 → 59, halo 12 % → 78 %. | ago-2026 |
| **Gráfico circular en 3D** | La perspectiva deforma la relación ángulo/área: miente sobre las proporciones. Y 259 KB en una portada de 32 KB. | sep-2026 |
| **Ranking de validadores** | Tabla de suerte disfrazada de rendimiento. El que más bloques tenía era el que menos base. | ago-2026 |
| **Bloques esperados vs observados** | El divisor de red no cuadra: 46.905 declarados contra ~32.700 implícitos. | ago-2026 |
| **Tamaño de nodo por bloques/hora** | Un golpe de suerte convertiría al recién llegado en el nodo más grande. | sep-2026 |
| **Descontar lo aportado del progreso** | Para depositar hacen falta 32M vengan de donde vengan. Sería la mentira contraria. | sep-2026 |
| **Gráfica de saldo + histórico de cartera** | Se descartó por decisión del propietario. | sep-2026 |
| **Exportar a CSV** | Descartado por el propietario. | sep-2026 |
| **Interruptores de Telegram** | Decorativos: no enviaban nada. Un interruptor que no conmuta enseña a desconfiar del panel. | sep-2026 |
| **`nuc/precio_y_bloques.revisar_bloques()`** | `/api/val/ganancia` ya registra los bloques: saldrían duplicados. | ago-2026 |
| **Aplicar el Foundation Method completo** | 28 documentos para describir decisiones ya tomadas es arqueología. Se hacen los que aportan. | sep-2026 |
| **Abrir PLSDASH como producto** | Mercado de unos pocos miles de operadores, tres competidores gratuitos ya establecidos. Ver sección de incógnitas de negocio. | sep-2026 |
| **Efectividad y atestaciones perdidas** | Engañosas tal y como se presentaban en el v1, y el coste de lo fallado era del orden de milésimas del total. No hay ni un dato de atestación en la base. | ago-2026 |
| **Comparativa de percentil contra la red** | Pediría datos de ~109.000 validadores. Se sustituyó por la comparación contra la media propia. | ago-2026 |
| **Modo kiosco** | No hay monitor dedicado. | ago-2026 |
| **Panel de concentración de riesgo** y **coste de apagón** | No cambian nunca; van como nota fija y como campo del registro, no como panel. | ago-2026 |
| **Animación de pulso / latido ECG** | Rechazada por poco profesional. El pulso de datos de hoy es otra cosa: dice si el NUC reporta. | ago-2026 |
| **Deslizador del simulador en euros** | El v1 dividía euros entre un precio en dólares, o sea daba por hecho que 1 € = 1 $. Hacerlo bien exige un tipo de cambio real: otra fuente que se cae y hay que vigilar. | sep-2026 |
| **Bloqueo por intentos de PIN fallidos** | Decisión explícita del propietario: el panel no está enlazado y es de solo lectura. Lo cubre una regla de Cloudflare sobre `/api/val/auth`, fuera del repositorio. **El PIN de 4 dígitos se queda como está.** | sep-2026 |

---

## PARTE 3 · SUPUESTOS

**Lo que damos por cierto sin haberlo comprobado.**

| Supuesto | Riesgo si es falso | Cómo validarlo |
|---|---|---|
| 🟡 **El ciclo de barrido dura ~8,1 h de forma estable** | La predicción del próximo barrido se descalibra | Seguir midiendo; entender de qué depende |
| 🟡 **La heurística de bloques acierta** | El desglose base/suerte y el recuento de bloques serían falsos | Contrastar contra el CSV de ValDash |
| 🟡 **`PRECIO_SACRIFICIO = 0,0001` es correcto** | El «frente a tu entrada» miente por un factor de diez | El propietario lo confirmó contra el gráfico WPLS/DAI. Sin segunda fuente. |
| 🟡 **Las tres direcciones de stablecoin son correctas** | Las entradas reales caen en «no cuadra» en vez de contar como dólares | Mirar si alguna entrada conocida aparece en descuadres |
| 🟡 **`plsmenu` mantendrá el mismo orden de pantallas** | La guía de ampliación daría pasos equivocados con el validador ya parado | Revisar tras cada actualización de `tdslaine/install_pulse_node` |
| 🟡 **No hay pagos MEV-Boost en este nodo** | Habría ingresos no contabilizados | No verificado. ValDash tampoco los incluye. |

---

## PARTE 4 · INCÓGNITAS

### Técnicas

| # | Incógnita | Impacto |
|---|---|---|
| T1 | 🔴 **¿Qué es la wallet `0xcb37f5…043f`?** Tiene cursores de siembra en `meta` y no está documentada. | Medio — puede estar consumiendo peticiones del explorador por nada |
| T2 | 🔵 **¿Por qué el explorador no responde desde el navegador?** Sí desde el servidor. | Bajo — hay solución, falta la causa |
| T3 | 🔵 **¿Qué límites reales tiene DexScreener?** Nunca consultados. | Bajo — mitigado por caché |
| T4 | 🔵 **¿Cómo se bloquea de verdad `nuc/`, `migraciones/` y `pruebas/`?** `_routes.json` no sirve. | Medio — ver documento 09 |
| T5 | 🔴 **¿Hay copia de seguridad de D1?** No consta ninguna. | **Alto** — es lo único que no se regenera |
| T6 | 🔵 ¿Se arregla `daily` o se retira? Nadie la lee, la causa está localizada. | Bajo |

### De datos

| # | Incógnita | Impacto |
|---|---|---|
| D1 | 🔴 **`barridos.precio_pls` sigue vacío**, 0 de 1.218. Todo se valora al precio de hoy. | **Alto y creciente** — cada día perdido es irrecuperable |
| D2 | 🔴 **La efectividad real de atestación no se puede calcular.** Ni un dato en toda la base. | Medio — hoy se evita mostrarla |
| D3 | 🔵 El evento del 18-ago dice «Validadores recuperados» y fue una activación. | Bajo — cosmético |
| D4 | 🔵 El desglose base/suerte usa todo el histórico. ¿Ventana móvil? | Bajo |

### De producto

| # | Incógnita | Impacto |
|---|---|---|
| P1 | **¿Guiar un proceso paso a paso viola el principio P9?** El panel observa, no opera. Dar comandos listos para copiar, ¿es observar? | **Bloquea la pestaña de ampliar** |
| P2 | ¿Qué objetivo tiene la web pública ahora que el trabajo está en el panel? | Medio |
| P3 | ¿Se reconcilia la paleta del Vault con los cinco temas? | Bajo |

### De negocio

| # | Incógnita | Impacto |
|---|---|---|
| N1 | **¿Se abre a otros operadores?** Hoy no. Requiere separar lo propio de lo genérico. | Alto si se decide que sí |
| N2 | **¿Cuántos operadores caseros hay de verdad?** ~47.000 validadores, pero un operador lleva varios. | Decide N1 |

---

## PARTE 5 · QUÉ BLOQUEA TODO LO DEMÁS

**De todo lo anterior, tres cosas deciden el rumbo. El resto puede esperar.**

### 🔴 1 · `barridos.precio_pls` — D1

**Por qué bloquea:** es la única incógnita que **empeora cada día**. Cada barrido
que pasa sin precio no se puede reconstruir nunca. Ya cometimos este error con
`snapshots.precio_pls` y lo arreglamos; aquí seguimos sin arreglarlo.

**Qué desbloquea:** el valor real de lo ganado, la cifra fiscal, y cualquier
comparación honesta entre lo que ganaste y lo que vale hoy.

**Coste:** una línea al insertar.

### 🔴 2 · Copia de seguridad de D1 — T5

**Por qué bloquea:** es el único dato irreemplazable del proyecto. 1.218
barridos, 910 snapshots, 291 eventos y 422 filas de histórico por validador. Si
se pierde, no vuelve.

**Coste:** bajo. Una exportación periódica.

### 🟡 3 · El principio P9 y la pestaña de ampliar — P1

**Por qué bloquea:** la siguiente función grande del panel depende de responderlo.
Si guiar cuenta como operar, la pestaña no se hace. Si no, se hace.

**Es una decisión, no una investigación.**

---

## PARTE 6 · REGISTRO DE CAMBIOS DE ESTE DOCUMENTO

| Fecha | Cambio |
|---|---|
| 15-sep-2026 | Versión 1.0. Consolidadas las preguntas abiertas de los documentos 01 a 05. |
