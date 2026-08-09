"""
PLSDASH — reconciliación contra el explorador de PulseChain.

El nodo dice lo que cree; la cadena dice lo que pasó. Cuando los dos no
coinciden, gana la cadena. Este módulo trae de Blockscout las cifras que el
beacon no puede dar y las cuadra con lo que tenemos guardado.

## Por qué hace falta

`ganado` = `balance_total − stake_total` es solo el excedente **sin barrer**.
Cada ~8,1 h el protocolo lo retira a la wallet y el contador vuelve a cero:

    ganancia real = retiradas de nuestros validadores + excedente sin barrer

Con los datos del 9-ago-2026 eso son 142.451,91 + 29.115,55 = 171.567,46 PLS,
frente a los 29.115,55 que enseñaba el panel. Casi seis veces menos.

La recompensa de proponer un bloque **sí** pasa por el balance del validador y
por tanto se barre con el resto: en cada ciclo, uno de los diez cobra ~8.100
PLS en vez de los ~2.390 habituales. Contarlas es una forma barata de contar
bloques sin recorrer las duties del beacon.

## Verificación cruzada

Los barridos del explorador cuadran con los snapshots propios con un 0,23% de
desviación, así que las dos fuentes se confirman entre sí:

    08-08 18:59  explorador 29.679  ·  snapshot 26.768 + 59 min de ritmo
    09-09 03:04  explorador 29.636  ·  snapshot 29.372 +  4 min de ritmo

## Uso

Como módulo, desde push.py:

    from explorador import reconciliar
    informe = reconciliar(saldo_sin_barrer=v["ganado_total"])

Como comprobación manual, en el NUC:

    python3 explorador.py
"""

import json
import time
import urllib.parse
import urllib.request

# Wallet de retirada y receptora de comisiones de los diez validadores.
WALLET = "0x952E0311DdDCe7090d61a275f411a6ddF879BDc8"

# ATENCIÓN: esta wallet YA SE USÓ con un validador anterior durante cerca de un
# año. Su saldo y su lista de bloques mezclan aquella etapa con la actual, así
# que nada de lo que devuelve el explorador sirve sin filtrar.
#
# El filtro bueno son los índices de validador, no las fechas: cada retirada
# trae `validator_index`, y los diez actuales son 109549..109558. Es exacto y no
# depende de acertar con la marca de activación.
VALIDADORES = set(range(109549, 109559))

# Activación de los diez actuales (evento `activacion` en D1). Se conserva solo
# como red de seguridad para listados que no traigan índice de validador.
ACTIVACION_TS = 1786095955

# Cadencia real de los barridos, medida sobre cinco retiradas consecutivas:
# 8,06 / 8,11 / 8,11 / 8,08 h. No son las ~9 h que sugería el muestreo horario.
HORAS_ENTRE_BARRIDOS = 8.09

# Una retirada normal ronda los 2.390 PLS por validador y ciclo. Cuando un
# validador propone un bloque, la suya sube a ~8.100: unos 5.720 PLS de más.
# Sirve para contar bloques sin recorrer las duties, aunque dos bloques en el
# mismo ciclo se contarían como uno.
UMBRAL_BLOQUE_PLS = 5000

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


def retiradas(wallet=WALLET, validadores=VALIDADORES):
    """Retiradas de consenso de nuestros validadores.

    Devuelve (total_pls, [detalle], descartadas).

    Forma de la respuesta, verificada contra la API real el 9-ago-2026:

        {"items": [{"amount": "2385987101633000000000",   # wei, cadena
                    "block_number": 27240802,
                    "index": 160124319,
                    "timestamp": "2026-08-09T03:04:35.000000Z",
                    "validator_index": 109558}, ...],
         "next_page_params": {"index": ..., "items_count": ...}}

    El filtro por `validator_index` es lo que separa esta etapa de la anterior:
    sin él se sumaría un año de retiradas del validador viejo.
    """
    items = _paginar(f"/addresses/{wallet}/withdrawals", {"items_count": 50})
    detalle = []
    descartadas = 0
    for w in items:
        vi = w.get("validator_index")
        if validadores and vi is not None and int(vi) not in validadores:
            descartadas += 1
            continue
        detalle.append({
            "indice": w.get("index"),
            "validador": vi,
            "bloque": w.get("block_number"),
            "fecha": w.get("timestamp"),
            "ts": _ts(w.get("timestamp")),
            "pls": _a_pls(w.get("amount")),
        })
    return sum(d["pls"] for d in detalle), detalle, descartadas


def barridos(detalle):
    """Agrupa las retiradas en barridos (todas comparten instante).

    Un barrido puede repartirse entre dos bloques consecutivos —se ha visto
    partido en 3 + 7 validadores con 10 s de diferencia—, así que se agrupa por
    marca de tiempo redondeada al minuto.
    """
    grupos = {}
    for d in detalle:
        if d["ts"] is None:
            continue
        clave = d["ts"] // 60
        g = grupos.setdefault(clave, {"ts": d["ts"], "pls": 0.0, "validadores": 0, "bloques": []})
        g["pls"] += d["pls"]
        g["validadores"] += 1
        if d["pls"] > UMBRAL_BLOQUE_PLS:
            g["bloques"].append(d["validador"])

    return sorted(grupos.values(), key=lambda g: g["ts"])


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
        saldo = saldo_wallet(wallet)
    except Exception as e:
        informe["error"] = f"{type(e).__name__}: {e}"
        return informe

    ciclos = barridos(det_ret)
    con_bloque = [b for c in ciclos for b in c["bloques"]]

    informe.update({
        "retirado_consenso": total_retirado,
        "barridos": len(ciclos),
        "bloques_por_retirada": len(con_bloque),
        "validadores_con_bloque": con_bloque,
        "saldo_wallet": saldo,
        "saldo_sin_barrer": saldo_sin_barrer,
        # Lo retirado por nuestros validadores más lo que aún no se ha barrido.
        # Esta es la ganancia real: `ganado` del beacon solo ve el segundo
        # sumando y por eso se queda muy corto.
        "ganancia_real": total_retirado + saldo_sin_barrer,
        "ultimo_barrido": ciclos[-1] if ciclos else None,
        "retiradas_descartadas": ret_previas,
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
        raise SystemExit(1)

    def pls(x):
        return f"{x:,.2f} PLS".replace(",", "@").replace(".", ",").replace("@", ".")

    print(f"  Barridos                : {inf['barridos']}")
    print(f"  Retirado (validadores {min(VALIDADORES)}-{max(VALIDADORES)})")
    print(f"                          : {pls(inf['retirado_consenso'])}")
    print(f"  Excedente sin barrer    : {pls(inf['saldo_sin_barrer'])}")
    print(f"  {'-' * 44}")
    print(f"  GANANCIA REAL           : {pls(inf['ganancia_real'])}")
    print()
    print(f"  Retiradas con bloque    : {inf['bloques_por_retirada']}"
          f"  (validadores {inf['validadores_con_bloque']})")
    print(f"  Descartadas por ser del validador anterior: {inf['retiradas_descartadas']}")
    print()
    print(f"  Saldo de la wallet      : {pls(inf['saldo_wallet'])}")
    print("    (mezcla ambas etapas, no atribuible a los validadores actuales)")
