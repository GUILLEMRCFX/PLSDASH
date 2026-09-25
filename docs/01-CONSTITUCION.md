# 01 · CONSTITUCIÓN

**Proyecto:** PLSDASH + Validator Dashboard
**Propietario:** Guillem (GUILLEMRCFX)
**Versión:** 1.0 · 13 de septiembre de 2026

> **Jerarquía:** si cualquier otro documento contradice a este, gana este.
> Cambiar algo de aquí exige revisión explícita, no se hace de paso.

**Depende de:** nada. Es la raíz.
**Alimenta a:** todos los demás documentos.

---

## 1. Qué es

PLSDASH es **dos cosas que comparten infraestructura**:

**Una web pública** (`plsdash.com`) para seguir una cartera de PulseChain
pegando una dirección. Solo lectura, sin conectar wallet.

**Un panel privado** (`plsdash.com/val/v2/`) para vigilar un nodo de validadores
propio: lo que generan, cómo está la máquina, y hacia dónde va.

Los dos los usa **una sola persona**: el propietario. No hay usuarios, no hay
cuentas, no hay soporte.

🟢 **DECIDED** · El panel privado es la razón de ser del proyecto. La web
pública existía antes y se mantiene, pero el trabajo se concentra en el panel.

---

## 2. Qué NO es

🟢 **DECIDED** · **No es un producto.** No se vende, no se cobra, no tiene
usuarios. Cualquier decisión que solo tenga sentido «cuando lo use más gente»
está fuera de alcance mientras no se decida lo contrario aquí.

🟢 **DECIDED** · **No custodia claves.** No se conecta ninguna wallet, no se
firma nada, no se guarda ninguna clave privada ni ninguna seed. El panel lee
direcciones públicas y estado de la cadena.

🟢 **DECIDED** · **No sustituye al nodo.** Si el panel cae, los validadores
siguen validando. El panel es observación, no operación.

🟡 **PROPOSED** · **No es open source, de momento.** El repositorio es público
por comodidad de despliegue, no por vocación de compartirlo. Ver documento 09.

---

## 3. Qué problema resuelve

Un validador de PulseChain no te dice cuánto has ganado. El protocolo **barre el
excedente cada ~8 horas**, así que el balance vuelve a su base constantemente:
mirar el balance no responde ninguna pregunta útil.

Las herramientas que existen —ValDash, ValidatorDashboard.com,
pulsechainstats.com— miran **la cadena**. Ninguna puede ver la máquina: ni la
temperatura, ni el disco, ni los peers, ni cuándo tocará el prune.

PLSDASH junta las dos mitades. Esa es toda su ventaja.

**Las tres preguntas que el panel existe para responder:**

1. ¿Va todo bien?
2. ¿Cuánto llevo ganado de verdad?
3. ¿Cuánto falta para el siguiente validador?

🟢 **DECIDED** · Cualquier función nueva tiene que servir a una de esas tres, o
justificar por qué merece estar sin hacerlo.

---

## 4. Los principios

Cada uno lleva **cómo se ve una violación**. Un principio que no se puede violar
de forma reconocible no es un principio, es un eslogan.

---

### P1 · Una cifra plausible pero falsa es peor que un hueco

Si un número no se puede calcular bien, no se enseña. Se deja vacío y se dice
por qué.

**Violación:** el APR salía de dividir el excedente sin barrer entre las horas
desde la primera activación. Daba 0,217 → 0 → 0,029 → 0,061 en horas seguidas —
un diente de sierra disfrazado de rentabilidad. Nadie lo habría notado porque la
cifra parecía razonable.

**Cómo se ve:** un número que cambia de forma que la realidad no justifica. O un
número calculado con un dato que significa otra cosa.

---

### P2 · Nunca dar por hecho el estado del mundo

Los índices de validador no son correlativos. El número de validadores cambia.
El precio se mueve. Nada de eso se escribe en el código.

**Violación:** `VALIDATOR_INDICES = list(range(109549, 109559))`. Al activarse el
undécimo con índice **109876** —no 109559— el panel siguió diciendo diez, y
`ganancia.js` descartaba sus barridos en silencio. Ampliar el rango tampoco
habría servido: el duodécimo es **110855**.

**Cómo se ve:** un número literal en el código que describe el mundo en vez de
una regla. Un rango. Una lista escrita a mano.

---

### P3 · Las bajadas de balance son barridos, nunca corrupción

El protocolo retira el excedente cada ~8,1 h y el balance vuelve a su base. Es
el comportamiento normal del sistema.

**Violación:** al ver el balance caer de 26.768 a 3.154 se ordenó una guardia que
rechazara bajadas. Habría roto el sistema cada ocho horas, para siempre.

**Cómo se ve:** cualquier validación de monotonía sobre balances o ganancias.

---

### P4 · La unicidad la impone la base de datos, no la disciplina del código

