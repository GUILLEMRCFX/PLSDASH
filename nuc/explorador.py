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


def retiradas(wallet=WALLET):
    """Todas las retiradas de consenso recibidas. (total_pls, [detalle])."""
    items = _paginar(f"/addresses/{wallet}/withdrawals", {"items_count": 50})
    detalle = [
        {
            "indice": w.get("index"),
            "bloque": w.get("block_number"),
            "fecha": w.get("timestamp"),
            "pls": _a_pls(w.get("amount")),
        }
        for w in items
    ]
    return sum(d["pls"] for d in detalle), detalle


def bloques_validados(wallet=WALLET):
    """Bloques propuestos por los validadores. (cuántos, [detalle])."""
    items = _paginar(f"/addresses/{wallet}/blocks-validated", {"items_count": 50})
    detalle = [
        {
            "altura": b.get("height"),
            "fecha": b.get("timestamp"),
            # La recompensa de ejecución no viene en todas las versiones del
            # listado; se deja a None antes que inventarla.
            "pls": _a_pls((b.get("rewards") or [{}])[0].get("reward"))
            if b.get("rewards") else None,
        }
        for b in items
    ]
    return len(detalle), detalle


def saldo_wallet(wallet=WALLET):
    """Saldo actual de la wallet, en PLS."""
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
        total_retirado, det_ret = retiradas(wallet)
        n_bloques, det_blq = bloques_validados(wallet)
        saldo = saldo_wallet(wallet)
    except Exception as e:
        informe["error"] = f"{type(e).__name__}: {e}"
        return informe

    informe.update({
        "retirado_consenso": total_retirado,
        "bloques": n_bloques,
        "saldo_wallet": saldo,
        "saldo_sin_barrer": saldo_sin_barrer,
        # Lo retirado más lo que aún no se ha barrido. Las propinas de
        # ejecución ya están dentro del saldo de la wallet, así que sumarlas
        # aparte las contaría dos veces.
        "ganancia_real": total_retirado + saldo_sin_barrer,
        "ultima_retirada": det_ret[0] if det_ret else None,
        "ultimo_bloque": det_blq[0] if det_blq else None,
    })

    # El saldo de la wallet debería ser al menos lo retirado por consenso: la
    # diferencia es lo que han aportado las propinas de ejecución, salvo que se
    # haya gastado o movido algo desde la wallet.
    informe["ingresos_ejecucion"] = saldo - total_retirado

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

    print(f"  Retiradas de consenso : {pls(inf['retirado_consenso'])}")
    print(f"  Bloques propuestos    : {inf['bloques']}")
    print(f"  Saldo de la wallet    : {pls(inf['saldo_wallet'])}")
    print(f"  Ingresos de ejecución : {pls(inf['ingresos_ejecucion'])}  (saldo − retiradas)")
    print()
    print(f"  Última retirada       : {inf['ultima_retirada']}")
    print(f"  Último bloque         : {inf['ultimo_bloque']}")
    print()
    print("  Para la ganancia real hay que sumarle el excedente sin barrer que")
    print("  reporte el beacon en ese momento:")
    print(f"      ganancia real = {pls(inf['retirado_consenso'])} + excedente actual")
