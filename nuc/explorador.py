"""
PLSDASH — reconciliación contra el explorador de PulseChain.

El nodo dice lo que cree; la cadena dice lo que pasó. Cuando los dos no
coinciden, gana la cadena. Este módulo trae de Blockscout las cifras que el
beacon no puede dar y las cuadra con lo que tenemos guardado.

## Por qué hace falta

`ganado` = `balance_total − stake_total` es solo el excedente **sin barrer**.
Cada ~9 h el protocolo retira ese excedente a la wallet de retirada y el
contador vuelve a cero. Así que la ganancia real tiene tres piezas, y el
beacon solo ve la tercera:

    ganancia real = retiradas acumuladas        (capa de consenso, barridas)
                  + ingresos por bloque         (capa de ejecución, directos)
                  + excedente sin barrer        (lo único que ve `ganado`)

Los ingresos por proponer bloque **no pasan por el balance del validador**:
las propinas de la capa de ejecución se abonan directamente a la dirección
receptora de comisiones. Por eso no aparecen en `ganado` y por eso el saldo de
la wallet crece más deprisa de lo que explican las atestaciones.

## Uso

Como módulo, desde push.py:

    from explorador import reconciliar
    informe = reconciliar(saldo_sin_barrer=v["ganado_total"])

Como comprobación manual, en el NUC:

    python3 explorador.py

Esto último imprime todo lo que ve y es la forma de verificar que la API
responde lo que este código espera: no se ha podido probar contra el
explorador real desde el entorno donde se escribió.
"""

import json
import time
import urllib.parse
import urllib.request

# Wallet de retirada y receptora de comisiones de los diez validadores.
WALLET = "0x952E0311DdDCe7090d61a275f411a6ddF879BDc8"

# ATENCIÓN: esta wallet YA SE USÓ con un validador anterior durante cerca de un
# año. Su saldo y su lista de bloques mezclan aquella etapa con la actual, así
# que **nada de lo que devuelve el explorador sirve sin filtrar por fecha**.
#
# Activación de los diez validadores actuales (tabla `eventos`, tipo
# `activacion`): 2026-08-07T09:45:55Z.
ACTIVACION_TS = 1786095955

API = "https://api.scan.pulsechain.com/api/v2"

# PLS, como ETH, se contabiliza en wei on-chain.
WEI = 10 ** 18

TIMEOUT = 20

# Tope de páginas por consulta. Blockscout pagina de 50 en 50; con retiradas
# cada ~9 h esto cubre años sin dejar que un fallo convierta la consulta en un
# bucle infinito.
MAX_PAGINAS = 40


def _pedir(ruta, params=None):
    url = f"{API}{ruta}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "plsdash/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def _paginar(ruta, params=None):
    """Recorre un listado paginado de Blockscout y devuelve todos los items."""
    items = []
    siguiente = dict(params or {})
    for _ in range(MAX_PAGINAS):
        datos = _pedir(ruta, siguiente)
        lote = datos.get("items") or []
        items.extend(lote)

        np = datos.get("next_page_params")
        if not np or not lote:
            break
        siguiente = dict(params or {})
        siguiente.update(np)

    return items


def _a_pls(valor):
    """Blockscout devuelve importes en wei, como cadena."""
    if valor is None:
        return 0.0
    try:
        return int(valor) / WEI
    except (TypeError, ValueError):
        try:
            return float(valor) / WEI
        except (TypeError, ValueError):
            return 0.0


