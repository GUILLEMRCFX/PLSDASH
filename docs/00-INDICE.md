# La documentación de PLSDASH

`README.md`, en la raíz, describe **qué hay**. Esto describe **por qué es así**.

## Qué leer y en qué orden

| | Documento | Qué contesta |
|---|---|---|
| **01** | [Constitución](01-CONSTITUCION.md) | Qué es, qué no es, y los diez principios. **Manda sobre todo lo demás.** |
| **02** | [Modelo de barridos](02-MODELO-DE-BARRIDOS.md) | La lógica del dominio. Sin esto, cualquier cifra del panel parece un error. |
| **03** | [Modelo de datos](03-MODELO-DE-DATOS.md) | El esquema real de D1: qué columnas viven, cuáles están muertas y cuáles mienten. |
| **07** | [Operaciones](07-OPERACIONES.md) | Qué hacer el día malo: cómo se restaura D1 y qué se pierde si no. |
| **08** | [Arquitectura](08-ARQUITECTURA.md) | Cómo viaja un dato de la cadena a la pantalla, y las trampas de implementación ya pagadas. |
| **27** | [Decisiones, supuestos e incógnitas](27-DECISIONES-SUPUESTOS-INCOGNITAS.md) | El registro. Incluye las **decisiones superadas: no volver a proponerlas.** |
| **28** | [Glosario](28-GLOSARIO.md) | Una definición oficial por término. Y las **palabras prohibidas**. |
| **99** | [Cómo se trabaja aquí](99-COMO-SE-TRABAJA.md) | El manual de quien escribe el código: proceso, convenciones, la suite y los pendientes. |

**Si tienes prisa:** 01 y 28. La constitución dice qué se puede hacer; el
glosario evita el fallo más repetido del proyecto, que es usar «ganado» a secas.

## Sobre la numeración

Los números vienen del Foundation Method y **están salteados a propósito**: se
escribieron los documentos que aportaban algo, no los veintiocho. Los huecos
—04 Infraestructura, 05 Dependencias, 06 El panel, 09 Seguridad— se citan desde
dentro de otros documentos pero no existen todavía. Si
alguno se escribe, va aquí con su número.

El **99** queda fuera de esa numeración porque no es un documento del método:
es el manual de trabajo.

## Dos avisos

⚠ **`docs/` se sirve públicamente.** `_routes.json` decide dónde corre el
runtime de Functions, no qué ficheros se descargan: igual que `nuc/`,
`migraciones/` y `pruebas/`, esta carpeta es accesible desde fuera. Estos
documentos no llevan nada sensible —las IP y la parte de seguridad se quedan
fuera del repositorio a propósito—, pero tenlo en cuenta antes de mover más
cosas aquí dentro. Es la incógnita T4 del documento 27.

⚠ **Si el código contradice a un documento, gana el código** para saber qué pasa
hoy — y entonces el documento se corrige, no se deja. La jerarquía entre
documentos es otra cosa: ahí manda la constitución.
