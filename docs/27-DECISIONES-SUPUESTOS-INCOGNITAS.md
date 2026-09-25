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
| **El depósito se lee del spec de la cadena** | 20-sep-2026 | `/eth/v1/config/spec` → `MAX_EFFECTIVE_BALANCE`, o `MIN_ACTIVATION_BALANCE` post-Electra. Antes era una constante de 32M en `collector.py`, y este registro afirmaba que salía de `stake_total / total`: falso, porque `stake_total` se componía multiplicando esa constante. Queda un respaldo con comprobación de rango que caza Electra a ciegas y los fallos de unidades. |
| **NO se lee de `effective_balance`** | 20-sep-2026 | No es el depósito, es el stake que cuenta para el consenso: baja con las penalizaciones, así que el depósito de referencia encogería justo el día que algo va mal. Además está cuantizado con histéresis y vale 0 mientras el validador está `pending_initialized`. |

### Producto

| Decisión | Cuándo | Por qué |
|---|---|---|
| **Cinco pestañas, incluida la Esfera** | sep-2026 | Reparto equilibrado: de 454–2.252 px a 887–1.242 px a 390 px. Son cinco en total —Resumen, Ganancias, Validadores, Nodo, Esfera—, no cinco más una. |
| **Guiar no es operar (P9)** | 23-sep-2026 | «El panel compone texto que tú copias y observa el resultado en los datos que ya publica el NUC. No abre conexiones, no escribe en el NUC, no firma, no sube nada.» Cerró la incógnita P1. Sigue siendo cierta aunque la pestaña que la aplicaba se retirara. |
| **El Resumen es el patrimonio** | 25-sep-2026 | La cifra grande era «Total generado» (~45 $) y los ~4.300 $ del stake no salían en ningún sitio. Ahora: franja de salud arriba —encima del dinero a propósito—, patrimonio en dólares con los PLS debajo, tres filas que lo suman y hacen de selector, y lo generado aparte porque no suma. El ritmo y el precio quedan debajo, en pequeño. |
| **Una sola cifra protagonista por pestaña** | 25-sep-2026 | Había muchos números del mismo peso compitiendo. |
| **La wallet de retirada y la activación, de la cadena** | 23-sep-2026 | El recolector las lee de las `withdrawal_credentials` y de la epoch de activación; dejan de estar escritas en `ganancia.js`, `explorador.py` y `datos.js`. Es lo que se queda de la regla de los cuatro niveles de dato personal, que nació con la pestaña Ampliar. |
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
| **Nada de números vivos escritos a fuego** | sep-2026 | El v1 tenía `const V11 = 32_000_000`. El objetivo sale de `total + 1` y el depósito del spec de la cadena (ver la decisión de arriba). La detección de depósitos en Inversiones busca la **forma**, no la cifra. Un hecho cerrado del pasado sí puede ser constante: el precio del sacrificio ocurrió una vez. |
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
| **Pestaña Ampliar** —la guía de seis pasos para añadir un validador, la comprobación del `deposit_data` en el navegador, el host del nodo en el navegador, la sexta pestaña y el tema dentro de Nodo— | **El propietario la probó y no le convenció.** Estuvo del 23 al 25-sep-2026 (PR #68). La trayectoria y el simulador volvieron a Validadores, las aportaciones a Ganancias, el tema a la barra y las pestañas a cinco. Se quedó lo que valía sin ella: la wallet y la activación leídas de la cadena, el arreglo de `explorador.py` y el del repintado que borraba lo escrito. | 25-sep-2026 |

---

## PARTE 3 · SUPUESTOS

**Lo que damos por cierto sin haberlo comprobado.**

| Supuesto | Riesgo si es falso | Cómo validarlo |
|---|---|---|
| 🟡 **El ciclo de barrido dura ~8,1 h de forma estable** | La predicción del próximo barrido se descalibra | Seguir midiendo; entender de qué depende |
| 🟡 **La heurística de bloques acierta** | El desglose base/suerte y el recuento de bloques serían falsos | Contrastar contra el CSV de ValDash |
| 🟡 **`PRECIO_SACRIFICIO = 0,0001` es correcto** | El «frente a tu entrada» miente por un factor de diez | El propietario lo confirmó contra el gráfico WPLS/DAI. Sin segunda fuente. |
| 🟡 **Las tres direcciones de stablecoin son correctas** | Las entradas reales caen en «no cuadra» en vez de contar como dólares | Mirar si alguna entrada conocida aparece en descuadres |
| 🟡 **No hay pagos MEV-Boost en este nodo** | Habría ingresos no contabilizados | No verificado. ValDash tampoco los incluye. |

---

## PARTE 4 · INCÓGNITAS

### Técnicas

| # | Incógnita | Impacto |
|---|---|---|
| T1 | 🔴 **¿Qué es la tercera wallet de `meta`?** Tiene cursores de siembra y no está documentada. | Medio — puede estar consumiendo peticiones del explorador por nada |
| T2 | 🔵 **¿Por qué el explorador no responde desde el navegador?** Sí desde el servidor. | Bajo — hay solución, falta la causa |
| T3 | 🔵 **¿Qué límites reales tiene DexScreener?** Nunca consultados. | Bajo — mitigado por caché |
| T4 | ✅ **Resuelta el 25-sep-2026: publicar solo `public/`.** Una Function con 404 fallaba abierta al agotarse la cuota; `_redirects` no admite 404. Ver documento 08. Antes: «¿Cómo se bloquea de verdad `nuc/`, `migraciones/` y `pruebas/`?» | Medio — ver documento 09 |
| T5 | 🟢 **Resuelto el 21-sep-2026: Time Travel de D1**, 30 días, sin construir nada. Se aceptan sus dos límites: vive en la misma cuenta y son 30 días. Ver documento 07. 🔴 **El ensayo de restauración sigue pendiente.** | Bajo, salvo el ensayo |
| T6 | 🔵 ¿Se arregla `daily` o se retira? Nadie la lee, la causa está localizada. | Bajo |

### De datos

| # | Incógnita | Impacto |
|---|---|---|
| D1 | 🟢 **`barridos.precio_pls` se rellena desde el 21-sep-2026**, con el precio que `snapshots` registró en la misma hora. Deja de empeorar. Queda abierto si se sella también el pasado —se puede, `snapshots` llega hasta el 16-ago— o se da por perdido. | Bajo ya: la hemorragia está cortada |
| D2 | 🔴 **La efectividad real de atestación no se puede calcular.** Ni un dato en toda la base. | Medio — hoy se evita mostrarla |
| D3 | 🔵 El evento del 18-ago dice «Validadores recuperados» y fue una activación. | Bajo — cosmético |
| D4 | 🔵 El desglose base/suerte usa todo el histórico. ¿Ventana móvil? | Bajo |

### De producto

| # | Incógnita | Impacto |
|---|---|---|
| P1 | ✅ **Resuelta el 23-sep-2026: guiar no es operar.** Ver Parte 1, Producto. | — |
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

*(A 23-sep-2026 están resueltas la primera y la tercera; queda el ensayo de la copia.)*

### ✅ 1 · `barridos.precio_pls` — RESUELTO el 21-sep-2026

Era la única incógnita que **empeoraba cada día**. Ya no: `/api/val/ganancia`
sella cada barrido nuevo con el precio que `snapshots` registró en su misma
hora, con 90 minutos de tolerancia y un hueco honesto cuando no hay ninguno.

**No fue «una línea al insertar»**, y conviene saber por qué: un barrido se
DESCUBRE cuando alguien abre el panel, que pueden ser horas después de que la
cadena lo hiciera. Sellarlo con el precio de ese momento habría sido
inventarse un precio retroactivo, igual de falso que inventárselo hacia atrás.

**Y el pasado también**, el mismo día y por decisión explícita del propietario:
la migración `002` selló **1.154 de 1.434** barridos con precios reales que ya
estaban en `snapshots`. Los 280 restantes son anteriores al primer snapshot con
precio y ésos sí se quedan vacíos. Comprobado contra producción: los 1.154
precios coinciden con un snapshot real a menos de 90 minutos.

### 🟡 2 · Copia de seguridad de D1 — T5, decidida y sin ensayar

**Decidido el 21-sep-2026:** Time Travel de D1. 30 días de recuperación
punto-a-punto, ya activo, cero coste, nada que construir. Sus dos límites se
aceptan a sabiendas: vive en la misma cuenta de Cloudflare y caduca a los 30
días.

🔴 **Lo que sigue abierto es el ENSAYO.** Una copia que nunca se ha probado a
restaurar no es una copia. El procedimiento está en el documento 07, sección 4,
con un ensayo diseñado para no poder salir mal —restaurar al instante actual—.
No se ha ejecutado.

### ✅ 3 · El principio P9 — RESUELTO el 23-sep-2026

Guiar no es operar. La línea, escrita tal cual:

> El panel compone texto que tú copias y observa el resultado en los datos que ya publica el NUC. No abre conexiones, no escribe en el NUC, no firma, no sube nada.

La pestaña Ampliar se construyó sobre ella y se retiró el 25-sep-2026 (ver la
Parte 2); la frase se queda porque sigue siendo cierta.

---

## PARTE 6 · REGISTRO DE CAMBIOS DE ESTE DOCUMENTO

| Fecha | Cambio |
|---|---|
| 15-sep-2026 | Versión 1.0. Consolidadas las preguntas abiertas de los documentos 01 a 05. |
| 20-sep-2026 | Auditoría del código contra los documentos. Trece decisiones superadas y de interfaz que faltaban. Corregido el depósito —estaba escrito a fuego y aquí decía que no— y el recuento de pestañas. |
| 23-sep-2026 | P9 decidido y P1 cerrada. Seis pestañas, el tema en Nodo, los cuatro niveles de dato personal, «manda lo observado» y la comprobación del `deposit_data`. |
| 25-sep-2026 | El Resumen pasa a ser el patrimonio; una cifra protagonista por pestaña. |
| 25-sep-2026 | La pestaña Ampliar pasa a decisiones superadas: el propietario la probó y no le convenció. Vuelven las cinco pestañas. |
