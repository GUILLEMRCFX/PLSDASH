"""
PLSDASH — validación de la tubería de datos (NUC).

El 8-ago-2026 a las 19:00:01 el recolector escribió este snapshot:

    ganado=0, balance_total=320000000, pls_hora=0, apr=0
    activos=10, peers=71, sincronizado=1, salud="ok"

Imposible: los validadores llevaban dos días acumulando. `balance_total` era
320.000.000 clavado, que es exactamente 32.000.000 x 10 — el `effective_balance`
de los diez, no su balance real. Lighthouse devolvió el campo equivocado (o un
estado transitorio en el cambio de epoch) y la tubería lo escribió sin
rechistar, porque no validaba nada.

Un panel de monitorización que muestra datos imposibles es peor que uno que no
muestra nada: el segundo se nota, el primero se cree. Este módulo pone dos
barreras:

  * `validar(estado)`   — en collector.py, antes de devolver el estado.
  * `admisible(...)`    — en push.py, antes de escribir en D1.

Ver INTEGRACION.md para los puntos de enganche.
"""

# Stake por validador. Un balance exactamente igual a este es la firma del
# bug de `effective_balance`: el balance real casi nunca cae en el entero.
STAKE_POR_VALIDADOR = 32_000_000

# Margen antes de exigir recompensas. Recién activado un validador puede tener
# ganado 0 de forma legítima durante los primeros minutos.
HORAS_MINIMAS = 1.0


def validar(estado):
    """Comprueba que el estado es físicamente posible.

    Devuelve la lista de motivos por los que no lo es. Lista vacía = correcto.
    No lanza excepciones: el recolector debe poder registrar el motivo y
    seguir vivo hasta la próxima pasada.
    """
    motivos = []

    v = (estado or {}).get("validadores") or {}
    detalle = v.get("detalle") or []

    activos = v.get("activos") or 0
    horas = float(v.get("horas_activo") or 0)
    ganado_total = v.get("ganado_total")
    balance_total = v.get("balance_total")
    stake_total = v.get("stake_total") or 0

    # Sin validadores activos no hay nada que exigir: puede ser una salida
    # legítima (todos salidos) o el nodo aún sincronizando.
    if activos <= 0:
        return motivos

    en_marcha = [d for d in detalle if d.get("estado") == "active_ongoing"]
    if not en_marcha or horas < HORAS_MINIMAS:
        return motivos

    # --- a partir de aquí: hay validadores activos y llevan horas ---

    if ganado_total is None:
        motivos.append("ganado_total ausente")
    elif ganado_total <= 0:
        motivos.append(
            f"ganado_total = {ganado_total} con {len(en_marcha)} validadores "
            f"activos desde hace {horas:.1f} h"
        )

    if balance_total is not None and stake_total and balance_total == stake_total:
        motivos.append(
            f"balance_total = stake_total exacto ({stake_total}): "
            "parece effective_balance, no el balance real"
        )

    # La misma firma, validador a validador: pilla el caso en que solo algunos
    # vengan con el campo equivocado y el total no cuadre redondo.
    exactos = [
        d.get("indice") for d in en_marcha
        if d.get("balance") == STAKE_POR_VALIDADOR
    ]
    if exactos:
        motivos.append(
            f"balance exactamente igual al stake en {len(exactos)} validadores "
            f"({', '.join(str(i) for i in exactos[:5])}"
            f"{'…' if len(exactos) > 5 else ''})"
        )

    # Coherencia interna: si el total no es la suma del detalle, uno de los dos
    # está mal y no sabemos cuál. Se tolera un céntimo de PLS por redondeos.
    sumado = sum(d.get("ganado") or 0 for d in detalle)
    if ganado_total is not None and detalle and abs(sumado - ganado_total) > 0.01:
        motivos.append(
            f"ganado_total ({ganado_total}) no cuadra con la suma del detalle ({sumado})"
        )

    return motivos


def marcar_sin_datos(estado, motivos):
    """Marca el estado como no fiable, dejando por escrito el porqué.

    Se conserva el resto del contenido para poder inspeccionarlo en el log,
    pero `salud = "sin_datos"` es la señal de que no debe escribirse.
    """
    estado["salud"] = "sin_datos"
    estado["motivos_descarte"] = motivos
    return estado


def admisible(ultimo_ganado, ganado, slashed=0):
    """¿Es admisible escribir este `ganado` en D1?

    Las recompensas acumuladas solo suben. Una bajada real solo puede venir de
    una penalización, y una penalización de verdad también mueve el campo
    `slashed`: si baja sin que nadie esté penalizado, el dato está mal.

    Devuelve (True, None) o (False, motivo).
    """
    if ganado is None:
        return False, "ganado ausente"

    if ultimo_ganado is None:
        return True, None  # primera fila, no hay contra qué comparar

    if ganado >= ultimo_ganado:
        return True, None

    if slashed and slashed > 0:
        return True, None  # bajada explicada por una penalización real

    return False, (
        f"ganado bajaría de {ultimo_ganado} a {ganado} sin validadores "
        "penalizados; las recompensas acumuladas solo suben"
    )


def ultimo_ganado_conocido(d1):
    """Último `ganado` bueno registrado en D1, o None si la tabla está vacía."""
    filas = d1(
        "SELECT ganado FROM snapshots WHERE ganado IS NOT NULL "
        "ORDER BY ts DESC LIMIT 1"
    )
    return float(filas[0]["ganado"]) if filas else None
