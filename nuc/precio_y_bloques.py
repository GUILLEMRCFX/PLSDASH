"""
PLSDASH — el precio de PLS para push.py en el NUC.

Guarda el precio de PLS en cada snapshot, para poder ver su evolucion en el
panel. No se puede reconstruir despues: el precio de una hora concreta no lo
sirve ninguna API pasado el momento.

── QUE HABIA AQUI Y POR QUE YA NO ESTA ──────────────────────────────────────

Este fichero tenia tambien una seccion de deteccion de bloques propuestos
—`revisar_bloques()` y sus ayudantes— que **nunca se llego a enganchar**:
`/api/val/ganancia` ya registra los bloques desde los barridos, y engancharla
los habria duplicado. Quedo descartada (documento 27) y aqui muerta.

⚠ SE BORRA, Y NO ES LIMPIEZA COSMETICA. Llevaba dentro esto:

    VALIDADORES = set(range(109549, 109559))   # «los diez validadores propios»

que es **la violacion del principio P2 citada literalmente en la
constitucion**: un rango escrito a mano describiendo el mundo. Se habia
quedado vieja dos veces —faltaban el 109876 y el 110855— y el comentario
seguia diciendo diez. No corria, pero `push.py` importa este fichero, asi
que era un arma cargada esperando a que alguien llamara a la funcion.

Si algun dia hace falta contar bloques desde el beacon, las pubkeys salen del
disco con `collector._pubkeys_locales()`, nunca de un rango.
"""

from datetime import date, timezone, datetime
import time

import requests

# --------------------------------------------------------------------------
# Configuración
# --------------------------------------------------------------------------

# El precio vive en un solo sitio: la Function /api/precio de PLSDASH. La
# portada y el panel de validador beben de ahí, así que el NUC bebiendo de ahí
# también significa que la cifra que se guarda en D1 es exactamente la misma
# que se está enseñando en pantalla, y no una cuarta lectura suelta.
PRECIO_API = "https://plsdash.com/api/precio"

# WPLS: PLS nativo no es un PRC-20, así que su precio se lee del par de WPLS
# con más liquidez. Mismo contrato y mismo criterio que usa index.html.
WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27"
DEXSCREENER = "https://api.dexscreener.com/token-pairs/v1/pulsechain"

TIMEOUT = 15


# --------------------------------------------------------------------------
# 1. Precio de PLS
# --------------------------------------------------------------------------

def precio_pls():
    """USD por PLS. None si no se consigue por ningún camino.

    Primero la Function de PLSDASH, que es donde vive el precio para todo el
    mundo. Si no responde, DexScreener directo.

    Ese respaldo NO es un segundo camino: es lo que evita que un rato de
    Cloudflare caído se convierta en un hueco permanente en la serie. El precio
    de una hora concreta no lo sirve ninguna API pasado el momento, así que la
    fila que se pierde no se recupera nunca.

    Devuelve None si fallan los dos. Un hueco en la columna es preferible a un
    precio inventado: el hueco se ve, y un cero de relleno se confunde con un
    dato bueno y deforma la gráfica sin dejar rastro.
    """
    precio = _precio_desde_function()
    if precio is not None:
        return precio
    return _precio_desde_dexscreener()


def _precio_desde_function():
    """Precio desde /api/precio. None si la Function no responde o no lo tiene.

    La Function sirve también el último precio bueno cuando DexScreener falla,
    marcado con `obsoleto`. Se acepta igual: para la serie histórica un precio
    de hace unos minutos es una aproximación honrada, y desde luego mejor que
    el NULL que dejaría rechazarlo.
    """
    try:
        r = requests.get(PRECIO_API, timeout=TIMEOUT)
        # 503 es el estado explícito de «ni fuente ni respaldo». No es un error
        # de red: es la Function diciendo que no tiene nada, y por eso se cae
        # directamente al respaldo en vez de reintentar.
        if r.status_code == 503:
            print("[precio_pls] la Function no tiene precio; voy a DexScreener")
            return None
        r.raise_for_status()

        d = r.json()
        if not isinstance(d, dict) or not d.get("disponible"):
            return None

        precio = float(d.get("precio") or 0)
        if precio <= 0:
            return None

        if d.get("obsoleto"):
            edad = int(d.get("edad_s") or 0)
            print(f"[precio_pls] precio obsoleto de hace {edad // 60} min")
        return precio

    except Exception as e:
        print(f"[precio_pls] la Function no respondió ({e}); voy a DexScreener")
        return None


def _precio_desde_dexscreener():
    """USD por PLS, tomado del par de WPLS con más liquidez. None si falla.

    Respaldo del respaldo. Mismo criterio que aplica la Function, escrito aquí
    otra vez a propósito: si dependiera de ella no serviría para el caso en que
    ella es justo lo que ha fallado.
    """
    try:
        r = requests.get(f"{DEXSCREENER}/{WPLS}", timeout=TIMEOUT)
        r.raise_for_status()
        pares = r.json()
        if not isinstance(pares, list) or not pares:
            return None

        # `priceUsd` es el precio del token BASE del par, así que solo valen los
        # pares donde WPLS es la base: en uno tipo HEX/WPLS ese campo traería el
        # precio del HEX. Es la misma comprobación que hace la Function.
        #
        # Hoy no cambia el resultado —el par con más liquidez, WPLS/DAI en
        # PulseX, ya tiene WPLS como base— pero evita que un par nuevo con más
        # liquidez y WPLS del lado de la cotización devuelva otro precio.
        propios = [
            p for p in pares
            if ((p.get("baseToken") or {}).get("address") or "").lower() == WPLS
        ]
        if not propios:
            return None

        mejor = max(
            propios,
            key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0),
        )
        precio = float(mejor.get("priceUsd") or 0)
        return precio if precio > 0 else None

    except Exception as e:  # red caída, JSON raro, DexScreener de mantenimiento
        print(f"[precio_pls] tampoco DexScreener: {e} — la columna queda a NULL")
        return None
