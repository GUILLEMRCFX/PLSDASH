#!/bin/bash
# Toda la suite. Levanta el servidor, corre lo que hay y lo apaga.
#
#   ./pruebas/correr.sh              todo
#   ./pruebas/correr.sh wallets      solo lo que case con «wallets»
#
# Sale con 0 solo si TODO pasa: sirve tal cual para un gancho de pre-push.
set -uo pipefail
cd "$(dirname "$0")/.."

FILTRO="${1:-}"
PUERTO="${PUERTO:-8899}"

# Las que no necesitan navegador van primero: si algo está roto de raíz, se sabe
# en dos segundos en vez de en tres minutos.
SIN_NAVEGADOR=(
  "pruebas/sintaxis-test.mjs"
  "pruebas/precio-panel-test.mjs"
  "pruebas/inversiones-test.mjs"
  "pruebas/rutas-test.mjs"
)
CON_NAVEGADOR=(
  "pruebas/puerta-test.js"
  "pruebas/wallets-test.js"
  "pruebas/invest-vista-test.js"
  "pruebas/vault-test.js"
)

# El servidor solo hace falta para las de navegador, pero levantarlo siempre
# sale más barato que decidirlo.
node pruebas/servidor.js > /tmp/plsdash-servidor.log 2>&1 &
SERVIDOR=$!
trap 'kill $SERVIDOR 2>/dev/null' EXIT

for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PUERTO/" && break
  sleep 0.25
done

FALLAN=()
correr() {
  local t="$1"
  [ -n "$FILTRO" ] && [[ "$t" != *"$FILTRO"* ]] && return 0
  [ -f "$t" ] || { echo "  (no está: $t)"; return 0; }
  printf '%-34s ' "$t"
  local log="/tmp/plsdash-$(basename "$t").log"
  if [[ "$t" == *.mjs ]]; then
    timeout 600 node --import ./pruebas/resolver.mjs "$t" > "$log" 2>&1
  else
    timeout 600 node "$t" > "$log" 2>&1
  fi
  local codigo=$?
  local ultima
  ultima=$(tail -1 "$log")
  if [ $codigo -eq 0 ]; then echo "✔ $ultima"
  else echo "✘ $ultima   → $log"; FALLAN+=("$t"); fi
}

echo "── sin navegador ──"
for t in "${SIN_NAVEGADOR[@]}"; do correr "$t"; done
echo "── con navegador ──"
for t in "${CON_NAVEGADOR[@]}"; do correr "$t"; done

echo
if [ ${#FALLAN[@]} -eq 0 ]; then
  echo "TODO EN VERDE"
else
  echo "FALLAN: ${FALLAN[*]}"
  exit 1
fi
