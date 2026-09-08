/**
 * Lo que comparten todas las pruebas: contar aciertos, esperar sin morirse y
 * lanzar el navegador siempre igual.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const CHROMIUM = '/opt/pw-browsers/chromium';

function marcador() {
  const estado = { fallos: 0, pruebas: 0 };

  /** Compara por valor. Para todo lo que sea un dato concreto. */
  const ok = (que, real, esperado) => {
    estado.pruebas++;
    const bien = JSON.stringify(real) === JSON.stringify(esperado);
    if (!bien) estado.fallos++;
    console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${que}`
      + (bien ? '' : `\n        esperado ${JSON.stringify(esperado)}`
                   + `\n        real     ${JSON.stringify(real)}`));
  };

  /** Para condiciones. El segundo argumento es el detalle que se enseña al fallar. */
  const okQue = (que, cond, detalle = '') => {
    estado.pruebas++;
    if (!cond) { estado.fallos++; console.log(`  FALLA ${que}${detalle ? ' · ' + detalle : ''}`); }
    else console.log(`  OK   ${que}`);
  };

  const terminar = () => {
    console.log('\n' + '='.repeat(52));
    console.log(estado.fallos
      ? `FALLAN ${estado.fallos} de ${estado.pruebas}`
      : `TODO CORRECTO (${estado.pruebas})`);
    process.exit(estado.fallos ? 1 : 0);
  };

  return { ok, okQue, terminar, estado };
}

/**
 * Espera activa, con techo.
 *
 * ⚠ NO usar `waitForTimeout` fijo para comprobar algo que TIENE que pasar. Un
 *   sueño de 120 ms acierta con la máquina descansada y falla una de cada tres
 *   cuando va cargada; ya nos costó una prueba intermitente. Y `waitForFunction`
 *   a pelo lanza al vencer y se lleva por delante el resto del fichero, así que
 *   la primera rotura tapa todas las demás. Esto espera y, si no llega,
 *   devuelve `false` para que el `ok()` de después lea el valor real y diga QUÉ
 *   había.
 *
 *   La espera fija sí es correcta para lo NEGATIVO —«no se ha movido», «no ha
 *   navegado»—: a algo que no debe ocurrir hay que darle tiempo de ocurrir.
 */
async function hasta(cond, techo = 8000) {
  const t0 = Date.now();
  for (;;) {
    try { if (await cond()) return true; } catch { /* aún no está el DOM */ }
    if (Date.now() - t0 >= techo) return false;
    await new Promise(r => setTimeout(r, 25));
  }
}

/** La misma llamada en todos lados, para que no diverjan los argumentos. */
async function navegador(chromium, { gl = false } = {}) {
  return chromium.launch({
    executablePath: CHROMIUM,
    // La esfera necesita WebGL por software; lo demás no, y arrancar sin él es
    // bastante más rápido.
    args: gl ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : [],
  });
}

module.exports = { BASE, CHROMIUM, marcador, hasta, navegador };
