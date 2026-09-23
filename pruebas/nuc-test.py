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

print("\n=== 4. EL QUE TIENE CLAVE Y LA CADENA NO CONOCE ===")
# ⚠ ESTO ES LO QUE HACIA DESAPARECER AL VALIDADOR 12 DURANTE 12-18 H.
#   `leer_validadores` pregunta a la beacon API POR PUBKEY, y la API devuelve
#   solo las que conoce: la del deposito recien hecho no viene, sin error de
#   ninguna clase. Antes se perdia ahi. Ahora se cruza con los keystores del
#   disco, que es donde el dato SI existe desde el minuto uno.

PK = ["0x" + f"{i:02x}" * 48 for i in range(1, 13)]   # doce claves de mentira


def beacon_con(pubkeys, estado="active_ongoing"):
    """Respuesta de la beacon API con solo esas pubkeys."""
    return {"data": [
        {"index": str(109549 + i), "balance": str(32_000_000 * 10 ** 9),
         "status": estado,
         "validator": {"pubkey": pk, "slashed": False, "activation_epoch": "320041"}}
        for i, pk in enumerate(pubkeys)]}


SPEC_HOY = {"data": {
    "MAX_EFFECTIVE_BALANCE": "32000000000000000",
    "EFFECTIVE_BALANCE_INCREMENT": "1000000000000000",
    "EJECTION_BALANCE": "16000000000000000",
}}


def con_claves(locales, respuesta, spec=SPEC_HOY):
    collector._pubkeys_locales = lambda: locales
    # El spec y los validadores son dos URL distintas: si el doble contestara
    # lo mismo a las dos, la prueba estaria midiendo otra cosa.
    collector.get_json = lambda url: (spec if url.endswith(collector.SPEC) else respuesta)
    collector.deposito_pls(forzar=True)
    return collector.leer_validadores()


guardado = (collector._pubkeys_locales, collector.get_json)
try:
    v = con_claves(PK, beacon_con(PK[:11]))
    ok("la cadena conoce once", v["total"], 11)
    ok("y hay doce claves", v["claves"], 12)
    ok("asi que uno espera", v["esperando"], 1)
    okque("y NO desaparece del detalle", len(v["detalle"]) == 12, str(len(v["detalle"])))

    e = [d for d in v["detalle"] if d.get("esperando")]
    ok("solo uno marcado como esperando", len(e), 1)
    ok("es la clave que falta", e[0]["pubkey"], PK[11])
    ok("sin indice, porque la cadena no se lo ha dado", e[0]["indice"], None)
    okque("con la pubkey abreviada", "…" in e[0]["pubkey_corta"], e[0]["pubkey_corta"])
    ok("cuenta como pendiente para el panel", e[0]["pendiente"], True)
    ok("y sin balance inventado", e[0]["balance"], None)

    # ⚠ EL DINERO NO SE MUEVE. Una clave en el disco no demuestra un deposito
    #   —se generan antes de depositar—, y si `stake_total` la sumara,
    #   `ganado_total = balance_total - stake_total` se iria 32M por debajo y
    #   envenenaria el APR, el reparto del saldo y el titular.
    ok("el stake cuenta solo lo que confirma la cadena", v["stake_total"], 11 * 32_000_000)
    ok("asi que lo ganado sigue cuadrando", round(v["ganado_total"]), 0)
    okque("y el deposito unitario sigue siendo exacto",
          v["stake_total"] / v["total"] == 32_000_000,
          str(v["stake_total"] / v["total"]))

    ok("un pendiente en cola no cuenta como esperando",
       con_claves(PK[:11], beacon_con(PK[:11], "pending_queued"))["esperando"], 0)
    ok("sin claves de sobra, no espera nadie",
       con_claves(PK[:11], beacon_con(PK[:11]))["esperando"], 0)

    # La salud no se mueve: `total` solo cuenta lo que la cadena devuelve, asi
    # que un esperando no puede restar de nada.
    ok("y esperar NO es un aviso",
       collector.salud_de(con_claves(PK, beacon_con(PK[:11])),
                          {"sincronizado": True, "disco_usado_pct": 50}), "ok")
