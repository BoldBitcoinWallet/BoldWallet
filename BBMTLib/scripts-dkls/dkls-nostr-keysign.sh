#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUTPUT_DIR="${OUTPUT_DIR:-./scripts-dkls/nostr-keygen-output}"
KEYSIGN_OUTPUT_DIR="${KEYSIGN_OUTPUT_DIR:-./scripts-dkls/nostr-keysign-output}"
RELAYS="${RELAYS:-wss://nostr.hifish.org,wss://nostr.xxi.quest,wss://bbw-nostr.xyz}"
MESSAGE="${MESSAGE:-test-message-dkls}"

if [ ! -f "${OUTPUT_DIR}/nostr-party1.json" ]; then
  echo "Run dkls-nostr-keygen.sh first" >&2
  exit 1
fi

LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
export CGO_ENABLED=1
export CGO_LDFLAGS="-L${LIBTSS_RELEASE} -llibtss_ffi -lm -framework Security -framework CoreFoundation"
go build -o /tmp/dkls-scripts ./scripts-dkls/main.go

read -r NSEC1 NPUB1 <<<"$("/tmp/dkls-scripts" nostr-keypair | awk -F',' '{print $1" "$2}')"
read -r NSEC2 NPUB2 <<<"$("/tmp/dkls-scripts" nostr-keypair | awk -F',' '{print $1" "$2}')"
PEERS="${NPUB1},${NPUB2}"
mkdir -p "$KEYSIGN_OUTPUT_DIR"

run_party() {
  local nsec="$1" ks="$2" out="$3"
  NOSTR_NSEC="$nsec" PEERS="$PEERS" RELAYS="$RELAYS" KEYSHARE="$ks" MESSAGE="$MESSAGE" \
    /tmp/dkls-scripts nostr-keysign >"$out"
}

run_party "$NSEC1" "${OUTPUT_DIR}/nostr-party1.json" "${KEYSIGN_OUTPUT_DIR}/party1.sig.json" &
PID1=$!
sleep 2
run_party "$NSEC2" "${OUTPUT_DIR}/nostr-party2.json" "${KEYSIGN_OUTPUT_DIR}/party2.sig.json" &
PID2=$!
wait "$PID1" "$PID2"

echo "Signatures in ${KEYSIGN_OUTPUT_DIR}"
