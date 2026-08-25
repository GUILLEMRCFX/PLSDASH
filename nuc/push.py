#!/usr/bin/env python3
"""
Envío a Cloudflare — Validator Dashboard

Lee el estado con collector.py y lo publica:
  · KV  → estado actual (cada ejecución, se sobrescribe)
  · D1  → snapshot horario + cierre diario + eventos

Configuración en ~/.validator-dashboard.env

Uso:
    python3 push.py            # ejecución normal
    python3 push.py --dry      # muestra qué haría, sin escribir
    python3 push.py --verbose  # detalle de cada paso
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

import collector
from precio_y_bloques import precio_pls

CF_API = "https://api.cloudflare.com/client/v4"
ENV_FILE = Path.home() / ".validator-dashboard.env"
ESTADO_LOCAL = Path.home() / ".validator-dashboard-estado.json"

KV_CLAVE_ESTADO = "validator:estado"

DRY = "--dry" in sys.argv
VERBOSE = "--verbose" in sys.argv or DRY


def log(msg):
    if VERBOSE:
        print(f"  {msg}")


# ----------------------------------------------------------------------
# Configuración
# ----------------------------------------------------------------------

def cargar_env():
    if not ENV_FILE.exists():
        print(f"ERROR: no existe {ENV_FILE}", file=sys.stderr)
        sys.exit(1)

    cfg = {}
    for linea in ENV_FILE.read_text().splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        k, v = linea.split("=", 1)
        cfg[k.strip()] = v.strip()

    # `PROM_UP` es opcional: acota que objetivos cuentan como «el nodo esta
    # arriba». Sin el, valen todos y manda el peor.
    global SELECTOR_UP
    if cfg.get("PROM_UP"):
        SELECTOR_UP = cfg["PROM_UP"]

    faltan = [k for k in ("CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_KV_NAMESPACE", "CF_D1_DATABASE")
              if not cfg.get(k)]
    if faltan:
        print(f"ERROR: faltan variables en {ENV_FILE}: {', '.join(faltan)}", file=sys.stderr)
        sys.exit(1)

    return cfg


# ----------------------------------------------------------------------
# Cliente Cloudflare
# ----------------------------------------------------------------------

def cf_request(url, cfg, data=None, method="GET", content_type="application/json"):
    headers = {"Authorization": f"Bearer {cfg['CF_API_TOKEN']}"}
    cuerpo = None

    if data is not None:
        headers["Content-Type"] = content_type
        cuerpo = data.encode() if isinstance(data, str) else json.dumps(data).encode()

    req = urllib.request.Request(url, data=cuerpo, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detalle = e.read().decode()[:300]
        print(f"ERROR HTTP {e.code}: {detalle}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"ERROR de red: {e}", file=sys.stderr)
        return None


def kv_put(cfg, clave, valor):
    url = (f"{CF_API}/accounts/{cfg['CF_ACCOUNT_ID']}/storage/kv/"
           f"namespaces/{cfg['CF_KV_NAMESPACE']}/values/{clave}")
    if DRY:
        log(f"[dry] KV PUT {clave} ({len(valor)} bytes)")
        return True
    r = cf_request(url, cfg, data=valor, method="PUT", content_type="text/plain")
    return bool(r and r.get("success"))


def d1_query(cfg, sql, params=None):
    url = f"{CF_API}/accounts/{cfg['CF_ACCOUNT_ID']}/d1/database/{cfg['CF_D1_DATABASE']}/query"
    payload = {"sql": sql}
    if params:
        payload["params"] = [str(p) if p is not None else None for p in params]

    if DRY:
        log(f"[dry] D1: {sql[:70]}…")
        return {"success": True, "result": [{"results": []}]}

    return cf_request(url, cfg, data=payload, method="POST")


def d1_filas(respuesta):
    try:
        return respuesta["result"][0]["results"]
    except (KeyError, IndexError, TypeError):
        return []


# ----------------------------------------------------------------------
# Estado local (para detectar cambios entre ejecuciones)
# ----------------------------------------------------------------------

def leer_estado_local():
    if ESTADO_LOCAL.exists():
        try:
            return json.loads(ESTADO_LOCAL.read_text())
        except json.JSONDecodeError:
            pass
    return {}


def guardar_estado_local(estado):
    if not DRY:
        ESTADO_LOCAL.write_text(json.dumps(estado))
        os.chmod(ESTADO_LOCAL, 0o600)


# ----------------------------------------------------------------------
# Detección de eventos
# ----------------------------------------------------------------------

def detectar_eventos(datos, previo):
    """Compara con la ejecución anterior y devuelve eventos nuevos."""
    eventos = []
    ahora = datos["generado_ts"]
    v = datos.get("validadores") or {}
    n = datos.get("nodo") or {}

    activos = v.get("activos")
    activos_prev = previo.get("activos")

    # Validadores que dejan de estar activos
    if activos is not None and activos_prev is not None and activos < activos_prev:
        eventos.append((ahora, "caida",
                        f"{activos_prev - activos} validador(es) inactivo(s)",
                        f"Activos: {activos} de {v.get('total')}", None, None))

    # Recuperación
    if activos is not None and activos_prev is not None and activos > activos_prev:
        eventos.append((ahora, "recuperacion",
                        "Validadores recuperados",
                        f"Activos: {activos} de {v.get('total')}", None, None))

    # Slashing (crítico)
    slashed = v.get("slashed", 0)
    if slashed and slashed > previo.get("slashed", 0):
        eventos.append((ahora, "slash", "SLASHING DETECTADO",
                        f"{slashed} validador(es) penalizado(s)", None, None))

    # Nodo reiniciado (uptime bajó)
    up = n.get("uptime_horas")
    up_prev = previo.get("uptime_horas")
    if up is not None and up_prev is not None and up < up_prev:
        eventos.append((ahora, "reinicio", "Nodo reiniciado",
                        f"Uptime reiniciado a {up:.1f} h", None, None))

    # Pérdida de sincronización
    sync = n.get("sincronizado")
    sync_prev = previo.get("sincronizado")
    if sync is False and sync_prev is True:
        eventos.append((ahora, "desync", "Nodo desincronizado", None, None, None))
    if sync is True and sync_prev is False:
        eventos.append((ahora, "resync", "Nodo sincronizado de nuevo", None, None, None))

    # Disco alto (solo al cruzar el umbral)
    disco = n.get("disco_usado_pct")
    disco_prev = previo.get("disco_usado_pct")
    if disco and disco_prev and disco > 85 >= disco_prev:
        eventos.append((ahora, "aviso", "Disco por encima del 85%",
                        f"{disco}% usado · {n.get('disco_libre_gb')} GB libres", None, None))

    return eventos


# ----------------------------------------------------------------------
# Disponibilidad real
# ----------------------------------------------------------------------

# Que se considera «caido». Por omision, TODOS los objetivos que raspa
# Prometheus, quedandose con el peor: si cualquiera de ellos estuvo abajo, el
# nodo no estaba entero. Se puede acotar desde el .env, por ejemplo:
#   PROM_UP=up{job=~"node|lighthouse"}
SELECTOR_UP = "up"


def minutos_caidos(fecha, selector=None):
    """Minutos que el nodo estuvo caido en un dia (UTC), medidos.

    `avg_over_time(up[24h])` es la fraccion de raspados que respondieron. Se
    evalua al FINAL del dia que se cierra —no «ahora»— para que la ventana de
    24 h sea exactamente ese dia. Con `min()` manda el peor objetivo.

    ⚠ Lo que esto mide es «el exportador no respondia», que es la mejor senal
      que hay en esta maquina: Prometheus solo tiene metricas de node_exporter
      y del beacon, no de atestaciones. Un validador que atestigua mal con la
      maquina encendida NO sale aqui.

    ⚠ Y un punto ciego que conviene tener escrito: si el que estuvo caido fue
      **Prometheus**, en esa ventana no hay muestras y la media sale de las que
      si existen, o sea ~1. Su propia caida es invisible para el.

    Devuelve None si no se puede medir. None NO es cero: quien llame debe
    conservar lo que hubiera en vez de escribir «no hubo caidas».
    """
    try:
        dia = datetime.strptime(fecha, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None

    fin = dia + timedelta(days=1)
    if fin > datetime.now(timezone.utc):
        return None                      # el dia no ha terminado: aun no se mide

    sel = selector or SELECTOR_UP
    v = collector.prom_query(f"min(avg_over_time({sel}[24h]))", momento=fin.timestamp())
    if v is None:
        return None

    v = max(0.0, min(1.0, v))            # por si acaso: es una fraccion
    return int(round((1.0 - v) * 1440))


# ----------------------------------------------------------------------
# Escrituras
# ----------------------------------------------------------------------

def publicar_kv(cfg, datos):
    ok = kv_put(cfg, KV_CLAVE_ESTADO, json.dumps(datos, ensure_ascii=False))
    log("KV estado " + ("publicado" if ok else "FALLÓ"))
    return ok


def guardar_snapshot(cfg, datos):
    v = datos.get("validadores") or {}
    n = datos.get("nodo") or {}

    sql = """INSERT OR REPLACE INTO snapshots
        (ts, ganado, balance_total, activos, pls_hora, apr, disco_pct, disco_libre_gb,
         temp_cpu, temp_nvme, ram_pct, peers, sincronizado, epoch, salud, precio_pls)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""

    params = [
        datos["generado_ts"],
        v.get("ganado_total"), v.get("balance_total"), v.get("activos"),
        v.get("pls_hora"), v.get("apr_pct"),
        n.get("disco_usado_pct"), n.get("disco_libre_gb"),
        n.get("temp_cpu"), n.get("temp_nvme"), n.get("ram_usada_pct"),
        n.get("peers"), 1 if n.get("sincronizado") else 0,
        n.get("epoch_actual"), datos.get("salud"),
        precio_pls()
    ]

    r = d1_query(cfg, sql, params)
    ok = bool(r and r.get("success"))
    log("Snapshot horario " + ("guardado" if ok else "FALLÓ"))
    return ok


