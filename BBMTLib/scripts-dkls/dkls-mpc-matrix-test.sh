#!/bin/bash
# Full DKLS MPC matrix (LAN + Nostr keygen/keysign) — same Go paths as mobile.
#
#   cd BBMTLib
#   export CGO_ENABLED=1
#   export CGO_LDFLAGS="-L$(cd ../libtss && pwd)/target/release -llibtss_ffi -lm -framework Security -framework CoreFoundation"
#   ./scripts-dkls/dkls-mpc-matrix-test.sh
#
# Optional:
#   DKLS_MPC_START_RELAY=1   start Docker nostr relay if 7777 is closed
#   DKLS_SKIP_MPC_MATRIX=1   skip (for CI without CGO)
#   DKLS_TEST_DKG_SEC=90     DKG deadline (default in TestMain)

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

if [ "${DKLS_SKIP_MPC_MATRIX:-0}" = "1" ]; then
  skip "DKLS_SKIP_MPC_MATRIX=1"
  exit 0
fi

LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
if [ ! -f "${LIBTSS_RELEASE}/liblibtss_ffi.a" ] && [ ! -f "${LIBTSS_RELEASE}/liblibtss_ffi.dylib" ]; then
  echo "Building libtss-ffi..."
  (cd "${ROOT}/../../libtss" && cargo build --release -p libtss-ffi)
fi

export CGO_ENABLED=1
source "${ROOT}/scripts-dkls/cgo-env.sh"
export RELAYS="${RELAYS:-ws://127.0.0.1:7777}"

if [ "${DKLS_MPC_START_RELAY:-1}" = "1" ]; then
  if ! (echo >/dev/tcp/127.0.0.1/7777) 2>/dev/null; then
    echo "==> Starting local Nostr relay (port 7777)..."
    "${ROOT}/scripts/start-local-relay.sh" || fail "start-local-relay.sh"
  fi
fi

echo "==> DKLS MPC matrix (TestMpcMatrix)"
if go test -count=1 ./dkls/ -timeout 25m -run '^TestMpcMatrix$' -v; then
  pass "TestMpcMatrix (LAN/Nostr keygen + keysign duo/trio)"
else
  fail "TestMpcMatrix"
fi
