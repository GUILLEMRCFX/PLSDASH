#!/usr/bin/env python3
"""
Recolector de métricas — Validator Dashboard
Lee Lighthouse (beacon) y Prometheus, y compone un JSON con el estado actual.

Fase 1: solo imprime por pantalla. No escribe en Cloudflare todavía.

Uso:
    python3 collector.py           # JSON completo
    python3 collector.py --pretty  # JSON legible
    python3 collector.py --resumen # resumen humano
"""

import json
import sys
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

# ----------------------------------------------------------------------
# Configuración
# ----------------------------------------------------------------------

BEACON = "http://localhost:5052"
PROM = "http://localhost:9099"

# Los validadores se descubren solos leyendo los keystores del disco.
# Antes era una lista fija y el 11o (indice 109876, no 109559) quedo fuera.
KEYSTORE_DIR = "/blockchain/validator_keys"

def _pubkeys_locales():
    import glob
    pk = set()
    for ruta in glob.glob(KEYSTORE_DIR + "/keystore-*.json"):
        try:
            p = json.load(open(ruta)).get("pubkey")
            if p:
                pk.add(p if p.startswith("0x") else "0x" + p)
        except Exception:
            pass
    return sorted(pk)

STAKE_POR_VALIDADOR = 32_000_000                  # PLS
GENESIS_TIME = 1683785555                         # de /eth/v1/beacon/genesis
SLOTS_POR_EPOCH = 32
SEGUNDOS_POR_SLOT = 10

TIMEOUT = 10


# ----------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------

def get_json(url):
    """Petición GET que devuelve JSON, o None si falla."""
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"[aviso] fallo al leer {url}: {e}", file=sys.stderr)
        return None


def prom_query(query):
    """Consulta Prometheus y devuelve el primer valor como float, o None."""
    url = f"{PROM}/api/v1/query?query={urllib.parse.quote(query)}"
    data = get_json(url)
    try:
        result = data["data"]["result"]
        if not result:
            return None
        return float(result[0]["value"][1])
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def epoch_a_fecha(epoch):
    ts = GENESIS_TIME + epoch * SLOTS_POR_EPOCH * SEGUNDOS_POR_SLOT
    return datetime.fromtimestamp(ts, tz=timezone.utc)


# ----------------------------------------------------------------------
# Recolección: validadores
# ----------------------------------------------------------------------

def leer_validadores():
    """Estado de los validadores propios.

    ─────────────────────────────────────────────────────────────────────
    POR QUE ESTE FICHERO YA NO PUBLICA RITMO NI APR

    Hasta el 18-ago-2026 salia de aqui:

        pls_hora = ganado_total / horas_activo
        apr      = pls_hora * 24 * 365 / stake_total * 100

    Las dos cifras estaban mal, y por dos motivos distintos:

    1. EL NUMERADOR. `ganado_total` es balance menos deposito, o sea el
       EXCEDENTE QUE AUN NO SE HA BARRIDO. Cada ~8,1 h el protocolo lo
       retira a la wallet y vuelve a cero, asi que esa division daba un
       diente de sierra, no una rentabilidad. Medido en D1 el 18-ago, seis
       horas seguidas: APR 0,217 → 0 → 0,029 → 0,061 → 0,09 → 0,119. El
       cero es el instante posterior al barrido.

       Es exactamente la misma trampa que la columna `snapshots.pls_hora`,
       documentada en val/compartido/ganancias.js. Lo ganado de verdad son
       los barridos acumulados mas el excedente, y los barridos solo los
       sabe la cadena — desde aqui no se ven.

    2. EL DENOMINADOR. `horas_activo` se calculaba con la activacion MAS
       ANTIGUA de todo el grupo. Mientras los once entraron juntos daba
       igual; en cuanto uno lleva once dias y otro unas horas, cualquier
       media que divida el total entre las horas del mas veterano queda
       diluida.

    Asi que se retiran. En su lugar, cada validador publica su propio
    `activacion_ts`, y el panel calcula el APR ponderando por
    validador-hora:

        APR = ganancia_real / Σ(deposito_i × horas_activas_i) × 8760 × 100

    Ese mismo dato es el que permite no marcar como «rezagado» a un
    validador que simplemente acaba de entrar.
    ─────────────────────────────────────────────────────────────────────
    """
    ids = ",".join(_pubkeys_locales())
    data = get_json(f"{BEACON}/eth/v1/beacon/states/head/validators?id={ids}")
    if not data:
        return None

    validadores = []
    total_balance = 0
    activos = 0
    slashed = 0
    activation_epoch_min = None

    for v in data["data"]:
        balance = int(v["balance"]) / 1e9          # gwei → PLS
        ganado = balance - STAKE_POR_VALIDADOR
        estado = v["status"]
        info = v["validator"]
        act_epoch = int(info["activation_epoch"])

        if estado.startswith("active"):
            activos += 1
        if info.get("slashed"):
            slashed += 1
        if activation_epoch_min is None or act_epoch < activation_epoch_min:
            activation_epoch_min = act_epoch

        total_balance += balance
        act_dt = epoch_a_fecha(act_epoch)
        validadores.append({
            "indice": int(v["index"]),
            "pubkey": info["pubkey"],
            "pubkey_corta": info["pubkey"][:8] + "…" + info["pubkey"][-6:],
            "estado": estado,
            "balance": round(balance, 4),
            "ganado": round(ganado, 4),
            "slashed": info.get("slashed", False),
            "activation_epoch": act_epoch,
            # Cada uno con SU activación, no la del grupo. Es lo que permite
            # calcular el APR por validador-hora y distinguir a un recién
            # activado de uno rezagado: ver el bloque de arriba.
            "activacion_ts": int(act_dt.timestamp()),
            "activacion_utc": act_dt.isoformat(),
            "horas_activo": round((datetime.now(timezone.utc) - act_dt).total_seconds() / 3600, 2),
        })

    stake_total = STAKE_POR_VALIDADOR * len(validadores)
    ganado_total = total_balance - stake_total

    activacion = epoch_a_fecha(activation_epoch_min)
    ahora = datetime.now(timezone.utc)
    horas_activo = (ahora - activacion).total_seconds() / 3600

    # `pls_hora` y `apr_pct` van a None A PROPOSITO. Ver el bloque de arriba:
    # desde aqui no se pueden calcular bien, y una cifra plausible pero falsa
    # es peor que un hueco. Las claves se mantienen para no romper a push.py,
    # que las escribe en la columna correspondiente de D1; None se guarda como
    # NULL, que es exactamente lo que son.
    pls_hora = None
    apr = None

    return {
        "total": len(validadores),
        "activos": activos,
        "slashed": slashed,
        "balance_total": round(total_balance, 4),
        "stake_total": stake_total,
        "ganado_total": round(ganado_total, 4),
        "activacion_utc": activacion.isoformat(),
        "horas_activo": round(horas_activo, 2),
        "pls_hora": pls_hora,
        "pls_dia": None,
        "apr_pct": apr,
        "detalle": validadores,
    }


