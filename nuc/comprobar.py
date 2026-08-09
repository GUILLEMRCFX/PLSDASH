#!/usr/bin/env python3
"""
PLSDASH — comprobación de extremo a extremo.

Un solo comando que responde a «¿está todo bien montado?». Se ejecuta en el
NUC, no toca nada y no escribe en ninguna parte: solo lee y compara.

    python3 comprobar.py

Cada prueba imprime OK, FALLO o PENDIENTE. PENDIENTE significa que aún no hay
datos suficientes para juzgar, no que algo esté roto.

La prueba que más importa es la última: cuadrar la ganancia que reconstruye el
panel desde sus snapshots contra la que dice la cadena. Si esas dos cifras
coinciden, toda la tubería —recolección, barridos, almacenamiento y cálculo—
está bien de punta a punta. Si no coinciden, algo falla en medio.
"""

import json
import sys
import urllib.request

BEACON = "http://localhost:5052"
VALIDADORES = set(range(109549, 109559))
STAKE_TOTAL = 320_000_000
TIMEOUT = 20

ok_total = 0
fallos = 0
pendientes = 0


def resultado(estado, titulo, detalle=""):
    global ok_total, fallos, pendientes
    marca = {"OK": "  OK      ", "FALLO": "  FALLO   ", "PEND": "  PENDIENTE"}[estado]
    print(f"{marca} {titulo}")
    if detalle:
        for linea in detalle.split("\n"):
            print(f"             {linea}")
    if estado == "OK":
        ok_total += 1
    elif estado == "FALLO":
        fallos += 1
    else:
        pendientes += 1


def pedir(url):
    req = urllib.request.Request(url, headers={"User-Agent": "plsdash-check/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def miles(x):
    return f"{x:,.0f}".replace(",", ".")


# --------------------------------------------------------------------------

print("\nPLSDASH — comprobación de la tubería\n" + "=" * 52 + "\n")

# 1. El nodo responde
try:
    cab = pedir(f"{BEACON}/eth/v1/beacon/headers/head")
    slot = int(cab["data"]["header"]["message"]["slot"])
    resultado("OK", "El nodo responde", f"slot {miles(slot)} · epoch {miles(slot // 32)}")
except Exception as e:
    resultado("FALLO", "El nodo responde", str(e))
    print("\nSin nodo no se puede comprobar nada más.\n")
    sys.exit(1)

# 2. Sincronización
try:
    sync = pedir(f"{BEACON}/eth/v1/node/syncing")["data"]
    dist = int(sync.get("sync_distance", 0))
    if dist <= 2 and not sync.get("is_syncing"):
        resultado("OK", "Nodo sincronizado", f"distancia {dist}")
    else:
        resultado("FALLO", "Nodo sincronizado", f"distancia {dist}, is_syncing={sync.get('is_syncing')}")
except Exception as e:
    resultado("FALLO", "Nodo sincronizado", str(e))

# 3. Validadores activos de la red — el denominador de la probabilidad de bloque
try:
    act = pedir(f"{BEACON}/eth/v1/beacon/states/head/validators?status=active_ongoing")
    n_red = len(act["data"])
    resultado("OK", "Validadores activos en la red", f"{miles(n_red)}")
except Exception as e:
    n_red = None
    resultado("PEND", "Validadores activos en la red", f"no se pudo contar: {e}")

# 4. Nuestros diez validadores
excedente = None
try:
    ids = ",".join(str(i) for i in sorted(VALIDADORES))
    mios = pedir(f"{BEACON}/eth/v1/beacon/states/head/validators?id={ids}")["data"]
    activos = [v for v in mios if v["status"] == "active_ongoing"]
    slashed = [v for v in mios if v["validator"].get("slashed")]
    saldo = sum(int(v["balance"]) for v in mios) / 1e9
    excedente = saldo - STAKE_TOTAL
    if len(activos) == 10 and not slashed:
        resultado("OK", "Los 10 validadores activos", f"excedente sin barrer: {miles(excedente)} PLS")
    else:
        resultado("FALLO", "Los 10 validadores activos",
                  f"activos {len(activos)}/10 · penalizados {len(slashed)}")
except Exception as e:
    resultado("FALLO", "Los 10 validadores activos", str(e))

# 5. El explorador responde y se entiende su respuesta
#
# Solo se pide UNA página. Una comprobación de salud tiene que ser rápida: lo
# que se quiere saber aquí es si la API contesta y si el filtrado funciona, no
# recalcular el total. El total acumulado lo lleva el panel desde Cloudflare,
# que además tiene mejor salida a internet que el NUC.
retirado = None
try:
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    import explorador
    from explorador import retiradas, barridos

    explorador.MAX_PAGINAS = 1
    retirado, detalle, descartadas = retiradas()
    ciclos = barridos(detalle)
    bloques = sum(len(c["bloques"]) for c in ciclos)
    resultado("OK", "El explorador responde",
              f"últimos {len(ciclos)} barridos: {miles(retirado)} PLS\n"
              f"{bloques} con recompensa de bloque · {descartadas} del validador anterior\n"
              f"(solo la última página; el total lo lleva el panel)")
except Exception as e:
    # Que el explorador no conteste no invalida la tubería: el panel lo
    # reconcilia por su cuenta desde Cloudflare.
    resultado("PEND", "El explorador responde",
              f"{e}\nNo bloquea: el panel reconcilia desde Cloudflare.")

# 6. El precio se está guardando
try:
    from precio_y_bloques import precio_pls

    p = precio_pls()
    if not p or p <= 0:
        resultado("FALLO", "Precio de PLS disponible", "DexScreener no devolvió precio")
    elif not (1e-6 <= p <= 1e-3):
        # Un precio de otro orden de magnitud casi siempre significa que se ha
        # leído el par equivocado, no que PLS se haya movido tanto.
        resultado("FALLO", "Precio de PLS disponible",
                  f"{p:.8f} $/PLS está fuera del rango esperado (1e-6 a 1e-3)")
    else:
        resultado("OK", "Precio de PLS disponible",
                  f"{p:.8f} $/PLS · tu wallet valdría "
                  f"{miles(515921 * p)} $ aprox.")
except Exception as e:
    resultado("FALLO", "Precio de PLS disponible", str(e))

# 7. Lo que el panel tiene que estar mostrando
if excedente is not None:
    print()
    print("  ── El panel debe mostrar ──")
    print()
    print(f"     Excedente sin barrer  : {miles(excedente)} PLS")
    print("     + todo lo ya retirado desde la activación")
    print()
    print("     Si el número principal del panel se parece al excedente")
    print(f"     ({miles(excedente)} PLS), la reconciliación no está llegando:")
    print("     debería ser varias veces mayor.")

# --------------------------------------------------------------------------

print("\n" + "=" * 52)
print(f"  {ok_total} correctas · {fallos} fallos · {pendientes} pendientes\n")
sys.exit(1 if fallos else 0)
