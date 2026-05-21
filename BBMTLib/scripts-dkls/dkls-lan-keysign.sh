#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-55055}"
OUTPUT_DIR="${OUTPUT_DIR:-./scripts-dkls/lan-keygen-output}"
KEYSIGN_DIR="${KEYSIGN_OUTPUT_DIR:-./scripts-dkls/lan-keysign-output}"
MESSAGE="${MESSAGE:-test-message-dkls}"
mkdir -p "$KEYSIGN_DIR"

if [ ! -f "${OUTPUT_DIR}/KeyShare1.json" ] || [ ! -f "${OUTPUT_DIR}/KeyShare2.json" ]; then
  echo "Run dkls-lan-keygen.sh first (missing keyshares in ${OUTPUT_DIR})" >&2
  exit 1
fi

LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
export CGO_ENABLED=1
export CGO_LDFLAGS="-L${LIBTSS_RELEASE} -llibtss_ffi -lm -framework Security -framework CoreFoundation"
export DKLS_TEST_DKG_SEC="${DKLS_TEST_DKG_SEC:-90}"
export DKLS_LAN_PUMP_MS="${DKLS_LAN_PUMP_MS:-100}"
go build -o /tmp/dkls-scripts ./scripts-dkls/main.go

SESSION_ID="$("/tmp/dkls-scripts" random)"
SESSION_KEY="$("/tmp/dkls-scripts" random)"
SERVER="http://127.0.0.1:${PORT}"
PARTIES="KeyShare1,KeyShare2"

echo "Starting LAN relay on ${PORT}..."
/tmp/dkls-scripts relay "$PORT" >/dev/null 2>&1 &
RELAY_PID=$!
trap 'kill $RELAY_PID 2>/dev/null || true' EXIT
sleep 2

run_party() {
  local key="$1"
  local ks="$2"
  local out="$3"
  /tmp/dkls-scripts lan-keysign "$SERVER" "$key" "$PARTIES" "$SESSION_ID" "$SESSION_KEY" "$ks" "$MESSAGE" >"$out"
}

run_party KeyShare1 "${OUTPUT_DIR}/KeyShare1.json" "${KEYSIGN_DIR}/KeyShare1.sig.json" &
PID1=$!
sleep 2
run_party KeyShare2 "${OUTPUT_DIR}/KeyShare2.json" "${KEYSIGN_DIR}/KeyShare2.sig.json" &
PID2=$!
wait "$PID1" "$PID2"

echo "Signatures in ${KEYSIGN_DIR}"
cat "${KEYSIGN_DIR}/KeyShare1.sig.json"
echo ""
cat "${KEYSIGN_DIR}/KeyShare2.sig.json"