**Violación:** `registrarEventos` hacía SELECT y luego INSERT. Dos peticiones
concurrentes consultaban las dos, no encontraban nada las dos, e insertaban las
dos. Se arregló con un índice único.

**Cómo se ve:** comprobar si algo existe antes de insertarlo.

---

### P5 · Si una animación no dice nada, sobra

Todo lo que se mueve en pantalla codifica un dato real. El movimiento decorativo
gasta batería y enseña a ignorar el movimiento que sí importa.

**Violación:** los nodos naranjas de la esfera tenían el número del validador
escrito dentro. Ni informaban ni se leían a 390px.

**Cómo se ve:** un efecto que se vería igual con los datos cambiados.

---

### P6 · Verificar antes de afirmar

Lo que no se ha comprobado se dice que no se ha comprobado. Vale para las dos
partes: quien construye y quien decide.

**Violación:** el `PRECIO_SACRIFICIO` se cambió a 0,001 porque alguien lo dijo de
memoria. Estaba mal por un factor de diez y llegó a producción.

**Cómo se ve:** una cifra sin fuente. Un «creo que». Un comentario que describe
algo que no se implementó.

---

### P7 · Antes de diagnosticar el código, verificar qué está desplegado

**Violación:** tres rondas persiguiendo un fallo del panel. El código estaba
bien; producción servía una versión anterior.

**Cómo se ve:** buscar la causa de un síntoma sin haber confirmado qué versión
lo produce.

---

### P8 · Que falle una parte no puede tumbar el conjunto

**Violación:** un `Promise.all` dejaba el panel entero en blanco si un solo
endpoint fallaba.

**Cómo se ve:** cualquier punto donde un fallo parcial se propaga al todo.

---

### P9 · El panel observa, no opera

PLSDASH no arranca contenedores, no para el nodo, no firma transacciones y no
toca las claves. Puede **guiar** al propietario para que lo haga él, pero no lo
hace en su nombre.

🟢 **DECIDED** (23-sep-2026) · **Guiar no es operar.** La línea exacta:

> El panel compone texto que tú copias y observa el resultado en los datos que ya publica el NUC. No abre conexiones, no escribe en el NUC, no firma, no sube nada.

Es la frase que para un botón de «ejecutar por SSH» el día que alguien lo
proponga. La pestaña Ampliar es la primera que la aplica: da comandos para
copiar y marca los pasos por lo que ve en el estado, no por lo que se le dice.

**Cómo se ve:** cualquier función que escriba en el NUC o en la cadena, o que
abra una conexión desde el panel hacia cualquier sitio que no sea su propia
API.

---

### P10 · Lo que no se captura hoy se pierde para siempre

No hay precio histórico por token. No hay atestaciones históricas. Los 484
barridos anteriores a la captura de precio no tienen valor en dólares y no lo
tendrán nunca.

**Cómo se ve:** posponer la captura de un dato que se genera de forma continua.

---

## 5. Reglas de alcance

🟢 **DECIDED** · **La seed nunca sale del papel.** No se guarda en digital, no se
pega en ningún sitio, no se escribe en ninguna herramienta.

🟢 **DECIDED** · **El PIN se valida en servidor, siempre.** Ninguna comprobación
de acceso en el cliente.

🟢 **DECIDED** · **El día se agrupa en UTC**, no en hora española. Entre
medianoche y las dos de la mañana, «hoy» muestra el día anterior. Es una rareza
aceptada: cambiarla en un solo sitio haría que dos vistas discrepasen.

🟢 **DECIDED** · **Un dato viejo se marca como viejo.** El panel nunca enseña
información obsoleta como si fuera actual.

---

## 6. Cómo se decide

🟢 **DECIDED** · Las decisiones se toman en la conversación de chat. El código lo
escribe Claude Code. Las dos sesiones no comparten contexto.

🟢 **DECIDED** · **Quien construye debe discrepar cuando tenga motivos.** Varias
veces el criterio de Code ha sido mejor que el del chat — el ranking de
validadores, el 3D del gráfico circular, la tasa de bloques por tiempo activo.
Ese desacuerdo es parte del proceso, no una fricción.

🟢 **DECIDED** · **Toda decisión superada se registra**, con su motivo. Ver
documento 27.

---

## 7. Preguntas abiertas

- ¿Se abre el proyecto a otros operadores de validadores? Hoy la respuesta es no,
  pero no está cerrada. Depende de resolver la separación entre lo que es del
  propietario y lo que es genérico (documento 09).
- ¿Qué pasa con la web pública si el trabajo se concentra en el panel? Hoy se
  mantiene, pero no tiene un objetivo propio escrito.
- ~~El principio P9 dice que el panel no opera. ¿Guiar un proceso paso a paso,
  dando comandos listos para copiar, sigue siendo observar?~~ **Decidido el
  23-sep-2026: sí.** Ver P9.
