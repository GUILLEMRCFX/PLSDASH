# Pruebas

```bash
./pruebas/correr.sh              # todo
./pruebas/correr.sh wallets      # solo lo que case con «wallets»
```

Sale con 0 solo si pasa todo, así que vale tal cual para un gancho de pre-push.

## Por qué están aquí y no en un directorio temporal

Vivían fuera del repositorio, en el directorio de trabajo de la sesión. Se han
perdido enteras **dos veces** al reiniciarse el contenedor, y la segunda se
llevó por delante trabajo del mismo día. Una prueba que no está en el
repositorio no existe.

## No se despliegan

`pruebas/` está en el `exclude` de `_routes.json`, así que ninguna Function se
invoca para esas rutas.

⚠ Eso **no** las hace inaccesibles: `_routes.json` decide dónde corre el
runtime de Functions, no qué se sirve como fichero estático. Lo demuestra el
propio proyecto — `/val/v2/paneles/*` también está excluido y el navegador lo
descarga en cada carga de página. Igual que `nuc/` y `migraciones/`, que ya
estaban en el repositorio antes que esto. Aquí no hay secretos: las fixtures son
direcciones inventadas (`0xaaaa…`) y números redondos escritos a mano.

## Cómo está montado

| fichero | qué es |
|---|---|
| `correr.sh` | el lanzador |
| `servidor.js` | sirve el repositorio en `:8899`, como Pages |
| `ayuda.js` | marcador, `hasta()` y el arranque del navegador |
| `resolver.mjs` + `ganchos.mjs` | traducen `/val/…` a rutas del disco |
| `d1-falsa.js` | una D1 en memoria que entiende el SQL de la Function |

Las Functions **no** corren bajo `wrangler`: se importa el módulo y se le pasa
una D1 de mentira y un `fetch` doblado. Es más rápido y permite controlar página
a página lo que devuelve el explorador.

## Las pruebas

| fichero | qué cubre | navegador |
|---|---|---|
| `sintaxis-test.mjs` | que todo parsee, que el CSS cuadre de llaves | no |
| `nuc-test.py` | el recolector y la deteccion de eventos del NUC | no |
| `doce-test.mjs` | lo que pasa al añadir un validador: cola, esfera, hitos | no |
| `precio-panel-test.mjs` | «Si PLS valiera otra cosa»: escala, sacrificio, marcas | no |
| `inversiones-test.mjs` | `/api/inversiones`: clasificar, `ver`, cursores | no |
| `rutas-test.mjs` | qué endpoints se piden de verdad, reconstruyendo las URL | no |
| `puerta-test.js` | el PIN del v2 y el cierre de sesión | sí |
| `wallets-test.js` | el interruptor «cuenta en los totales» | sí |
| `invest-vista-test.js` | la vista Inversiones y los depósitos agrupados | sí |
| `vault-test.js` | el gesto de la tarjeta para entrar en `/val/` | sí |

## Dos reglas que han costado dinero

**Espera activa para lo positivo, espera fija para lo negativo.** `hasta()`
espera a que algo ocurra y se rinde con un techo; un `waitForTimeout` fijo
acierta con la máquina descansada y falla una de cada tres cuando va cargada —
`vault-test` estuvo así semanas. Pero a algo que **no** debe ocurrir no se le
puede esperar: ahí hay que dar tiempo de sobra y comprobar que no pasó.

**Una prueba que no falla al romper lo que vigila no vale.** Antes de dar una
por buena, rómpela a propósito y mira que se pone roja por el motivo correcto.
Los comentarios `⚠` de cada fichero cuentan qué fallo real la hizo nacer; ésos
no se borran.

## Lo que falta

Las pruebas de los paneles del v2 que dependían de una fixture grande —el
estado del nodo, la serie histórica, los barridos— se perdieron con el resto y
no se han reconstruido: eran datos reales de D1 que ya no están. Cubrían
`paneles-test`, `paneles34`, `paneles5678`, `pestanas`, `esfera-test`,
`carga-test`, `nav-test` y las de la portada (`frontend`, `logos`, `polvo`,
`iphone`). Hay que rehacerlas cuando se toquen esas partes.

De `esfera-test` ya está recuperada la parte que importaba: la ley que
convierte bloques en tamaño vive en `esfera-calibracion-test.mjs`, sin
navegador. Lo que sigue faltando de aquélla es la comprobación de que la escena
se monta y sobrevive a un cambio de tema.

### Medir píxeles de la esfera

Lo que una prueba de funciones puras no puede decir es cuánto se distingue una
cosa de otra EN PANTALLA. Para eso se captura la esfera y se miden los
diámetros de los núcleos, con dos pasadas: una de **control** en la que todos
los validadores tienen los mismos bloques —lo que se mida de dispersión ahí es
ruido de perspectiva, no dato— y otra con los bloques de verdad. La señal útil
es el cociente entre las dos. El resultado de la última medida está en la
cabecera de las constantes de `escena/esfera.js`.