def guardar_eventos(cfg, eventos):
    for ev in eventos:
        sql = ("INSERT INTO eventos (ts, tipo, titulo, detalle, pls, validador) "
               "VALUES (?,?,?,?,?,?)")
        r = d1_query(cfg, sql, list(ev))
        if r and r.get("success"):
            log(f"Evento registrado: {ev[2]}")
        else:
            log(f"Evento FALLÓ: {ev[2]}")


def cerrar_dia(cfg, datos, fecha):
    """Cierra el día anterior calculando lo ganado en esa jornada."""
    v = datos.get("validadores") or {}
    n = datos.get("nodo") or {}
    ganado_acum = v.get("ganado_total") or 0

    # Lo ganado ayer = acumulado de hoy menos acumulado del cierre anterior
    r = d1_query(cfg, "SELECT ganado_acum FROM daily ORDER BY fecha DESC LIMIT 1")
    filas = d1_filas(r)
    anterior = filas[0]["ganado_acum"] if filas else 0
    ganado_dia = max(0, ganado_acum - (anterior or 0))

    # `apr_medio` y `bloques` se han borrado de la tabla:
    #   · apr_medio guardaba valores que no eran un APR de nada (0,056 … 1,484
    #     con el APR real en el 9,5 %) y no lo leia ningun panel.
    #   · bloques nunca se relleno: sumaba 0 en las 15 filas. Los bloques de
    #     verdad estan marcados uno a uno en `barridos.es_bloque`.
    #
    # `minutos_caido` YA NO se arrastra con COALESCE: se mide (ver abajo).
    sql = """INSERT OR REPLACE INTO daily
        (fecha, ganado_dia, ganado_acum, salud, disco_pct, minutos_caido)
        VALUES (?,?,?,?,?,?)"""

    caidos = minutos_caidos(fecha)
    if caidos is None:
        # Prometheus no contesta o no cubre ese dia: se conserva lo que hubiera
        # en vez de escribir un cero, que se leeria como «no hubo caidas».
        r = d1_query(cfg, "SELECT minutos_caido FROM daily WHERE fecha=?", [fecha])
        filas = d1_filas(r)
        caidos = (filas[0]["minutos_caido"] if filas else 0) or 0
        log(f"  minutos_caido: sin medida, se conserva {caidos}")
    else:
        log(f"  minutos_caido: {caidos} min medidos")

    params = [fecha, ganado_dia, ganado_acum,
              datos.get("salud"), n.get("disco_usado_pct"), caidos]

    r = d1_query(cfg, sql, params)
    ok = bool(r and r.get("success"))
    log(f"Cierre diario {fecha} " + ("guardado" if ok else "FALLÓ"))
    return ok


