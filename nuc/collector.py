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


def _corta(pubkey):
    """`0x8f3a…b12c9d` — la pubkey como se puede leer de un vistazo."""
    return pubkey[:8] + "…" + pubkey[-6:]

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


def prom_query(query, momento=None):
    """Consulta Prometheus y devuelve el primer valor como float, o None.

    `momento` es un unix ts opcional: sin el, Prometheus evalua «ahora». Se
    anadio para poder cerrar un dia consultando el final de ESE dia y no el
    instante en que se ejecuta el cierre, que puede ser horas despues.
    """
    url = f"{PROM}/api/v1/query?query={urllib.parse.quote(query)}"
    if momento is not None:
        url += f"&time={int(momento)}"
    data = get_json(url)
    try:
        result = data["data"]["result"]
        if not result:
            return None
        return float(result[0]["value"][1])
    except (KeyError, IndexError, TypeError, ValueError):
        return None


# La beacon API devuelve FAR_FUTURE_EPOCH (2^64-1) en `activation_epoch`
# mientras un validador esta depositado pero aun sin turno en la cola.
FAR_FUTURE_EPOCH = 2 ** 64 - 1


def epoch_a_fecha(epoch):
    """Epoch → fecha UTC, o None si esa epoch no es una fecha de verdad.

    ⚠ DEVOLVER None NO ES UNA CORTESIA: es lo que impide que el recolector
      MUERA el dia que deposites un validador nuevo.

      Un validador en cola trae `activation_epoch = 2^64-1`. Con eso,
      GENESIS + epoch*320 se sale del rango de `time_t` y
      `datetime.fromtimestamp` lanza OverflowError. Como `leer_validadores()`
      no envuelve el bucle, la excepcion sube hasta `recolectar()` y el
      recolector no publica NADA: a los 15 minutos el panel se pone DESFASADO
      y se queda asi las 12-18 horas que dura la cola. Justo lo contrario de
      lo que hay que enseñar cuando amplias.

      Comprobado: epoch 320041 → 2026-08-08; epoch 2^64-1 → OverflowError.
    """
    if not isinstance(epoch, int) or epoch < 0 or epoch >= FAR_FUTURE_EPOCH:
        return None
    ts = GENESIS_TIME + epoch * SLOTS_POR_EPOCH * SEGUNDOS_POR_SLOT
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        # Cualquier epoch absurda que no sea exactamente la del futuro lejano.
        return None


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
    TRES ESTADOS, NO DOS

    Esta funcion pregunta a la beacon API POR PUBKEY. Mientras la cadena no
    ha adoptado un deposito, esa pubkey NO VIENE EN LA RESPUESTA: el
    endpoint devuelve los que conoce y omite los demas, sin error. Hasta el
    10-sep-2026 el validador nuevo desaparecia ahi, en silencio, y el panel
    no tenia nada que enseñar durante las 12-18 h que tarda la adopcion.

    Pero el dato SI existe, y esta en el disco de esta misma maquina: los
    keystores. Si hay doce claves y la cadena devuelve once, la que falta es
    la que espera. Es la misma cuenta que hace Lighthouse cuando dice
    `total_validators: 12, active_validators: 11`.

    Asi que se publican tres estados:

      · esperando  — clave en el disco, la cadena no la conoce todavia.
      · pendiente  — la cadena la conoce y no le ha dado turno (`pending_*`).
      · activo     — validando.

    ⚠ LO QUE NO SE HACE: mover el dinero. Una clave en el disco NO demuestra
      que se haya depositado — se generan antes de depositar—, asi que
      `stake_total`, `balance_total` y `ganado_total` siguen contando SOLO lo
      que la cadena confirma. De ahi que el estado se llame «esperando
      deposito o procesamiento»: desde aqui las dos cosas se ven igual, y
      sumar 32M por una clave recien generada seria inventarse un ingreso.

      La consecuencia buena de esa decision: `deposito = stake_total / total`
      sigue dando 32M exactos, que es de donde salen el objetivo del panel y
      el aviso de «ya tienes para uno entero».
    ─────────────────────────────────────────────────────────────────────
    """
    locales = _pubkeys_locales()
    ids = ",".join(locales)
    data = get_json(f"{BEACON}/eth/v1/beacon/states/head/validators?id={ids}")
    if not data:
        return None

    validadores = []
    total_balance = 0
    activos = 0
    pendientes = 0
    slashed = 0
    activation_epoch_min = None
    en_cadena = set()

    ahora_utc = datetime.now(timezone.utc)

    for v in data["data"]:
        balance = int(v["balance"]) / 1e9          # gwei → PLS
        ganado = balance - STAKE_POR_VALIDADOR
        estado = v["status"]
        info = v["validator"]
        act_epoch = int(info["activation_epoch"])
        act_dt = epoch_a_fecha(act_epoch)

        # ⚠ PENDIENTE NO ES CAIDO, y esta es la linea que lo separa.
        #   `pending_initialized` y `pending_queued` son un validador
        #   depositado esperando turno: 12-18 h en las que no valida, no gana y
        #   NO PASA NADA. Un `exited_*` o un `active_exiting` si son otra cosa.
        pendiente = estado.startswith("pending")

        if estado.startswith("active"):
            activos += 1
        if pendiente:
            pendientes += 1
        if info.get("slashed"):
            slashed += 1
        # Solo cuentan las activaciones REALES para el arranque del grupo: la
        # de un pendiente es None y no puede ser el minimo de nada.
        if act_dt is not None and (activation_epoch_min is None or act_epoch < activation_epoch_min):
            activation_epoch_min = act_epoch

        total_balance += balance
        en_cadena.add(str(info["pubkey"]).lower())
        validadores.append({
            "indice": int(v["index"]),
            "pubkey": info["pubkey"],
            "pubkey_corta": _corta(info["pubkey"]),
            "estado": estado,
            "pendiente": pendiente,
            # En la cadena, aunque sin turno. Ver el bloque de los tres estados.
            "esperando": False,
            "balance": round(balance, 4),
            "ganado": round(ganado, 4),
            "slashed": info.get("slashed", False),
            # `None` cuando aun no tiene turno asignado. Se publica igual: que
            # el panel sepa que el dato NO EXISTE es distinto de no mandarlo.
            "activation_epoch": None if act_dt is None else act_epoch,
            # Cada uno con SU activación, no la del grupo. Es lo que permite
            # calcular el APR por validador-hora y distinguir a un recién
            # activado de uno rezagado: ver el bloque de arriba.
            "activacion_ts": None if act_dt is None else int(act_dt.timestamp()),
            "activacion_utc": None if act_dt is None else act_dt.isoformat(),
            "horas_activo": None if act_dt is None
                            else round((ahora_utc - act_dt).total_seconds() / 3600, 2),
            # Desde cuando espera. La API no da el instante del deposito, asi
            # que se cuenta desde que este recolector lo vio por primera vez;
            # `push.py` lo fija al escribir el evento de deposito.
            "en_cola_desde_ts": None,
        })

    # ── Los que tienen clave aqui y la cadena aun no conoce ──────────────
    #
    # No se descartan: se publican por lo que son. Sin indice —la cadena no
    # se lo ha dado todavia— y sin balance, porque desde aqui no se puede
    # saber si el deposito esta hecho. Lo que si se sabe con certeza es que
    # la clave existe, y eso es lo que se enseña.
    en_cadena_total = len(validadores)
    esperando = []
    for pk in locales:
        if pk.lower() in en_cadena:
            continue
        esperando.append({
            "indice": None,
            "pubkey": pk,
            "pubkey_corta": _corta(pk),
            "estado": "esperando",
            # `pendiente` es el paraguas —«aun no valida, y eso no es un
            # fallo»— y `esperando` la distincion fina. El panel usa el
            # primero para no marcarlo en rojo y el segundo para decir por
            # que espera.
            "pendiente": True,
            "esperando": True,
            "balance": None,
            "ganado": None,
            "slashed": False,
            "activation_epoch": None,
            "activacion_ts": None,
            "activacion_utc": None,
            "horas_activo": None,
            # Desde cuando espera. Lo fija `push.py`, que es quien recuerda
            # entre ejecuciones cuando vio esta pubkey por primera vez.
            "en_cola_desde_ts": None,
        })
    validadores.extend(esperando)

    # ⚠ SOBRE `en_cadena_total` Y NO `len(validadores)`: el dinero cuenta solo
    #   lo que la cadena confirma. Si aqui entrara el que espera, `stake_total`
    #   subiria 32M sin que nadie los haya depositado necesariamente, y peor:
    #   `ganado_total = balance_total - stake_total` se iria 32M por debajo,
    #   envenenando el APR, el reparto del saldo y el titular. Ver el bloque de
    #   los tres estados en la cabecera.
    stake_total = STAKE_POR_VALIDADOR * en_cadena_total
    ganado_total = total_balance - stake_total

    # Puede no haber NINGUNA activacion real: los primeros minutos tras el
    # primer deposito de todos. Entonces no hay grupo del que medir horas.
    activacion = epoch_a_fecha(activation_epoch_min) if activation_epoch_min is not None else None
    horas_activo = None if activacion is None \
        else (ahora_utc - activacion).total_seconds() / 3600

    # `pls_hora` y `apr_pct` van a None A PROPOSITO. Ver el bloque de arriba:
    # desde aqui no se pueden calcular bien, y una cifra plausible pero falsa
    # es peor que un hueco. Las claves se mantienen para no romper a push.py,
    # que las escribe en la columna correspondiente de D1; None se guarda como
    # NULL, que es exactamente lo que son.
    pls_hora = None
    apr = None

    return {
        # Los que la cadena conoce. `deposito = stake_total / total` depende de
        # que estos dos vayan del mismo conjunto.
        "total": en_cadena_total,
        "activos": activos,
        # Depositados y esperando turno. Se publica aparte para que el panel
        # pueda decir «1 en cola» en vez de «1 fuera de servicio».
        "pendientes": pendientes,
        # Con clave en el disco y sin respuesta de la cadena.
        "esperando": len(esperando),
        # Lo que dice Lighthouse en sus logs: `total_validators`. Es el numero
        # de claves que hay, lo sepa la cadena o no.
        "claves": en_cadena_total + len(esperando),
        "slashed": slashed,
        "balance_total": round(total_balance, 4),
        "stake_total": stake_total,
        "ganado_total": round(ganado_total, 4),
        "activacion_utc": None if activacion is None else activacion.isoformat(),
        "horas_activo": None if horas_activo is None else round(horas_activo, 2),
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

def salud_de(vals, nodo):
    """Estado global en una palabra. Fuera de `recolectar()` a proposito: asi
    se puede probar con numeros a mano sin pedirle nada a la red, y la prueba
    llama a ESTA funcion en vez de a una copia suya que se quedaria vieja.

    ⚠ UN PENDIENTE NO ES UN AVISO. La regla era `activos < total`, y con ella
      el panel decia que algo iba mal durante las 12-18 h que un validador
      recien depositado pasa en la cola de activacion. No va mal: es lo que
      pasa cuando amplias, y es justo el dia que mas se mira el panel. Lo que
      si es un aviso son los que faltan por CUALQUIER OTRO motivo.

      Los que estan ESPERANDO —clave en disco, la cadena no los conoce— no
      entran en esta cuenta por construccion: `total` solo cuenta lo que la
      cadena devuelve, asi que no pueden restar de nada.
    """
    if vals is None or nodo is None:
        return "sin_datos"
    if vals.get("slashed", 0) > 0:
        return "critico"
    if vals["activos"] < vals["total"] - vals.get("pendientes", 0):
        return "aviso"
    if not nodo.get("sincronizado"):
        return "aviso"
    if (nodo.get("disco_usado_pct") or 0) > 85:
        return "aviso"
    return "ok"


def recolectar():
    ahora = datetime.now(timezone.utc)
    vals = leer_validadores()
    nodo = leer_nodo()

    salud = salud_de(vals, nodo)

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
        print(f"    Activos          {v['activos']}/{v['total']}"
              + (f"  ({v['claves']} claves en disco)" if v.get("esperando") else ""))
        if v.get("pendientes"):
            print(f"    En cola          {v['pendientes']} — depositado, esperando turno")
        if v.get("esperando"):
            print(f"    Esperando        {v['esperando']} — clave en disco, la cadena no la conoce")
        print(f"    En staking       {v['balance_total']:,.0f} PLS")
        print(f"    Ganado           {v['ganado_total']:,.2f} PLS")
        print(f"    Ritmo y APR      los calcula el panel (ver cabecera de leer_validadores)")
        # ⚠ Los dos `None` de aqui abajo son reales, no defensivos: el que
        #   espera no tiene fecha de alta, y el dia del primer deposito de
        #   todos NADIE la tiene. Sin estos guardas, `--resumen` revienta
        #   justo el dia que se usa.
        if v.get("activacion_utc"):
            print(f"    Primera alta     {v['activacion_utc'][:16].replace('T', ' ')} ({v['horas_activo']:.0f} h)")
        else:
            print(f"    Primera alta     ninguna todavia")
        antiguedades = sorted({round(x["horas_activo"]) for x in v["detalle"]
                               if x.get("horas_activo") is not None})
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
            if x.get("esperando"):
                print(f"   · {'—':>9}  {x['pubkey_corta']}  {'esperando a entrar en la cadena':>30}")
                continue
            marca = " " if x["estado"].startswith("active") else "!"
            bal = "sin dato" if x["balance"] is None else f"{x['balance']:,.2f}"
            gan = "" if x["ganado"] is None else f"  +{x['ganado']:>8,.2f}"
            print(f"   {marca} {x['indice']}  {x['pubkey_corta']}  {bal:>14}{gan}")
    print()


if __name__ == "__main__":
    datos = recolectar()

    if "--resumen" in sys.argv:
        imprimir_resumen(datos)
    elif "--pretty" in sys.argv:
        print(json.dumps(datos, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(datos, ensure_ascii=False))
