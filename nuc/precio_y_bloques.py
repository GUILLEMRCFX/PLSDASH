"""
PLSDASH — añadidos para push.py en el NUC.

Dos cosas que el recolector actual no hace:

  1. Guardar el precio de PLS en cada snapshot, para poder ver su evolución
     en el panel. No se puede reconstruir después: el precio de una hora
     concreta no lo sirve ninguna API pasado el momento.

  2. Detectar propuestas de bloque. push.py ya detecta caídas, reinicios
     y desincronizaciones, pero no bloques, así que el registro de vida se
     queda sin su evento más valioso y el contador se queda en cero.

Este módulo no toca la base de datos por su cuenta: recibe la función `d1`
que push.py ya usa para hablar con D1. Ver INTEGRACION.md, al lado de este
archivo, para los tres puntos donde engancharlo.

Firma esperada de `d1`:

    d1(sql: str, params: list | None = None) -> list[dict]

devolviendo las filas de `results` (lista vacía si no hay).
"""

from datetime import date, timezone, datetime
import time

import requests

# --------------------------------------------------------------------------
# Configuración
# --------------------------------------------------------------------------

BEACON = "http://localhost:5052"

# Los diez validadores propios, 109549..109558.
VALIDADORES = set(range(109549, 109559))

SLOTS_POR_EPOCH = 32

# PulseChain va a 10 s por slot. No es un supuesto: sale de los propios datos
# del nodo — entre la activación (epoch 319720) y un snapshot posterior
# (epoch 320041) pasaron 321 epochs x 32 slots en 103.013 s, o sea 10,03 s.
SEGUNDOS_POR_SLOT = 10

# Tope de epochs por ejecución. Tras un parón largo evita que un solo run
# dispare cientos de peticiones contra el beacon.
MAX_EPOCHS_POR_RUN = 20

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


# --------------------------------------------------------------------------
# 2. Detección de bloques propuestos
# --------------------------------------------------------------------------

def _get(url):
    """GET contra el beacon. None si el recurso no existe (404)."""
    r = requests.get(url, timeout=TIMEOUT)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def _genesis_ts():
    """Instante del génesis, para convertir números de slot en horas reales."""
    d = _get(f"{BEACON}/eth/v1/beacon/genesis")
    return int(d["data"]["genesis_time"])


def _epoch_cabeza():
    d = _get(f"{BEACON}/eth/v1/beacon/headers/head")
    slot = int(d["data"]["header"]["message"]["slot"])
    return slot // SLOTS_POR_EPOCH


def _recompensa_pls(slot):
    """Recompensa del proponente, en PLS. None si el nodo no la sirve."""
    try:
        d = _get(f"{BEACON}/eth/v1/beacon/rewards/blocks/{slot}")
        if not d:
            return None
        return int(d["data"]["total"]) / 1e9  # el beacon responde en Gwei
    except Exception:
        # El endpoint de rewards no está en todas las configuraciones. Sin él
        # el bloque se registra igual, solo que sin cifra.
        return None


def _bloques_de_epoch(epoch):
    """Bloques que nuestros validadores propusieron de verdad en esa epoch.

    Ojo con la diferencia entre estar asignado y haber propuesto: si el slot
    se pierde no hay bloque, y anotarlo apuntaría una recompensa que nunca se
    cobró. Por eso cada asignación se confirma pidiendo la cabecera del slot.
    """
    duties = _get(f"{BEACON}/eth/v1/validator/duties/proposer/{epoch}")
    if not duties:
        return []

    encontrados = []
    for d in duties.get("data", []):
        indice = int(d["validator_index"])
        if indice not in VALIDADORES:
            continue

        slot = int(d["slot"])
        if _get(f"{BEACON}/eth/v1/beacon/headers/{slot}") is None:
            print(f"[bloques] slot {slot} asignado a {indice} pero perdido")
            continue

        encontrados.append((slot, indice, _recompensa_pls(slot)))

    return encontrados


def _ultima_epoch(d1):
    filas = d1("SELECT valor FROM meta WHERE clave = 'ultima_epoch_bloques'")
    return int(filas[0]["valor"]) if filas else None