finally:
    collector._pubkeys_locales, collector.get_json = guardado

print("\n=== 4 bis. EL DEPOSITO SALE DEL SPEC, NO DE UNA CONSTANTE ===")
# ⚠ Tres documentos afirmaban que el deposito salia de `stake_total / total` y
#   que por eso aguantaria un cambio del protocolo. Era falso: `stake_total`
#   se componia multiplicando una constante, asi que la division devolvia
#   exactamente la constante. Ahora sale del spec de la cadena.

guardado2 = (collector.get_json, collector._deposito)


def con_spec(data):
    collector.get_json = lambda url: ({"data": data} if data is not None else None)
    return collector.deposito_pls(forzar=True)


try:
    ok("el spec de hoy da 32M", con_spec(SPEC_HOY["data"]), 32_000_000)

    # Post-Electra el deposito cambia de nombre. Si algun dia aparece, manda.
    #
    # ⚠ EL 40M NO ES CAPRICHO. Con un 32M aqui, esta prueba pasaba tanto si se
    #   preferia la clave buena como si no: invirtiendo el orden, el
    #   MAX_EFFECTIVE de 2.048M caia fuera de rango, se iba al respaldo — que
    #   tambien vale 32M— y el aserto seguia verde POR EL MOTIVO EQUIVOCADO.
    #   Con un valor distinto del respaldo, solo pasa si de verdad se prefiere
    #   `MIN_ACTIVATION_BALANCE`. Comprobado invirtiendo el orden a proposito.
    ok("si aparece MIN_ACTIVATION_BALANCE, manda esa",
       con_spec({"MIN_ACTIVATION_BALANCE": "40000000000000000",
                 "MAX_EFFECTIVE_BALANCE": "2048000000000000000"}), 40_000_000)

    # ⚠ LAS DOS TRAMPAS QUE EL RANGO TIENE QUE CAZAR, y las dos llegarian solas
    #   y en silencio si no estuviera.
    #   1) Un fork tipo Electra sin renombrar: 2.048M donde hay 32M.
    ok("Electra a ciegas cae al respaldo",
       con_spec({"MAX_EFFECTIVE_BALANCE": "2048000000000000000"}), 32_000_000)
    okque("y no se cuela la cifra de Electra",
          con_spec({"MAX_EFFECTIVE_BALANCE": "2048000000000000000"}) != 2_048_000_000)
    #   2) Un fallo de unidades: leer gwei como si fueran PLS.
    ok("un deposito en gwei sin dividir cae al respaldo",
       con_spec({"MAX_EFFECTIVE_BALANCE": "32000000000000000000000000"}), 32_000_000)
    #   Y dividir de mas tambien: 0,032 PLS no es un deposito.
    ok("dividir de mas tambien cae", con_spec({"MAX_EFFECTIVE_BALANCE": "32000000"}), 32_000_000)

    ok("basura en el campo cae al respaldo",
       con_spec({"MAX_EFFECTIVE_BALANCE": "treinta y dos"}), 32_000_000)
    ok("sin spec, respaldo", con_spec(None), 32_000_000)
    ok("spec vacio, respaldo", con_spec({}), 32_000_000)

    # Un deposito distinto pero verosimil SI se acepta: es el caso para el que
    # existe todo esto. Si esta prueba se pusiera verde con la constante vieja,
    # el cambio entero no serviria de nada.
    ok("un deposito distinto y verosimil se acepta",
       con_spec({"MAX_EFFECTIVE_BALANCE": "64000000000000000"}), 64_000_000)
finally:
    collector.get_json, collector._deposito = guardado2

# Y que llega hasta el estado publicado, que es lo que de verdad importa.
guardado3 = (collector._pubkeys_locales, collector.get_json, collector._deposito)
try:
    v = con_claves(PK[:2], beacon_con(PK[:2]),
                   {"data": {"MAX_EFFECTIVE_BALANCE": "64000000000000000"}})
    ok("el stake publicado usa el deposito del spec", v["stake_total"], 2 * 64_000_000)
    okque("y el deposito derivado sigue siendo exacto",
          v["stake_total"] / v["total"] == 64_000_000, str(v["stake_total"] / v["total"]))