# ----------------------------------------------------------------------
# Recolección: nodo
# ----------------------------------------------------------------------

def leer_nodo():
    # --- beacon ---
    syncing = get_json(f"{BEACON}/eth/v1/node/syncing")
    peers = get_json(f"{BEACON}/eth/v1/node/peer_count")
    version = get_json(f"{BEACON}/eth/v1/node/version")
    finality = get_json(f"{BEACON}/eth/v1/beacon/states/head/finality_checkpoints")

    sync_data = syncing.get("data", {}) if syncing else {}
    head_slot = int(sync_data.get("head_slot", 0))
    dist = int(sync_data.get("sync_distance", 0))
    is_syncing = sync_data.get("is_syncing", None)
    optimistic = sync_data.get("is_optimistic", None)

    peers_conectados = None
    if peers:
        try:
            peers_conectados = int(peers["data"]["connected"])
        except (KeyError, ValueError, TypeError):
            pass

    epoch_final = None
    if finality:
        try:
            epoch_final = int(finality["data"]["finalized"]["epoch"])
        except (KeyError, ValueError, TypeError):
            pass

    # --- prometheus: memoria ---
    mem_disp = prom_query("node_memory_MemAvailable_bytes")
    mem_total = prom_query("node_memory_MemTotal_bytes")

    # --- prometheus: disco raíz ---
    disco_libre = prom_query('node_filesystem_avail_bytes{mountpoint="/"}')
    disco_total = prom_query('node_filesystem_size_bytes{mountpoint="/"}')

    # --- prometheus: temperaturas ---
    temp_cpu = prom_query('node_hwmon_temp_celsius{chip=~"platform_coretemp.*",sensor="temp1"}')
    if temp_cpu is None:
        temp_cpu = prom_query("max(node_hwmon_temp_celsius)")
    temp_nvme = prom_query('node_hwmon_temp_celsius{chip=~"nvme.*",sensor="temp1"}')

    # --- prometheus: carga y uptime ---
    carga = prom_query("node_load1")
    cpus = prom_query('count(node_cpu_seconds_total{mode="idle"})')
    uptime_seg = prom_query("node_time_seconds - node_boot_time_seconds")

    gb = 1024 ** 3
    nodo = {
        "sincronizado": (is_syncing is False),
        "optimistic": optimistic,
        "head_slot": head_slot,
        "sync_distance": dist,
        "epoch_actual": head_slot // SLOTS_POR_EPOCH,
        "epoch_finalizada": epoch_final,
        "peers": peers_conectados,
        "version": (version or {}).get("data", {}).get("version"),
        "uptime_horas": round(uptime_seg / 3600, 1) if uptime_seg else None,
    }

    if mem_total:
        nodo["ram_total_gb"] = round(mem_total / gb, 1)
        nodo["ram_libre_gb"] = round(mem_disp / gb, 1) if mem_disp else None
        nodo["ram_usada_pct"] = round((1 - mem_disp / mem_total) * 100, 1) if mem_disp else None

    if disco_total:
        usado = disco_total - (disco_libre or 0)
        nodo["disco_total_gb"] = round(disco_total / gb, 1)
        nodo["disco_libre_gb"] = round(disco_libre / gb, 1) if disco_libre else None
        nodo["disco_usado_pct"] = round(usado / disco_total * 100, 1)

    if temp_cpu is not None:
        nodo["temp_cpu"] = round(temp_cpu, 1)
    if temp_nvme is not None:
        nodo["temp_nvme"] = round(temp_nvme, 1)
    if carga is not None:
        nodo["carga_1m"] = round(carga, 2)
        if cpus:
            nodo["carga_pct"] = round(carga / cpus * 100, 1)

    return nodo


