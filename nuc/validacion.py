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

Una hora después volvió a pasar, con otra forma:

    20:00:02 → ganado=3154.79, bajando desde 26768.47

Esta vez el balance no era el stake redondo (320003154.79), ningún validador
estaba en 32M clavado y el total cuadraba con el detalle. **Ninguno de los
criterios de forma la habría cazado.** Solo la monotonía.

De ahí la lección que ordena este módulo: las comprobaciones de forma detectan
una firma concreta y se quedan cortas en cuanto el fallo cambia de cara. La
barrera que de verdad aguanta es la de continuidad — comparar cada lectura con
lo que ya se sabe. El nodo estaba sano en ambos momentos (67 peers,
sincronizado, epochs avanzando, 45 °C): es la API de Lighthouse devolviendo
balances incoherentes de forma intermitente.

Barreras, de más a menos fiable:

  * `revisar_snapshot(...)` — en push.py. Continuidad: ni bajadas sin
    penalización ni subidas fuera de todo ritmo plausible.
  * `lectura_estable(...)`  — en collector.py. Lee dos veces y desconfía si
    las dos lecturas no coinciden.
  * `validar(estado)`       — en collector.py. Formas imposibles conocidas.

Y `registrar_descarte(...)` deja constancia en `eventos` de cada rechazo, para
que el panel pueda distinguir «el NUC está caído» de «el NUC está bien pero sus
datos no se admiten».

