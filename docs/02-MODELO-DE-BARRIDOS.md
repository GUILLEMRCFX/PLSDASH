# 02 · EL MODELO DE BARRIDOS

**La lógica central del dominio. El documento más importante después de la
constitución.**

**Versión:** 1.0 · 13 de septiembre de 2026

**Depende de:** 01 Constitución
**Alimenta a:** 03 Modelo de datos · 06 El panel · 07 Operaciones

> Si no entiendes esto, cualquier cifra del panel te va a parecer un error.
> La mitad de los fallos de este proyecto han salido de no tenerlo claro.

---

## 1. El mecanismo

🟢 **DECIDED** · PulseChain retira automáticamente el excedente de cada validador
hacia la wallet de retirada. Ese excedente es todo lo que pasa de los 32.000.000
PLS del depósito.

El balance del validador vuelve a ~32M y empieza a acumular otra vez. Es un
diente de sierra, y es el comportamiento normal del protocolo.

🟢 **DECIDED** · **El periodo medido es de ~8,1 horas.** Medido sobre 40 ciclos
reales; los seis últimos dieron 8,14 / 8,10 / 8,04 / 8,07 / 8,08 h. Es lo bastante
regular como para predecir el siguiente.

🟡 **PROPOSED** · El periodo depende del tamaño de la red y de la posición de tus
índices en el recorrido. No se ha verificado qué pasa si la red crece mucho.

---

## 2. Las cinco consecuencias

**1. El balance del validador NO es lo que has ganado.**
Solo muestra lo acumulado desde el último barrido. Un validador con 32.000.026
PLS no ha ganado 26 PLS en su vida: ha ganado eso desde hace unos minutos.

**2. La ganancia real = suma de todos los barridos + el excedente sin barrer.**
Esa es la única cuenta correcta. La fuente de verdad es la tabla `barridos`,
alimentada leyendo las retiradas de la cadena.

**3. Las recompensas por proponer bloque también pasan por el balance.**
No llegan por otro canal: se acumulan igual y se barren con el resto. Un barrido
que incluye un bloque es del orden de 5.700 PLS más gordo que la media.

**4. Se pueden contar bloques desde las retiradas.**
Los barridos que se salen de la media llevaban un bloque dentro. Es una
heurística, no una medición — ver sección 5.

**5. Cada validador se barre en su propio momento del recorrido.**
🟢 **DECIDED** · No todos a la vez. El 109876 se barrió a las 14:02 cuando los
otros diez lo hicieron a las 13:58. **Nunca agrupar barridos por timestamp
exacto.**

---

## 3. La regla inviolable

> **Las bajadas de balance son normales y esperadas.
> Nunca añadir validación que las rechace.**

Una guardia de monotonía sobre el balance o sobre lo ganado rompería el sistema
cada ocho horas, de forma permanente y silenciosa.

Esto ya pasó: al ver el balance caer de 26.768 a 3.154 se ordenó una guardia que
rechazara bajadas. Eran barridos legítimos.

---

## 4. La distinción que lo gobierna todo: ganado ≠ acumulado

🟢 **DECIDED** · La palabra **«ganado»** significa dos cosas distintas según
dónde aparezca, y confundirlas es la causa de varios fallos de este proyecto:

| Dónde | Qué significa |
|---|---|
| `snapshots.ganado` en D1 | El excedente **sin barrer** en ese instante |
| `validadores.ganado_total` del collector | Lo mismo: balance menos depósito |
| «Total generado» en el panel | Barridos acumulados **más** excedente actual |

**El primero vuelve a cero cada ocho horas. El tercero solo sube.**

Todo cálculo que divida «ganado» entre tiempo tiene que usar el tercero. Usar el
primero da un diente de sierra disfrazado de rentabilidad.

Ver el glosario (documento 28) para el término oficial y los prohibidos.

---

## 5. Detección de bloques: heurística, no medición

🟡 **PROPOSED** · Un barrido cuyo importe se sale de la media del grupo se marca
como `es_bloque = 1`.

**Lo que esto no sabe:**
- No distingue un bloque con muchas propinas de dos bloques pequeños.
- No ve los pagos de relay MEV-Boost, que llegan como transferencias directas y
  no pasan por el balance del validador.
- El umbral es relativo al grupo, así que un cambio grande en la red podría
  descalibrarlo.

🔵 **RESEARCH** · ValDash (`valdash.g4mm4.io`) publica las recompensas de
proponente **por slot**, con desglose exacto de atestaciones, sync, slashings y
propinas, y descarga en CSV. Contrastar nuestra detección contra esos datos
respondería de una vez si la heurística acierta. **Nunca se ha hecho.**

---

## 6. Base contra suerte

🟢 **DECIDED** · Medido sobre datos reales: la ganancia **base por ciclo** es
prácticamente idéntica entre validadores — 2,2 % de diferencia entre el mejor y
el peor. Las diferencias de total entre validadores son **suerte de bloque**, no
rendimiento.

**Dato que lo demuestra:** el validador con más bloques propuestos era el que
menos base tenía. No hay correlación.

**Consecuencia de diseño:** cualquier comparativa de «quién gana más» sería una
tabla de suerte disfrazada de tabla de rendimiento. Por eso el panel enseña el
**desglose base contra bloques** en lugar de un ranking.