# ----------------------------------------------------------------------
# Composición
# ----------------------------------------------------------------------

def recolectar():
    ahora = datetime.now(timezone.utc)
    vals = leer_validadores()
    nodo = leer_nodo()

    # Estado global de un vistazo
    if vals is None or nodo is None:
        salud = "sin_datos"
    elif vals["slashed"] > 0:
        salud = "critico"
    elif vals["activos"] < vals["total"]:
        salud = "aviso"
    elif not nodo.get("sincronizado"):
        salud = "aviso"
    elif (nodo.get("disco_usado_pct") or 0) > 85:
        salud = "aviso"
    else:
        salud = "ok"

    return {
        "version": 1,
        "generado": ahora.isoformat(),
        "generado_ts": int(ahora.timestamp()),
        "salud": salud,
        "validadores": vals,
        "nodo": nodo,
    }


def imprimir_resumen(d):
    v = d["validadores"]
    n = d["nodo"]
    iconos = {"ok": "OK", "aviso": "AVISO", "critico": "CRITICO", "sin_datos": "SIN DATOS"}

    print(f"\n  Estado: {iconos.get(d['salud'], d['salud'])}")
    print(f"  {d['generado'][:19].replace('T', ' ')} UTC")

    if v:
        print(f"\n  VALIDADORES")
        print(f"    Activos          {v['activos']}/{v['total']}")
        print(f"    En staking       {v['balance_total']:,.0f} PLS")
        print(f"    Ganado           {v['ganado_total']:,.2f} PLS")
        print(f"    Ritmo y APR      los calcula el panel (ver cabecera de leer_validadores)")
        print(f"    Primera alta     {v['activacion_utc'][:16].replace('T', ' ')} ({v['horas_activo']:.0f} h)")
        antiguedades = sorted({round(x["horas_activo"]) for x in v["detalle"]})
        if len(antiguedades) > 1:
            print(f"    Antigüedades     {antiguedades} h — NO son todos iguales")
        if v["slashed"]:
            print(f"    SLASHED          {v['slashed']}")

    if n:
        print(f"\n  NODO")
        print(f"    Sincronizado     {'sí' if n.get('sincronizado') else 'NO'}  ·  {n.get('peers')} peers")
        print(f"    Epoch            {n.get('epoch_actual')} (finalizada {n.get('epoch_finalizada')})")
        if "temp_cpu" in n:
            print(f"    Temp CPU         {n['temp_cpu']} °C")
        if "temp_nvme" in n:
            print(f"    Temp NVMe        {n['temp_nvme']} °C")
        if "ram_usada_pct" in n:
            print(f"    RAM              {n['ram_usada_pct']}% ({n.get('ram_libre_gb')} GB libres)")
        if "disco_usado_pct" in n:
            print(f"    Disco            {n['disco_usado_pct']}% ({n.get('disco_libre_gb')} GB libres)")
        if "carga_pct" in n:
            print(f"    Carga            {n['carga_pct']}%")
        if n.get("uptime_horas"):
            print(f"    Uptime           {n['uptime_horas']:.0f} h")

    if v and v.get("detalle"):
        print(f"\n  DETALLE")
        for x in v["detalle"]:
            marca = " " if x["estado"].startswith("active") else "!"
            print(f"   {marca} {x['indice']}  {x['pubkey_corta']}  {x['balance']:>14,.2f}  +{x['ganado']:>8,.2f}")
    print()


if __name__ == "__main__":
    datos = recolectar()

    if "--resumen" in sys.argv:
        imprimir_resumen(datos)
    elif "--pretty" in sys.argv:
        print(json.dumps(datos, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(datos, ensure_ascii=False))