Ver INTEGRACION.md para los puntos de enganche.
"""

import time

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

    # `ganado_total` a cero tampoco se rechaza: es el valor correcto en el
    # instante posterior a un barrido, antes de que la siguiente epoch acredite
    # nada. Solo un valor negativo es imposible.
    if ganado_total is None:
        motivos.append("ganado_total ausente")
    elif ganado_total < 0:
        motivos.append(f"ganado_total negativo ({ganado_total})")

    # NO se comprueba «balance_total == stake_total exacto». Se creyó que era
    # la firma de haber leído effective_balance, y es justo lo que deja una
    # retirada parcial: el protocolo barre el excedente y el balance queda en
    # el stake clavado hasta la siguiente epoch. Rechazarlo tiraría la primera
    # lectura buena después de cada barrido.

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


# --------------------------------------------------------------------------
# Continuidad: la barrera que de verdad aguanta
# --------------------------------------------------------------------------

# Cuántas subidas hacia atrás se miran para saber cuál es el ritmo normal.
VENTANA_REFERENCIA = 12

# Tope de subida, en múltiplos del ritmo típico.
#
# El 8-ago la propuesta de bloque de las 18:00 fue de 8.607 PLS/h contra una
# mediana de 2.959: exactamente 2,91x. Un umbral de 3x —el primero que se
# propuso— la habría rechazado por un margen del 3%, tirando un dato real y
# justo el más valioso del registro. Dos bloques en la misma hora rondarían
# las 5x, así que el listón se pone en 8x: sigue cortando de sobra saltos
# como el de las 20:00 (que fue una bajada, y de las de 4x hacia arriba no se
# conoce ninguna causa legítima) sin poner en riesgo nada verdadero.
FACTOR_MAX_SUBIDA = 8.0

# Silencio entre avisos de descarte, para que un fallo continuado de la API no
# llene el registro de vida con una entrada cada tres minutos.
MINUTOS_SILENCIO_DESCARTE = 30


def ritmo_referencia(d1, n=VENTANA_REFERENCIA):
    """PLS/hora típico, como mediana de las últimas subidas.

    Mediana y no media: una propuesta de bloque triplica el ritmo de esa hora
    y arrastraría una media hacia arriba, subiendo el listón justo después de
    un bloque. La mediana la ignora.

    Devuelve None si no hay historial suficiente para tener una opinión.
    """
    filas = d1(
        "SELECT ts, ganado FROM snapshots WHERE ganado IS NOT NULL "
        "ORDER BY ts DESC LIMIT ?",
        [n + 1],
    )
    if len(filas) < 3:
        return None

    filas = sorted(filas, key=lambda f: int(f["ts"]))
    ritmos = []
    for a, b in zip(filas, filas[1:]):
        horas = (int(b["ts"]) - int(a["ts"])) / 3600
        subida = float(b["ganado"]) - float(a["ganado"])
        if horas > 0 and subida >= 0:
            ritmos.append(subida / horas)

    if len(ritmos) < 2:
        return None

    ritmos.sort()
    medio = len(ritmos) // 2
    if len(ritmos) % 2:
        return ritmos[medio]
    return (ritmos[medio - 1] + ritmos[medio]) / 2


# Margen para reconocer un barrido: tras la retirada el balance vuelve al stake
# exacto, y lo único que puede haberse acumulado encima son las recompensas de
# las epochs transcurridas desde entonces. Una hora larga de margen sobra.
MARGEN_BARRIDO_PLS = 5_000


def es_barrido(balance_total, stake_total, ganado):
    """¿La bajada se explica por una retirada parcial del protocolo?

    Tras el barrido el balance queda en el stake exacto y vuelve a subir desde
    ahí, así que el excedente actual tiene que ser pequeño y el balance tiene
    que cuadrar con stake + ese excedente.
    """
    if not balance_total or not stake_total:
        return False
    if ganado is None or ganado < 0 or ganado > MARGEN_BARRIDO_PLS:
        return False
    return abs(balance_total - (stake_total + ganado)) < 1.0


def revisar_snapshot(d1, ts, ganado, slashed=0, balance_total=None, stake_total=None):
    """¿Es admisible escribir este snapshot? Devuelve (bool, motivo).

    Comprueba continuidad contra lo ya registrado: las recompensas acumuladas
    solo suben, y suben a un ritmo que se parece al de las horas anteriores.
    """
    if ganado is None:
        return False, "ganado ausente"

    filas = d1(
        "SELECT ts, ganado FROM snapshots WHERE ganado IS NOT NULL "
        "ORDER BY ts DESC LIMIT 1"
    )
    if not filas:
        return True, None  # primera fila: no hay contra qué comparar

    ts_previo = int(filas[0]["ts"])
    ganado_previo = float(filas[0]["ganado"])

    # --- bajadas ---
    if ganado < ganado_previo:
        if slashed and slashed > 0:
            return True, None  # una penalización real sí puede bajar el saldo

        # Un barrido de saldo NO es un error. El protocolo retira el excedente
        # sobre los 32M a la wallet de retirada cada ~9 h, el balance vuelve a
        # 32M exactos y `ganado` (que es balance − stake) empieza de cero otra
        # vez. Observado dos veces el 8 y 9 de ago, con la acumulación
        # siguiendo después al ritmo normal de ~2.890 PLS/h.
        #
        # La primera versión de esta guardia rechazaba estas bajadas y habría
        # congelado la tubería cada nueve horas.
        if es_barrido(balance_total, stake_total, ganado):
            return True, None

        return False, (
            f"ganado bajaría de {ganado_previo:,.0f} a {ganado:,.0f} "
            f"(−{ganado_previo - ganado:,.0f}) sin penalización y sin que el "
            f"balance haya vuelto al stake: no parece un barrido"
        )

    horas = (int(ts) - ts_previo) / 3600
    if horas <= 0:
        return False, f"el timestamp no avanza (previo {ts_previo}, nuevo {ts})"

    # --- subidas fuera de rango ---
    referencia = ritmo_referencia(d1)
    if referencia and referencia > 0:
        observado = (ganado - ganado_previo) / horas
        if observado > referencia * FACTOR_MAX_SUBIDA:
            return False, (
                f"subida de {observado:,.0f} PLS/h frente a un ritmo típico de "
                f"{referencia:,.0f} ({observado / referencia:.1f}x el normal)"
            )

    return True, None


def registrar_descarte(d1, motivo, ts=None, minutos_silencio=MINUTOS_SILENCIO_DESCARTE):
    """Anota en `eventos` que se han rechazado datos. True si se ha escrito.

    Sin esto, un descarte y un NUC apagado se ven igual desde el panel: los
    datos dejan de avanzar y no hay forma de saber si hay que ir a mirar la
    máquina. Con esto, el panel puede decir «el nodo responde, son sus datos
    los que no se admiten».
    """
    ahora = int(ts or time.time())

    # Un fallo continuado de la API dispararía un evento cada tres minutos.
    ya = d1(
        "SELECT 1 FROM eventos WHERE tipo = 'descarte' AND ts >= ? LIMIT 1",
        [ahora - minutos_silencio * 60],
    )
    if ya:
        return False

    d1(
        "INSERT INTO eventos (ts, tipo, titulo, detalle) "
        "VALUES (?, 'descarte', 'Datos rechazados', ?)",
        [ahora, motivo],
    )
    return True


# --------------------------------------------------------------------------
# Lectura estable: dos lecturas antes de fiarse
# --------------------------------------------------------------------------

# Margen entre dos lecturas seguidas del mismo estado.
TOLERANCIA_PLS = 1.0


def lectura_estable(leer_estado, espera=2.0, tolerancia=TOLERANCIA_PLS):
    """Lee el estado dos veces y solo lo da por bueno si ambas coinciden.

    Los balances del beacon se consolidan una vez por epoch (5,33 min), así
    que dos lecturas separadas por segundos tienen que dar el mismo `ganado`.
    Si no coinciden, la API está sirviendo un estado transitorio y no hay
    motivo para fiarse de ninguna de las dos.

    `leer_estado` es la función del recolector que compone el estado completo.
    Devuelve (estado, motivo): si el motivo no es None, la lectura no es fiable.
    """
    primera = leer_estado()
    g1 = ((primera or {}).get("validadores") or {}).get("ganado_total")
    e1 = ((primera or {}).get("nodo") or {}).get("epoch_actual")

    time.sleep(espera)

    segunda = leer_estado()
    g2 = ((segunda or {}).get("validadores") or {}).get("ganado_total")
    e2 = ((segunda or {}).get("nodo") or {}).get("epoch_actual")

    if g1 is None or g2 is None:
        return segunda, "alguna de las dos lecturas no trae ganado_total"

    # Si se ha cruzado un cambio de epoch entre lecturas, la diferencia es
    # legítima: vale la segunda, que es la más reciente.
    if e1 is not None and e2 is not None and e1 != e2:
        return segunda, None

    if abs(g2 - g1) > tolerancia:
        return segunda, (
            f"dos lecturas seguidas no coinciden: {g1:,.2f} y {g2:,.2f} PLS "
            f"dentro de la misma epoch"
        )

    return segunda, None