A 13 de septiembre de 2026: el 15,3 % de lo ganado viene de proponer bloques; el
84,7 % son atestaciones, que es el rendimiento base y no depende del azar.

---

## 7. Qué se puede calcular y qué no

**Se puede, y está verificado:**
- Ganancia real acumulada (barridos + excedente)
- Ganancia por día natural
- Ritmo diario sobre los últimos 7 días completos
- APR ponderado por validador-hora
- Periodo del ciclo y predicción del siguiente barrido (mediana de los huecos,
  no la media: un hueco por caída del recolector envenenaría una media)

**No se puede con los datos que hay:**
- 🔴 **UNKNOWN** · Efectividad de atestación real. No hay ni un dato de
  atestaciones en toda la base. Lo que el panel v1 llamaba «Efectividad» era
  «lo que gana el más rezagado frente al mejor», que es otra cosa.
- 🔴 **UNKNOWN** · Valor en dólares de lo ganado **en el momento de ganarlo**.
  `barridos.precio_pls` existe y está vacío. Los barridos anteriores a esa
  captura no tienen precio y no lo tendrán nunca.
- 🔴 **UNKNOWN** · Cuánto de un barrido fue atestación y cuánto propina.

---

## 8. El ciclo de vida de un validador

Tres estados, y el panel los distingue porque confundirlos causaba fallos:

**Esperando** — hay un keystore en el disco del NUC pero la cadena no conoce esa
pubkey. Puede ser que no se haya depositado aún, o que el depósito esté
procesándose. Desde el NUC las dos cosas se ven igual.

**En cola** — la cadena conoce el validador pero aún no le ha dado turno de
activación. `activation_epoch` vale `2^64-1`.

**Activo** — validando y generando.

🟢 **DECIDED** · **Un validador esperando o en cola no es un aviso.** Es el
funcionamiento normal de una ampliación. Solo un validador que estaba activo y
deja de estarlo dispara alarma.

🟢 **DECIDED** · **El depósito de un validador esperando no se suma al capital.**
Un keystore no demuestra que hayas depositado — las claves se generan antes. Si
se sumara, `ganado = balance − depósito` se iría 32M por debajo y envenenaría el
APR y el titular.

---

## 8 bis. De dónde sale el tamaño del depósito

🟢 **DECIDED** · Del **spec de la cadena**: `/eth/v1/config/spec`, clave
`MAX_EFFECTIVE_BALANCE` —o `MIN_ACTIVATION_BALANCE` si algún día la cadena pasa
a Electra, que es como se llama allí—. Los valores van en gwei. Verificado
contra el nodo el 20-sep-2026: `32000000000000000` gwei = 32.000.000 PLS, y
`MIN_ACTIVATION_BALANCE` no existe, o sea que hoy es pre-Electra.

⚠ **Este documento decía otra cosa, y estaba mal.** Afirmaba que el depósito
salía de `stake_total / total` «y por eso aguantaría un cambio del protocolo».
No aguantaba nada: `collector.py` componía `stake_total` multiplicando una
constante de 32.000.000, así que la división devolvía la constante. El día que
el protocolo cambiara el depósito, todo lo derivado habría mentido igual.

🟢 **DECIDED** · **NO se lee de `effective_balance`.** Es la tentación obvia y
es peor: no es el depósito, es el stake que cuenta para el consenso. Baja con
las penalizaciones —el depósito de referencia encogería justo el día que algo
va mal, que es el peor momento posible para un fallo silencioso—, está
cuantizado con histéresis, y vale 0 mientras el validador está
`pending_initialized`.

🟢 **DECIDED** · **Queda una constante de respaldo** (`DEPOSITO_RESPALDO`) para
cuando el spec no responda, con una **comprobación de rango** (1M–100M PLS)
que tiene que cazar dos cosas concretas: un fork tipo Electra leído a ciegas
—2.048M donde hay 32M— y un fallo de unidades —gwei sin dividir, 32.000
billones—. Las dos llegarían solas y en silencio. Cuando el respaldo actúa, se
dice por stderr.

---

## 9. Tiempos reales de una ampliación

Medidos en las dos ampliaciones hechas:

| Fase | Duración observada |
|---|---|
| Depósito → procesado por la beacon chain | 12-18 h (declarado); una vez fue menos |
| Procesado → activación | variable, depende de la cola de la red |

🔵 **RESEARCH** · ValDash publica los tiempos reales de la cola de activación con
mediana, media, mínimo y máximo. Es la fuente para estimar cuánto tardará la
próxima, en vez de suponerlo.

---

## 10. Preguntas abiertas

- ¿Acierta la detección de bloques? Se puede responder contrastando contra el CSV
  de ValDash y nunca se ha hecho.
- ¿Qué pasa con el periodo del ciclo si la red crece mucho? Se ha observado
  estable durante un mes, sin saber de qué depende.
- ¿Los pagos MEV-Boost existen en este nodo? Si existen, no se están contando en
  ninguna parte.
- El desglose base contra bloques se calcula sobre el histórico completo. ¿Debería
  tener ventana móvil, para que un mes malo se note?