# ----------------------------------------------------------------------
# Principal
# ----------------------------------------------------------------------

def main():
    cfg = cargar_env()
    datos = collector.recolectar()

    if datos.get("salud") == "sin_datos":
        print("ERROR: el recolector no obtuvo datos. No se publica nada.", file=sys.stderr)
        sys.exit(2)

    previo = leer_estado_local()
    ahora = datetime.now(timezone.utc)
    hoy = ahora.strftime("%Y-%m-%d")
    hora_actual = ahora.strftime("%Y-%m-%dT%H")

    v = datos.get("validadores") or {}
    n = datos.get("nodo") or {}

    # 1 · Estado actual → KV (siempre)
    publicar_kv(cfg, datos)

    # 2 · Eventos nuevos → D1
    eventos = detectar_eventos(datos, previo)
    if eventos:
        guardar_eventos(cfg, eventos)
    else:
        log("Sin eventos nuevos")

    # 3 · Snapshot horario → D1 (una vez por hora)
    if previo.get("ultima_hora") != hora_actual:
        guardar_snapshot(cfg, datos)
        nueva_hora = hora_actual
    else:
        log("Snapshot horario ya guardado esta hora")
        nueva_hora = previo.get("ultima_hora")

    # 4 · Cierre diario → D1 (una vez al día)
    if previo.get("ultimo_dia") != hoy:
        if previo.get("ultimo_dia"):
            cerrar_dia(cfg, datos, previo["ultimo_dia"])
        # `guardar_validadores_dia()` escribia `validador_diario`, una tabla de
        # 165 filas que solo leia `/api/val/validadores`, un endpoint que no
        # llamaba nadie. Los dos se han retirado; el detalle por validador ya
        # esta en el estado de KV, que es lo que pintan los paneles.
        nuevo_dia = hoy
    else:
        log("Cierre diario ya hecho hoy")
        nuevo_dia = previo.get("ultimo_dia")

    # 5 · Guardar estado para la próxima comparación
    guardar_estado_local({
        "ts": datos["generado_ts"],
        "activos": v.get("activos"),
        "slashed": v.get("slashed", 0),
        "ganado": v.get("ganado_total"),
        "uptime_horas": n.get("uptime_horas"),
        "sincronizado": n.get("sincronizado"),
        "disco_usado_pct": n.get("disco_usado_pct"),
        "ultima_hora": nueva_hora,
        "ultimo_dia": nuevo_dia,
    })

    marca = "[dry] " if DRY else ""
    print(f"{marca}OK · {v.get('activos')}/{v.get('total')} activos · "
          f"{v.get('ganado_total'):,.0f} PLS · salud {datos.get('salud')}")


if __name__ == "__main__":
    main()
