# 28 · GLOSARIO

**Una definición oficial por término. Y las palabras que no se usan.**

**Versión:** 1.0 · 15 de septiembre de 2026

**Depende de:** todos
**Alimenta a:** todos

> Suena menor. No lo es: evita que dentro de seis meses dos partes discutan sin
> darse cuenta de que hablan de cosas distintas. Ya ha pasado con «ganado».

---

## 1. Términos del dominio

**Barrido**
Retirada automática del excedente de un validador hacia la wallet, cada ~8,1 h.
Es la **unidad de ingreso real** del sistema. En inglés, *withdrawal*.
→ documento 02

**Ciclo de barrido**
El periodo completo entre dos barridos del mismo validador. ~8,1 h medido sobre
40 ciclos.

**Excedente**
Lo que un validador tiene por encima de sus 32.000.000 PLS de depósito. Es lo que
el protocolo barre. **Vuelve a cero cada ciclo.**

**Depósito**
Los 32.000.000 PLS que bloquea un validador. El panel lo obtiene de
`stake_total / total`, y **el recolector lo lee del spec de la cadena**
(`/eth/v1/config/spec`, clave `MAX_EFFECTIVE_BALANCE`; `MIN_ACTIVATION_BALANCE`
si algún día la cadena pasa a Electra).

⚠ **Corregido el 20-sep-2026.** Aquí ponía «sale siempre de `stake_total /
total`, nunca escrito», y era falso: `collector.py` tenía
`STAKE_POR_VALIDADOR = 32_000_000` y componía `stake_total` multiplicándolo,
así que la división devolvía **exactamente la constante**. La derivación no
compraba nada. Hoy sí sale de la cadena, con la constante degradada a
respaldo — y cuando actúa el respaldo, se dice por stderr.

**Índice de validador**
El número que la cadena asigna a un validador al activarlo. ⚠️ **No es
correlativo**: los doce son 109549-109558, 109876 y 110855.

**Pubkey**
La clave pública del validador. **Es el identificador estable**: existe desde que
se genera la clave, mientras que el índice no existe hasta que la cadena adopta
el depósito.

**Keystore**
Fichero cifrado con la clave de firma. Vive en el NUC. Se genera **antes** de
depositar, así que su existencia no demuestra que haya depósito.

**Wallet de retirada**
La dirección a la que van los barridos. Se fija al crear el validador y es
pública en la cadena.

**Aportación**
PLS que el propietario transfiere a la wallet desde fuera. **Se registra a mano**:
la cadena no distingue una aportación propia de cualquier otra entrada.

**Slashing**
Penalización por firmar dos veces. **No confundir con no atestar**, que es una
penalización menor y proporcional.

---

## 2. Estados de un validador

Tres, y distinguirlos importa.

**Esperando**
Hay keystore en el disco pero la cadena no conoce esa pubkey. Puede ser que no se
haya depositado, o que el depósito se esté procesando. **Desde el NUC las dos
cosas se ven igual.**

**En cola**
La cadena conoce el validador pero no le ha dado turno. `activation_epoch` vale
`2^64-1`.

**Activo**
Validando y generando.

🟢 Ni «esperando» ni «en cola» son avisos. Solo un validador que estaba activo y
deja de estarlo dispara alarma.

---

## 3. Términos de dinero

⚠️ **Esta es la sección que evita el fallo más repetido del proyecto.**

**Ganado (sin cualificar) — PROHIBIDO**
La palabra sola no significa nada. Ver los tres términos siguientes.

**Excedente sin barrer**
`balance − depósito`. Lo acumulado desde el último barrido. **Vuelve a cero cada
~8 h.** Es lo que hay en `snapshots.ganado` y en `validadores.ganado_total`.

**Ganancia acumulada**
Suma de todos los barridos **más** el excedente actual. **Solo sube.** Es lo que
el panel llama «Total generado», y en el Resumen «Generado desde el …».

**Patrimonio del nodo**
Lo que hay ahora: **en staking + en la wallet + sin barrer**. El staking es
`stake_total` —solo lo que confirma la cadena; un validador esperando no suma—, la
wallet su saldo leído de la cadena y lo sin barrer `ganado_total`. Es la cifra
grande del Resumen desde el 25-sep-2026. **No incluye lo generado**: buena parte
de lo generado ya está dentro de un validador, y sumarlo lo contaría dos veces.
Si falta una pieza, no cuenta y el panel dice cuál.

