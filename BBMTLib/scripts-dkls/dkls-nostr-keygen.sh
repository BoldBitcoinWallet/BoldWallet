#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RELAYS_DEFAULT="wss://nostr.hifish.org,wss://nostr.xxi.quest,wss://bbw-nostr.xyz"
RELAYS="${RELAYS:-$RELAYS_DEFAULT}"
OUTPUT_DIR="${OUTPUT_DIR:-./scripts-dkls/nostr-keygen-output}"
mkdir -p "$OUTPUT_DIR"

LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
export CGO_ENABLED=1
export CGO_LDFLAGS="-L${LIBTSS_RELEASE} -llibtss_ffi -lm -framework Security -framework CoreFoundation"

go build -o /tmp/dkls-scripts ./scripts-dkls/main.go

read -r NSEC1 NPUB1 <<<"$("/tmp/dkls-scripts" nostr-keypair | awk -F',' '{print $1" "$2}')"
read -r NSEC2 NPUB2 <<<"$("/tmp/dkls-scripts" nostr-keypair | awk -F',' '{print $1" "$2}')"

SESSION_ID="$("/tmp/dkls-scripts" random)"
SESSION_KEY="$("/tmp/dkls-scripts" random)"
CHAINCODE="$("/tmp/dkls-scripts" random)"
ALL_PARTIES="${NPUB1},${NPUB2}"

run_party() {
  local nsec="$1" out="$2"
  NOSTR_NSEC="$nsec" PEERS="$ALL_PARTIES" RELAYS="$RELAYS" \
    SESSION_ID="$SESSION_ID" SESSION_KEY="$SESSION_KEY" CHAINCODE="$CHAINCODE" \
    OUTPUT="$out" /tmp/dkls-scripts nostr-keygen
}

run_party "$NSEC1" "$OUTPUT_DIR/nostr-party1.json" &
PID1=$!
sleep 2
run_party "$NSEC2" "$OUTPUT_DIR/nostr-party2.json" &
PID2=$!
wait "$PID1" "$PID2"

echo "Outputs in $OUTPUT_DIR"
jq -r '.pub_key' "$OUTPUT_DIR/nostr-party1.json"
jq -r '.pub_key' "$OUTPUT_DIR/nostr-party2.json"