finally:
    collector._pubkeys_locales, collector.get_json, collector._deposito = guardado3

print("\n=== 5. DESDE CUANDO ESPERA, Y SIN CONTARLO DOS VECES ===")


def datos_con(detalle, ts=5000):
    return {"generado_ts": ts,
            "validadores": {"total": len([d for d in detalle if d["indice"] is not None]),
                            "activos": len([d for d in detalle
                                            if str(d.get("estado", "")).startswith("active")]),
                            "slashed": 0, "detalle": detalle},
            "nodo": {}}


def E(pk):
    return {"indice": None, "pubkey": pk, "pubkey_corta": pk[:8] + "…" + pk[-6:],
            "estado": "esperando", "pendiente": True, "esperando": True,
            "en_cola_desde_ts": None}


def Ap(i, pk):
    d = A(i)
    d.update(pubkey=pk, esperando=False, en_cola_desde_ts=None)
    return d


def Pp(i, pk):
    d = P(i)
    d.update(pubkey=pk, esperando=False, en_cola_desde_ts=None)
    return d


BASE_PK = [f"0xaa{i:02x}" for i in range(1, 12)]
NUEVA = "0xbb99"
activos11 = [Ap(i, BASE_PK[i - 1]) for i in BASE_PK and range(1, 12)]

# Sin lista previa de pubkeys no se anuncia nada: primera ejecucion tras
# actualizar, y las once que ya estaban no son noticia.
d1 = datos_con(activos11 + [E(NUEVA)])
ok("primera ejecucion: no se inventa un anuncio",
   tipos(push.detectar_eventos(d1, {"activos": 11, "activos_indices": list(range(1, 12))})), [])

prev5 = {"activos": 11, "activos_indices": list(range(1, 12)),
         "pendientes_indices": [], "inactivos_indices": [], "esperando_pubkeys": []}
evs = push.detectar_eventos(d1, prev5)
ok("al aparecer la clave, se anuncia", tipos(evs), ["aviso"])
okque("y se dice que la cadena aun no lo conoce",
      "esperando a entrar en la cadena" in evs[0][2], str(evs))

prev6 = dict(prev5, esperando_pubkeys=[NUEVA])
ok("mientras espera, no se repite",
   push.detectar_eventos(d1, prev6), [])

# ⚠ AQUI ESTA LA TRAMPA DE CONTAR DOS VECES. Cuando la cadena adopta el
#   deposito, ese validador aparece por primera vez como `pending_queued` con
#   un indice que nadie habia visto: la regla de «indice desconocido en cola →
#   aviso» lo anunciaria otra vez. Es el mismo hecho un paso mas adelante.
d2 = datos_con(activos11 + [Pp(12, NUEVA)])
ok("cuando la cadena lo adopta, NO se anuncia otra vez",
   push.detectar_eventos(d2, prev6), [])
ok("pero uno que aparece en cola sin haber pasado por aqui, si",
   tipos(push.detectar_eventos(d2, prev5)), ["aviso"])

# El reloj de la espera: por PUBKEY, no por indice. Si fuera por indice, se
# pondria a cero justo al pasar de «esperando» a «en cola», que es cuando la
# cadena le da numero.
m1 = push.marcar_espera(datos_con(activos11 + [E(NUEVA)], ts=1000), {})
ok("la primera vez, se apunta el instante", m1, {NUEVA: 1000})
d3 = datos_con(activos11 + [Pp(12, NUEVA)], ts=90000)
push.marcar_espera(d3, {"visto_desde": m1})
ok("y al entrar en la cadena NO se reinicia",
   d3["validadores"]["detalle"][-1]["en_cola_desde_ts"], 1000)
