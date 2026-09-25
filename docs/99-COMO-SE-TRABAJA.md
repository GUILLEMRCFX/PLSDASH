# 99 · CÓMO SE TRABAJA AQUÍ

**El manual de quien escribe el código. No es un documento del Foundation
Method** —por eso va fuera de la numeración 01-28—: aquéllos dicen qué es el
proyecto y por qué; éste dice cómo se toca sin romperlo.

**Versión:** 2.0 · 20 de septiembre de 2026
**Antes era `BRIEF-CLAUDE-CODE.md`**, en la raíz. Lo que contaba de los datos,
de la arquitectura y de las decisiones se fundió en los documentos 02, 03, 08 y
27 —estaba duplicado y dos copias divergen— y aquí se quedó lo que no tenía otro
sitio: el proceso, las convenciones, la suite y los pendientes de ingeniería.

**Depende de:** 01 Constitución
**Alimenta a:** nada. Es hoja.

---

## 1. Reglas de proceso — han costado seis veces

> **Todos los commits subidos ANTES de abrir el PR. Y PR abierto es PR cerrado:
> lo que venga después va en uno nuevo.**

Se saltó seis veces, y cada una costó un día de desconcierto mirando producción
y preguntándose por qué no cambiaba nada: los commits añadidos después de que el
PR se fusionara se quedaron huérfanos, y el trabajo parecía desplegado sin
estarlo. Si hay que añadir algo, se abre otro PR.

- **Todos los PR contra `main`.** Nada de encadenar uno sobre otro.
- **Si un cambio retira la única alternativa a algo, va en su propio commit**,
  para poder revertir solo eso. Así se hizo al retirar el v1: la puerta en un
  commit, el borrado en otro.
- **Antes de dar algo por bueno visualmente**, ábrelo, hazte captura a 1440 y a
  390 y **mírala tú**. Las dos correcciones de la puerta del PIN —el `⌫` que
  Inter no tiene y salía como un rectángulo tachado, y el aro de foco que hacía
  parecer pulsado el «1»— salieron de mirar la captura, no de mandarla.
- **Si algo cuesta caro, dilo con el dato medido.** Y si no se ha podido medir,
  dilo también: es mejor que un número inventado.
- **Discrepar cuando haya motivo.** Está en la constitución, sección 6: varias
  veces el criterio de quien construye fue el bueno. Decirlo antes de
  implementar, no después.

---

## 2. La suite

```bash
./pruebas/correr.sh              # todo
./pruebas/correr.sh wallets      # solo lo que case
```

Sale con 0 solo si pasa todo, así que vale para un gancho de pre-push. Once
ficheros, ~348 comprobaciones; siete no necesitan navegador.

**Vive dentro del repositorio a propósito.** Estuvo en el directorio de trabajo
de la sesión y se perdió entera **dos veces** al reiniciarse el contenedor; la
segunda se llevó trabajo del mismo día. Una prueba que no está en el repositorio
no existe.

**Una prueba se verifica al revés:** se rompe el código a propósito y tiene que
ponerse roja **por el motivo correcto**. Una prueba que pasa siempre no prueba
nada.

### Trampas de las pruebas

⚠ **Espera activa para lo positivo, espera fija para lo negativo.** Un
`waitForTimeout` fijo acierta con la máquina descansada y falla una de cada tres
cuando va cargada —`vault-test` estuvo así semanas—. Pero a algo que **no** debe
ocurrir no se le puede esperar: ahí hay que dar tiempo de sobra y comprobar que
no pasó.

⚠ **Playwright prueba las rutas de la ÚLTIMA registrada a la primera.** El
comodín va primero para que el caso concreto le gane; al revés se lo come y la
vista recibe `{}`.

⚠ **Una prueba que grita en todo lo que mira no la mira nadie.** La primera
versión del detector de comillas inversas señalaba 38 ficheros sanos llenos de
JSDoc correctos.

⚠ **Lo que una prueba de funciones puras no puede decir es cuánto se distingue
una cosa de otra EN PANTALLA.** Para eso hay que capturar y medir píxeles, con
una **pasada de control** en la que todos los elementos valen lo mismo: lo que
se mida de dispersión ahí es ruido, no dato. Así se recalibró la esfera.

---

## 3. Convenciones

- Vanilla HTML/CSS/JS, sin frameworks y sin build.
- Comentarios en español, y los `⚠` marcan las trampas: **ésos no se borran**.
  Cuentan qué fallo real hizo nacer la línea de al lado.
- El vocabulario oficial está en el documento 28. **«Ganado» a secas no se usa**:
  significa dos cosas opuestas.
- Auto-deploy al fusionar en `main`.

---

## 4. Lo que queda pendiente

Los pendientes de ingeniería. Las incógnitas de rumbo —las que deciden qué se
construye— están en el documento 27, que manda sobre esta lista.

| | |
|---|---|
| **Verificar las tres direcciones de stablecoin** de `inversiones.js` contra el explorador | lo más urgente: afecta a cifras que se enseñan. Supuesto abierto en el documento 27 |
| **Confirmar el contrato de depósito** de validador | convertiría el «probablemente» de los depósitos agrupados en una certeza |
| **La migración `001-limpieza.sql` está APARCADA** | no ejecutarla sin avisar. Lleva su propio orden obligatorio: fusionar, desplegar, comprobar, y solo entonces ejecutar — al revés deja `/api/val/ganancia` en 500 |
| **La tabla `ajustes` quedó huérfana** en D1 al retirar el precio de entrada editable | borrarla es una migración, y la migración está aparcada |
| **Gráfica de recompensas** | aplazada de mutuo acuerdo |
| **Pruebas perdidas y no reconstruidas** | las que dependían de una fixture grande con datos reales de D1: `paneles-test`, `paneles34`, `paneles5678`, `pestanas`, `carga-test`, `nav-test`, y las de la portada `frontend`, `logos`, `polvo`, `iphone`. De `esfera-test` se recuperó la calibración en `esfera-calibracion-test.mjs`. Anotadas en `pruebas/README.md` |
| **`vault-test` intermitente** | falló una vez de siete en la comprobación del fogonazo y no se ha podido reproducir. Lleva volcado de estado al fallar para saber de qué lado está |