**Ritmo**
PLS por unidad de tiempo, medido sobre días de calendario completos. **Nunca** se
calcula dividiendo el excedente sin barrer entre horas: eso da un diente de
sierra.

**APR**
Rentabilidad anualizada, ponderada por **validador-hora**:
`ganancia_real / Σ(depósito_i × horas_activas_i) × 8760 × 100`.
⚠️ No dividir entre el stake total por las horas del más veterano: con validadores
de distinta antigüedad, esa cuenta está mal.

**Base**
La parte de la ganancia que viene de atestaciones. Constante entre validadores:
2,2 % de diferencia entre el mejor y el peor.

**Suerte**
La parte que viene de proponer bloques. A 15-sep-2026, el 15,3 % del total.

---

## 4. Términos del sistema

**Snapshot**
Foto horaria del estado completo en D1.

**Estado**
El objeto que el NUC publica en KV cada 3 minutos. **Es lo de ahora**, no un
histórico.

**Recolector / collector**
`collector.py`. Lee el nodo y compone el estado. **No escribe en Cloudflare.**

**Push**
`push.py`. Publica en KV y D1. **Es el único que escribe.**

**Siembra**
El proceso de recorrer el histórico del explorador por páginas para rellenar
`inversiones`. Lleva cursor por wallet y por flujo en `meta`.

**Descuadre**
Una transacción que no es entrada de stablecoin ni swap en la misma transacción:
traspasos entre wallets propias, airdrops, NFTs, liquidez.

**Polvo / dust**
Posición de menos de 1 $ **de valor** (cantidad × precio), no de precio unitario.

---

## 5. Términos de la interfaz

**Panel**
`plsdash.com/val/v2/`. El privado, con PIN.

**Portada**
`plsdash.com`. La web pública de cartera.

**Vault**
El gesto de arrastre en la portada que lleva al panel. **Es puerta, no cerradura**:
no autentica.

**Esfera / Validator Core**
El elemento visual del panel. **No es navegación.**

**Pulso de datos**
La línea temporal que cuenta hasta la próxima actualización. Al agotarse **es la
alerta** de que el NUC no responde.

**Desfasado**
Estado del panel cuando el dato tiene más de 15 minutos.

---

## 6. Términos prohibidos

| No usar | Por qué | Usar |
|---|---|---|
| **«ganado»** solo | Significa dos cosas opuestas | «excedente sin barrer» o «ganancia acumulada» |
| **«total»** solo | ¿de validadores, de PLS, de dólares? | especificar |
| **«efectividad»** | En el v1 nombraba «lo que gana el más rezagado frente al mejor». No hay datos de atestación. | «rendimiento relativo al grupo» |
| **«atestaciones perdidas»** | No hay ni un dato de atestaciones en toda la base | no usar |
| **«recuperado»** para una activación | Una activación tiene la forma de una recuperación en los recuentos | «activado» |
| **«en vivo» / «LIVE»** para el registro | Son ~6 sucesos al día | «registro» |
| **«balance»** como sinónimo de ganancias | El balance vuelve a su base cada 8 h | «balance» solo para el saldo del validador |
| **«validadores»** sin estado | Doce claves no son doce activos | «activos», «esperando», «en cola» |

---

## 7. Unidades y formato

🟢 **DECIDED** · **PLS** es la unidad por defecto. El dólar es secundario y
siempre se marca como aproximación.

🟢 **DECIDED** · **El día se agrupa en UTC.** Entre medianoche y las 2 de la
mañana en hora española, «hoy» muestra el día anterior.

🟢 **DECIDED** · **Mes = 30,44 días. Año = 365,25 días.** Con 30 y 365 se arrastra
un 1,4 % de error anual gratis.

🟢 **DECIDED** · Formato español: punto de millar, coma decimal.

---

## 8. Preguntas abiertas

- ¿Hace falta un término propio para «lo que vale hoy lo que gané» frente a «lo
  que valía cuando lo gané»? Hoy no se puede calcular lo segundo, pero el día que
  `barridos.precio_pls` se rellene harán falta dos palabras distintas.
- «Esperando» cubre dos situaciones —sin depositar y depositado sin procesar— que
  desde el NUC no se distinguen. ¿Merecen nombres distintos si algún día se
  pueden separar?
