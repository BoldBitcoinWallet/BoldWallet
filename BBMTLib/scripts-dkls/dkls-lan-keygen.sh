#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PARTY_COUNT="${PARTY_COUNT:-2}"
PORT="${PORT:-55055}"
OUTPUT_DIR="${OUTPUT_DIR:-./scripts-dkls/lan-keygen-output}"
mkdir -p "$OUTPUT_DIR"

LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
export CGO_ENABLED=1
source "${ROOT}/scripts-dkls/cgo-env.sh"
export DKLS_TEST_DKG_SEC="${DKLS_TEST_DKG_SEC:-90}"
export DKLS_LAN_PUMP_MS="${DKLS_LAN_PUMP_MS:-100}"

go build -o /tmp/dkls-scripts ./scripts-dkls/main.go

SESSION_ID="$("/tmp/dkls-scripts" random)"
SESSION_KEY="$("/tmp/dkls-scripts" random)"
CHAINCODE="$("/tmp/dkls-scripts" random)"
SERVER="http://127.0.0.1:${PORT}"

echo "Starting LAN relay on ${PORT}..."
/tmp/dkls-scripts relay "$PORT" >/dev/null 2>&1 &
RELAY_PID=$!
trap 'kill $RELAY_PID 2>/dev/null || true' EXIT
sleep 2

if [ "$PARTY_COUNT" = "3" ]; then
  PARTIES="KeyShare1,KeyShare2,KeyShare3"
  KEYS=(KeyShare1 KeyShare2 KeyShare3)
else
  PARTIES="KeyShare1,KeyShare2"
  KEYS=(KeyShare1 KeyShare2)
fi

run_party() {
  local key="$1"
  local out="$2"
  /tmp/dkls-scripts lan-keygen "$key" "$PARTIES" "$SESSION_ID" "$SERVER" "$CHAINCODE" "$SESSION_KEY" >"$out"
}

PIDS=()
for i in "${!KEYS[@]}"; do
  key="${KEYS[$i]}"
  out="${OUTPUT_DIR}/${key}.json"
  if [ "$i" -gt 0 ]; then
    sleep 2
  fi
  run_party "$key" "$out" &
  PIDS+=("$!")
done
for pid in "${PIDS[@]}"; do
  wait "$pid"
done

echo "Keyshares in ${OUTPUT_DIR}"
for key in "${KEYS[@]}"; do
  jq -r '.pub_key' "${OUTPUT_DIR}/${key}.json"
done