def _guardar_ultima_epoch(d1, epoch):
    d1(
        "INSERT INTO meta (clave, valor, actualizado) "
        "VALUES ('ultima_epoch_bloques', ?, ?) "
        "ON CONFLICT(clave) DO UPDATE SET "
        "valor = excluded.valor, actualizado = excluded.actualizado",
        [str(epoch), int(time.time())],
    )


def _registrar_bloque(d1, slot, indice, pls, genesis_ts):
    """Anota el bloque en `eventos` y lo suma a `daily.bloques`."""
    # El puntero de epoch ya evita repetir, pero una reejecución manual o un
    # fallo a medias no deben duplicar el bloque ni inflar el contador.
    detalle = f"slot {slot}"
    if d1("SELECT 1 FROM eventos WHERE tipo = 'bloque' AND detalle = ? LIMIT 1", [detalle]):
        return False

    ts = genesis_ts + slot * SEGUNDOS_POR_SLOT
    d1(
        "INSERT INTO eventos (ts, tipo, titulo, detalle, pls, validador) "
        "VALUES (?, 'bloque', 'Bloque propuesto', ?, ?, ?)",
        [ts, detalle, pls, indice],
    )

    fecha = datetime.fromtimestamp(ts, timezone.utc).date().isoformat()
    d1(
        "INSERT INTO daily (fecha, bloques) VALUES (?, 1) "
        "ON CONFLICT(fecha) DO UPDATE SET bloques = bloques + 1",
        [fecha],
    )

    cifra = f"{pls:,.0f} PLS" if pls is not None else "sin cifra"
    print(f"[bloques] validador {indice} propuso el slot {slot} ({cifra})")
    return True


def revisar_bloques(d1):
    """Revisa las epochs pendientes y registra los bloques encontrados.

    Devuelve cuántos bloques nuevos se han anotado.
    """
    try:
        cabeza = _epoch_cabeza()
    except Exception as e:
        print(f"[bloques] no se pudo leer la cabeza de la cadena: {e}")
        return 0

    # Solo epochs terminadas. En la epoch en curso aún quedan slots por llegar,
    # y un bloque que todavía no se ha propuesto se daría por perdido para
    # siempre, porque el puntero ya habría pasado de largo.
    hasta = cabeza - 1

    desde = _ultima_epoch(d1)
    if desde is None:
        # Primer arranque: no se intenta reconstruir el pasado. El nodo solo
        # guarda estados recientes, así que las epochs viejas no responderían.
        # Los bloques anteriores hay que traerlos del explorador a mano.
        desde = hasta - 1
        print(f"[bloques] primer arranque, se empieza en la epoch {desde + 1}")

    if hasta <= desde:
        return 0

    # El tope limita el trabajo de cada ejecución, pero se avanza siempre por
    # las epochs más antiguas pendientes, nunca saltando a las últimas: tras un
    # parón largo el hueco se recupera en varias pasadas en vez de perderse.
    # El cron corre cada 3 min y una epoch dura 5,33 min, así que la cola se
    # vacía sola aunque el NUC haya estado horas apagado.
    primera = desde + 1
    ultima = min(hasta, desde + MAX_EPOCHS_POR_RUN)
    if ultima < hasta:
        print(f"[bloques] {hasta - ultima} epochs quedan para la próxima pasada")

    try:
        genesis_ts = _genesis_ts()
    except Exception as e:
        print(f"[bloques] no se pudo leer el génesis: {e}")
        return 0

    nuevos = 0
    ultima_ok = desde
    for epoch in range(primera, ultima + 1):
        try:
            for slot, indice, pls in _bloques_de_epoch(epoch):
                if _registrar_bloque(d1, slot, indice, pls, genesis_ts):
                    nuevos += 1
            ultima_ok = epoch
        except Exception as e:
            # Se corta aquí y se guarda hasta la última epoch completa: así el
            # siguiente run reintenta esta en vez de saltársela.
            print(f"[bloques] fallo en la epoch {epoch}: {e}")
            break

    if ultima_ok > desde:
        _guardar_ultima_epoch(d1, ultima_ok)

    return nuevos
