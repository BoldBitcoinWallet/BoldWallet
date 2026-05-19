#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; exit 1; }
skip() { echo -e "${YELLOW}SKIP${NC} $*"; }

echo "BBMTLib DKLs23 Scripts Test Suite"
echo "=================================="

LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
if [ ! -f "${LIBTSS_RELEASE}/liblibtss_ffi.a" ] && [ ! -f "${LIBTSS_RELEASE}/liblibtss_ffi.dylib" ]; then
  echo "Building libtss-ffi..."
  (cd "${ROOT}/../../libtss" && cargo build --release -p libtss-ffi)
fi

export CGO_ENABLED=1
export CGO_LDFLAGS="-L${LIBTSS_RELEASE} -llibtss_ffi -lm -framework Security -framework CoreFoundation"

go build -o /tmp/dkls-scripts ./scripts-dkls/main.go
pass "built scripts-dkls helper"

/tmp/dkls-scripts random | head -c 32 >/dev/null
pass "random helper"

/tmp/dkls-scripts nostr-keypair | grep -q ','
pass "nostr-keypair helper"

/tmp/dkls-scripts hello-dkg | grep -q 'dkls23 ok'
pass "hello-dkg in-process DKG+sign"

OUT_DIR="${ROOT}/scripts-dkls/test-output"
mkdir -p "$OUT_DIR"
/tmp/dkls-scripts local-keygen "$OUT_DIR/chaincode.hex" > "$OUT_DIR/party1.json"
[ -s "$OUT_DIR/party1.json" ] || fail "local-keygen empty output"
pass "local-keygen"

/tmp/dkls-scripts validate-ks "$OUT_DIR/party1.json"
pass "validate-ks"

go test -count=1 ./dkls/ -run 'TestHelloDkg|TestDKGAndSignInProcess|TestKeyshareRoundTrip'
pass "dkls unit tests"

if [ -x "${ROOT}/scripts-dkls/start-local-relay.sh" ]; then
  "${ROOT}/scripts-dkls/start-local-relay.sh" || skip "relay start failed"
  if docker ps --format '{{.Names}}' | grep -q '^bbmtlib-test-relay$'; then
    RELAYS="ws://localhost:7777" PEERS="${NPUB2:-}" skip "nostr 2-party needs NPUB2 env — run dkls-nostr-keygen.sh manually"
    "${ROOT}/scripts-dkls/stop-local-relay.sh" 2>/dev/null || true
  fi
else
  skip "nostr integration (no relay script)"
fi

echo ""
echo "All deterministic DKLs23 script tests passed."