d4 = datos_con(activos11 + [Ap(12, NUEVA)], ts=99000)
ok("cuando ya valida, se suelta la marca", push.marcar_espera(d4, {"visto_desde": m1}), {})

# Y el guarda que impide que todo esto mate al push.
ok("un indice ausente no revienta nada", push._idx({"indice": None}), None)
ok("ni uno que no es un numero", push._idx({"indice": "x"}), None)
ok("y uno normal se lee", push._idx({"indice": "7"}), 7)

print("\n=== 6. LA DIRECCION DE RETIRADA SALE DE LA CADENA ===")
# Estuvo escrita a mano en la Function de ganancias y en el explorador. Ahora
# la publica el recolector leyendo las `withdrawal_credentials`.
DIR = "952e0311dddce7090d61a275f411a6ddf879bdc8"
CRED = "0x01" + "00" * 11 + DIR          # la forma exacta que devolvio el nodo
ok("la credencial real da la direccion", collector.direccion_retirada(CRED), "0x" + DIR)
ok("en mayusculas tambien", collector.direccion_retirada(CRED.upper().replace("0X", "0x")), "0x" + DIR)
ok("0x02 tambien lleva direccion", collector.direccion_retirada("0x02" + "00" * 11 + DIR), "0x" + DIR)
# ⚠ 0x00 es un hash BLS: leer sus ultimos 20 bytes daria una direccion que no
#   existe, y la Function recorreria una wallet ajena.
ok("0x00 NO tiene direccion", collector.direccion_retirada("0x00" + "ab" * 31), None)
ok("sin los once ceros no es una direccion",
   collector.direccion_retirada("0x01" + "00" * 10 + "01" + DIR), None)
ok("corta no vale", collector.direccion_retirada("0x01" + DIR), None)
ok("sin campo, None", collector.direccion_retirada(None), None)

ok("todos iguales: esa", collector._retirada_del_grupo({"0xaa"}, 0), "0xaa")
ok("dos distintas: ninguna", collector._retirada_del_grupo({"0xaa", "0xbb"}, 0), None)
ok("una sin direccion basta para no dar ninguna", collector._retirada_del_grupo({"0xaa"}, 1), None)
ok("sin validadores, ninguna", collector._retirada_del_grupo(set(), 0), None)


def beacon_cred(pubkeys, creds, epoch="319720"):
    r = beacon_con(pubkeys)
    for v, c in zip(r["data"], creds):
        v["validator"]["withdrawal_credentials"] = c
        v["validator"]["activation_epoch"] = epoch
    return r


guardado8 = (collector._pubkeys_locales, collector.get_json, collector._deposito)
try:
    v = con_claves(PK, beacon_cred(PK[:11], [CRED] * 11))
    ok("llega al estado publicado", v["wallet_retirada"], "0x" + DIR)
    # ⚠ El que espera no tiene credenciales —la cadena no lo conoce— y no puede
    #   quitarle la direccion al grupo.
    ok("el que espera no la estropea", v["esperando"], 1)
    otra = "0x01" + "00" * 11 + "11" * 20
    ok("un validador con otra wallet la deja en None",
       con_claves(PK[:3], beacon_cred(PK[:3], [CRED, CRED, otra]))["wallet_retirada"], None)
    ok("uno con 0x00 tambien",
       con_claves(PK[:2], beacon_cred(PK[:2], [CRED, "0x00" + "ab" * 31]))["wallet_retirada"], None)

    # La activacion del grupo, en unix: la que estaba escrita como 1786095955.
    ok("la activacion del grupo sale de la epoch", v["activacion_ts"], 1786095955)
finally:
    collector._pubkeys_locales, collector.get_json, collector._deposito = guardado8

