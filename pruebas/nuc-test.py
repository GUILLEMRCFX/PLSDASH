#!/usr/bin/env python3
"""Lo que hace el NUC cuando entra un validador nuevo.

Dos cosas, y la primera es la que de verdad importa:

  1. `epoch_a_fecha` NO revienta con un validador en cola. Antes lo hacia, y se
     llevaba por delante al recolector entero.
  2. `detectar_eventos` distingue una ACTIVACION de una RECUPERACION. Antes las
     confundia, porque las dos tienen la misma forma vistas desde el recuento.

Se importan los modulos de verdad, no copias:

    python3 pruebas/nuc-test.py
"""
import importlib.util
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
NUC = RAIZ / "nuc"
sys.path.insert(0, str(NUC))

fallos = 0
pruebas = 0


def ok(que, real, esperado):
    global fallos, pruebas
    pruebas += 1
    if real == esperado:
        print(f"  OK   {que}")
    else:
        fallos += 1
        print(f"  FALLA {que}\n        esperado {esperado!r}\n        real     {real!r}")


def okque(que, cond, detalle=""):
    global fallos, pruebas
    pruebas += 1
    if cond:
        print(f"  OK   {que}")
    else:
        fallos += 1
        print(f"  FALLA {que}" + (f" · {detalle}" if detalle else ""))


def cargar(nombre):
    spec = importlib.util.spec_from_file_location(nombre, NUC / f"{nombre}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nombre] = mod
    spec.loader.exec_module(mod)
    return mod


collector = cargar("collector")
push = cargar("push")

FAR = 2 ** 64 - 1

print("\n=== 1. UN VALIDADOR EN COLA NO MATA AL RECOLECTOR ===")
# ⚠ ESTA ES LA COMPROBACION MAS IMPORTANTE DEL FICHERO.
#   La beacon API devuelve `activation_epoch = 2^64-1` mientras un validador
#   esta depositado y sin turno. Con eso, GENESIS + epoch*320 se sale del rango
#   de `time_t` y `datetime.fromtimestamp` lanza OverflowError. Como
#   `leer_validadores()` no envuelve el bucle, la excepcion subia hasta
#   `recolectar()` y el recolector NO PUBLICABA NADA: a los 15 minutos el panel
#   se ponia DESFASADO y se quedaba asi las 12-18 h que dura la cola.
okque("una epoch normal da fecha", collector.epoch_a_fecha(320041) is not None)
ok("la epoch del futuro lejano da None", collector.epoch_a_fecha(FAR), None)
ok("y no revienta con basura", collector.epoch_a_fecha(-1), None)
ok("ni con algo que no es un entero", collector.epoch_a_fecha("x"), None)
okque(
    "el año de una epoch normal es verosimil",
    2020 < collector.epoch_a_fecha(320041).year < 2100,
    str(collector.epoch_a_fecha(320041)),
)

print("\n=== 2. UN PENDIENTE NO ES UN AVISO ===")


def salud_con(activos, total, pendientes):
    # Se llama a la funcion DE VERDAD, no a una copia de su logica: una copia
    # se queda vieja el dia que la regla cambie y la prueba seguiria verde.
    return collector.salud_de(
        {"activos": activos, "total": total, "pendientes": pendientes, "slashed": 0},
        {"sincronizado": True, "disco_usado_pct": 50},
    )


ok("11 de 12 con uno en cola: todo bien", salud_con(11, 12, 1), "ok")
ok("11 de 12 sin nadie en cola: aviso", salud_con(11, 12, 0), "aviso")
ok("10 de 12 con uno en cola: aviso igual", salud_con(10, 12, 1), "aviso")
ok("11 de 11: todo bien", salud_con(11, 11, 0), "ok")
ok("sin datos, se dice", collector.salud_de(None, None), "sin_datos")
ok("un slashing manda sobre todo lo demas",
   collector.salud_de({"activos": 12, "total": 12, "pendientes": 0, "slashed": 1},
                      {"sincronizado": True}), "critico")

print("\n=== 3. ACTIVACION NO ES RECUPERACION ===")


def datos(detalle):
    act = [d for d in detalle if d["estado"].startswith("active")]
    return {
        "generado_ts": 1000,
        "validadores": {"total": len(detalle), "activos": len(act),
                        "slashed": 0, "detalle": detalle},
        "nodo": {},
    }


def A(i):
    return {"indice": i, "estado": "active_ongoing", "pendiente": False}


def P(i):
    return {"indice": i, "estado": "pending_queued", "pendiente": True}


def X(i):
    return {"indice": i, "estado": "exited_unslashed", "pendiente": False}


def tipos(evs):
    return sorted(e[1] for e in evs)


BASE = list(range(1, 12))
prev = {"activos": 11, "activos_indices": BASE,
        "pendientes_indices": [], "inactivos_indices": []}

evs = push.detectar_eventos(datos([A(i) for i in BASE] + [P(12)]), prev)
ok("al depositar, se anota que entra en cola", tipos(evs), ["aviso"])
okque("con el indice del validador", evs[0][5] == 12, str(evs))

prev_cola = {"activos": 11, "activos_indices": BASE,
             "pendientes_indices": [12], "inactivos_indices": []}
ok("mientras espera, no se repite nada",
   push.detectar_eventos(datos([A(i) for i in BASE] + [P(12)]), prev_cola), [])

evs = push.detectar_eventos(datos([A(i) for i in range(1, 13)]), prev_cola)
# ⚠ AQUI ESTABA EL FALLO. `activos` sube de 11 a 12 y `total` ya valia 12: la
#   misma forma exacta que tiene un validador caido que vuelve. El registro
#   decia «Validadores recuperados» el dia mas importante del panel.
ok("al activarse, es una ACTIVACION", tipos(evs), ["activacion"])
okque("y dice cual", "Validador 12 activado" in evs[0][2], str(evs))

prev_caido = {"activos": 10, "activos_indices": list(range(1, 11)),
              "pendientes_indices": [], "inactivos_indices": [11]}
evs = push.detectar_eventos(datos([A(i) for i in BASE]), prev_caido)
ok("uno que vuelve SI es una recuperacion", tipos(evs), ["recuperacion"])

evs = push.detectar_eventos(datos([A(i) for i in range(1, 11)] + [X(11)]), prev)
ok("y una caida sigue siendo una caida", tipos(evs), ["caida"])

# Sin lista previa —primera ejecucion tras actualizar— se cae al camino viejo
# en vez de inventarse nada.
evs = push.detectar_eventos(datos([A(i) for i in range(1, 13)]), {"activos": 11})
ok("sin lista previa, camino antiguo", tipos(evs), ["recuperacion"])

print("\n" + "=" * 52)
print(f"FALLAN {fallos} de {pruebas}" if fallos else f"TODO CORRECTO ({pruebas})")
sys.exit(1 if fallos else 0)