def _ts(marca):
    """Convierte la marca ISO de Blockscout a unix. None si no se entiende."""
    if not marca:
        return None
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(str(marca).replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def retiradas(wallet=WALLET, desde_ts=ACTIVACION_TS):
    """Retiradas de consenso posteriores a `desde_ts`. (total_pls, [detalle]).

    El filtro por fecha no es un detalle: sin él se cuenta también lo que
    cobró el validador anterior con esta misma wallet.
    """
    items = _paginar(f"/addresses/{wallet}/withdrawals", {"items_count": 50})
    detalle = []
    descartadas = 0
    for w in items:
        ts = _ts(w.get("timestamp"))
        if desde_ts and ts is not None and ts < desde_ts:
            descartadas += 1
            continue
        detalle.append({
            "indice": w.get("index"),
            "bloque": w.get("block_number"),
            "fecha": w.get("timestamp"),
            "ts": ts,
            "pls": _a_pls(w.get("amount")),
        })
    return sum(d["pls"] for d in detalle), detalle, descartadas


def bloques_validados(wallet=WALLET, desde_ts=ACTIVACION_TS):
    """Bloques propuestos después de `desde_ts`. (cuántos, [detalle], descartados).

    Los 37 que muestra la ficha del explorador incluyen los del validador
    anterior; sin filtrar, el contador del panel sería falso.
    """
    items = _paginar(f"/addresses/{wallet}/blocks-validated", {"items_count": 50})
    detalle = []
    descartados = 0
    for b in items:
        ts = _ts(b.get("timestamp"))
        if desde_ts and ts is not None and ts < desde_ts:
            descartados += 1
            continue
        detalle.append({
            "altura": b.get("height"),
            "fecha": b.get("timestamp"),
            "ts": ts,
        })
    return len(detalle), detalle, descartados


def saldo_wallet(wallet=WALLET):
    """Saldo actual de la wallet, en PLS.

    Ojo: incluye lo que quedara de la etapa anterior. No es atribuible a los
    validadores actuales y por eso no entra en el cálculo de la ganancia.
    """
    datos = _pedir(f"/addresses/{wallet}")
    return _a_pls(datos.get("coin_balance"))


def reconciliar(saldo_sin_barrer=0.0, wallet=WALLET):
    """Cuadra la cadena con lo que ve el nodo.

    `saldo_sin_barrer` es el `ganado_total` que reporta el beacon: el excedente
    que todavía no se ha retirado.

    Devuelve un informe con la ganancia real y, cuando se puede, el descuadre
    frente al saldo de la wallet. Ante un fallo de red devuelve `error` en vez
    de reventar: esto es una comprobación, no debe tumbar el recolector.
    """
    informe = {"ts": int(time.time()), "error": None}
    try:
        total_retirado, det_ret, ret_previas = retiradas(wallet)
        n_bloques, det_blq, blq_previos = bloques_validados(wallet)
        saldo = saldo_wallet(wallet)
    except Exception as e:
        informe["error"] = f"{type(e).__name__}: {e}"
        return informe

    informe.update({
        "retirado_consenso": total_retirado,
        "bloques": n_bloques,
        "saldo_wallet": saldo,
        "saldo_sin_barrer": saldo_sin_barrer,
        # Lo retirado desde la activación más lo que aún no se ha barrido.
        "ganancia_real": total_retirado + saldo_sin_barrer,
        "ultima_retirada": det_ret[0] if det_ret else None,
        "ultimo_bloque": det_blq[0] if det_blq else None,
        # Lo descartado por ser de la etapa anterior. Si sale 0 en las dos,
        # sospechar del filtro antes que celebrarlo.
        "retiradas_descartadas": ret_previas,
        "bloques_descartados": blq_previos,
    })

    # El saldo de la wallet NO se compara con lo retirado: arrastra el resto de
    # la etapa anterior y cualquier gasto hecho desde ella, así que la
    # diferencia no es atribuible a nada en concreto.
    return informe


if __name__ == "__main__":
    print(f"Consultando el explorador para {WALLET}\n")
    inf = reconciliar()

    if inf["error"]:
        print(f"  ERROR: {inf['error']}")
        print("\n  Si la API ha cambiado de forma, ajustar _pedir/_paginar.")
        raise SystemExit(1)

    def pls(x):
        return f"{x:,.2f} PLS".replace(",", "@").replace(".", ",").replace("@", ".")

    print("  Desde la activación de los 10 validadores actuales")
    print("  (2026-08-07 09:45:55 UTC):\n")
    print(f"    Retiradas de consenso : {pls(inf['retirado_consenso'])}")
    print(f"    Bloques propuestos    : {inf['bloques']}")
    print()
    print("  Descartado por ser del validador anterior:\n")
    print(f"    Retiradas             : {inf['retiradas_descartadas']}")
    print(f"    Bloques               : {inf['bloques_descartados']}")
    print()
    print(f"  Saldo actual de la wallet: {pls(inf['saldo_wallet'])}")
    print("    (mezcla ambas etapas: no atribuible a los validadores actuales)")
    print()
    print(f"  Última retirada : {inf['ultima_retirada']}")
    print(f"  Último bloque   : {inf['ultimo_bloque']}")
    print()
    print("  Ganancia real = retiradas desde la activación + excedente sin barrer")
    print(f"                = {pls(inf['retirado_consenso'])} + lo que diga el beacon ahora")
