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
source "${ROOT}/scripts-dkls/cgo-env.sh"

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

echo "==> dkls unit + join-barrier smoke (Go)"
go test -count=1 ./dkls/ -timeout 3m -run 'TestHelloDkg|TestDKGAndSignInProcessTrio|TestDKGAndSignInProcess|TestRunDKGWithSenderTrioInProcess|TestRunDKGWithSenderInProcess|TestKeyshareRoundTrip|TestDedupe|TestRecvPeer|TestMerge|TestLanAwaitJoinersPartialTrio|TestResolveSigning|TestPartyID|TestDedupeSigning|normalizeParticipating'
pass "dkls unit + join-barrier tests"

echo "==> tss backend dispatch (Go)"
go test -count=1 ./tss/ -timeout 1m -run 'ParseTssBackend|IsDKLs'
pass "tss dispatch unit tests"

if [ "${DKLS_SKIP_MPC_MATRIX:-0}" != "1" ]; then
  echo "==> DKLS MPC matrix (LAN/Nostr keygen + keysign duo/trio)"
  DKLS_MPC_START_RELAY="${DKLS_MPC_START_RELAY:-1}" bash "${ROOT}/scripts-dkls/dkls-mpc-matrix-test.sh"
else
  skip "MPC matrix (set DKLS_SKIP_MPC_MATRIX=0; run ./scripts-dkls/dkls-mpc-matrix-test.sh)"
fi

if [ "${RUN_DKLS_LAN_INTEGRATION:-0}" = "1" ]; then
  echo "==> dkls extra LAN keygen stress (RUN_DKLS_LAN_INTEGRATION=1)"
  go test -count=1 ./dkls/ -timeout 15m -run 'TestLanJoinKeygenTrioSimultaneous|TestLanJoinKeygenTrioStaggerMobile|TestLanJoinKeygenTrioDerivedSessionKey'
  pass "dkls extra LAN keygen integration"
fi

if [ "${RUN_DKLS_TRIO_STRESS:-0}" = "1" ]; then
  go test -count=1 ./dkls/ -timeout 20m -run 'TestLanJoinKeygenTrioRepeated'
  pass "trio LAN stress (RUN_DKLS_TRIO_STRESS=1)"
else
  skip "trio LAN stress (set RUN_DKLS_TRIO_STRESS=1 to enable TestLanJoinKeygenTrioRepeated)"
fi

for s in dkls-lan-keygen.sh dkls-lan-keysign.sh dkls-nostr-keygen-trio.sh dkls-nostr-keysign.sh; do
  if [ -f "${ROOT}/scripts-dkls/${s}" ]; then
    bash -n "${ROOT}/scripts-dkls/${s}" && pass "${s} syntax"
  fi
done

echo "==> dkls LAN shell e2e (duo keygen + keysign)"
E2E_DIR="${ROOT}/scripts-dkls/test-e2e-output"
rm -rf "$E2E_DIR"
export OUTPUT_DIR="${E2E_DIR}/lan-keygen"
export KEYSIGN_OUTPUT_DIR="${E2E_DIR}/lan-keysign"
export PORT="${PORT:-55155}"
if bash "${ROOT}/scripts-dkls/dkls-lan-keygen.sh" >/dev/null; then
  pass "dkls-lan-keygen.sh"
else
  fail "dkls-lan-keygen.sh"
fi
for f in "${OUTPUT_DIR}/KeyShare1.json" "${OUTPUT_DIR}/KeyShare2.json"; do
  /tmp/dkls-scripts validate-ks "$f" >/dev/null || fail "validate-ks $f"
done
pass "validate-ks on LAN keygen outputs"
PUB1=$(jq -r '.pub_key' "${OUTPUT_DIR}/KeyShare1.json")
PUB2=$(jq -r '.pub_key' "${OUTPUT_DIR}/KeyShare2.json")
if [ "$PUB1" != "$PUB2" ] || [ -z "$PUB1" ]; then
  fail "LAN keygen pub_key mismatch"
fi
if bash "${ROOT}/scripts-dkls/dkls-lan-keysign.sh" >/dev/null; then
  pass "dkls-lan-keysign.sh"
else
  fail "dkls-lan-keysign.sh"
fi
SIG1=$(jq -c . "${KEYSIGN_OUTPUT_DIR}/KeyShare1.sig.json")
SIG2=$(jq -c . "${KEYSIGN_OUTPUT_DIR}/KeyShare2.sig.json")
if [ "$SIG1" != "$SIG2" ]; then
  fail "LAN keysign signatures mismatch"
fi
pass "LAN keysign signatures match"

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