print("\n=== 7. LA RED, DEL MISMO SPEC ===")
guardado9 = (collector.get_json, collector._deposito, collector._spec)
try:
    collector.get_json = lambda url: {"data": dict(SPEC_HOY["data"],
        GENESIS_FORK_VERSION="0x00000369",
        DEPOSIT_CONTRACT_ADDRESS="0x3693D1c7aF5c4A4b8A0A8e1c4E1D0D0f6f0D1c0F")}
    collector.deposito_pls(forzar=True)
    r = collector.red()
    ok("el deposito", r["deposito"], 32_000_000)
    ok("la version de fork, normalizada", r["fork_version"], "0x00000369")
    ok("el contrato, en minusculas", r["contrato_deposito"],
       "0x3693d1c7af5c4a4b8a0a8e1c4e1d0d0f6f0d1c0f")
    collector.get_json = lambda url: {"data": dict(SPEC_HOY["data"],
        GENESIS_FORK_VERSION="0x0369", DEPOSIT_CONTRACT_ADDRESS="no")}
    collector.deposito_pls(forzar=True)
    r = collector.red()
    ok("una version con otra forma no se publica", r["fork_version"], None)
    ok("ni un contrato que no es una direccion", r["contrato_deposito"], None)
finally:
    collector.get_json, collector._deposito, collector._spec = guardado9

print("\n=== 8. EL ENTORNO NO TUMBA AL RECOLECTOR ===")
import os, tempfile, time as _t
guardado10 = collector.KEYSTORE_DIR
try:
    with tempfile.TemporaryDirectory() as base:
        claves = os.path.join(base, "validator_keys")
        os.mkdir(claves)
        collector.KEYSTORE_DIR = claves
        e = collector.entorno()
        ok("sin script de recuperacion, no se ofrece", e["script_recuperacion"], None)
        ok("sin deposit_data, nada", e["deposit_data_reciente"], None)
        ok("la carpeta de claves es la configurada", e["dir_claves"], claves)
        okque("el usuario es el de la maquina", bool(e["usuario"]), str(e["usuario"]))

        open(os.path.join(base, "start_validator.sh"), "w").close()
        viejo = os.path.join(claves, "deposit_data-1000.json")
        nuevo = os.path.join(claves, "deposit_data-2000.json")
        open(viejo, "w").close(); open(nuevo, "w").close()
        os.utime(viejo, (1000, 1000)); os.utime(nuevo, (2000, 2000))
        e = collector.entorno()
        ok("con script, su ruta", e["script_recuperacion"], os.path.join(base, "start_validator.sh"))
        ok("el deposit_data mas reciente", e["deposit_data_reciente"],
           {"nombre": "deposit_data-2000.json", "ts": 2000})

        collector.KEYSTORE_DIR = os.path.join(base, "no", "existe")
        e = collector.entorno()
        ok("una carpeta que no existe no lanza", e["deposit_data_reciente"], None)
finally:
    collector.KEYSTORE_DIR = guardado10

print("\n=== 9. EL EXPLORADOR SE PUEDE IMPORTAR ===")
# ⚠ No se podia: resolvia los indices AL IMPORTAR con un `BEACON` y un
#   `requests` que no existian, y lanzaba NameError. `comprobar.py` lo tragaba
#   y daba el explorador por pendiente para siempre.
explorador = cargar("explorador")
okque("importa sin tocar la red", hasattr(explorador, "grupo"))
okque("y no lleva la wallet escrita", not hasattr(explorador, "WALLET"))
okque("ni la fecha de activacion", not hasattr(explorador, "ACTIVACION_TS"))
guardado11 = collector.leer_validadores
try:
    collector.leer_validadores = lambda: {
        "detalle": [{"indice": 7}, {"indice": None}], "wallet_retirada": "0xaa",
        "activacion_ts": 123}
    ok("el grupo sale del recolector", explorador.grupo(), ({7}, "0xaa", 123))
    collector.leer_validadores = lambda: {"detalle": [], "wallet_retirada": None,
                                          "activacion_ts": 123}
    try:
        explorador.grupo(); okque("sin wallet no recorre nada", False)
    except RuntimeError:
        okque("sin wallet no recorre nada", True)
finally:
    collector.leer_validadores = guardado11

print("\n" + "=" * 52)
print(f"FALLAN {fallos} de {pruebas}" if fallos else f"TODO CORRECTO ({pruebas})")
sys.exit(1 if fallos else 0)
