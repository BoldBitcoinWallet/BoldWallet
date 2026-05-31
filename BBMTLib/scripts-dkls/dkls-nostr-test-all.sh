#!/bin/bash
# Nostr DKLS keygen verification: Go integration (duo + trio) + shell e2e.
# Same Go entrypoints as mobile (dkls.NostrJoinKeygen / BbmtNostrJoinKeygen).
#
# Local relay (Docker binds 0.0.0.0:7777; clients use ws://127.0.0.1:7777):
#   cd BBMTLib
#   ./scripts/start-local-relay.sh
#   ./scripts-dkls/dkls-nostr-test-all.sh
#
# Optional:
#   DKLS_NOSTR_START_RELAY=1      start relay if port 7777 is closed
#   RELAYS=ws://127.0.0.1:7777    override relay list (0.0.0.0 normalized to 127.0.0.1)
#   DKLS_NOSTR_VERBOSE=1          show BBMTLog + go test -v
#   DKLS_NOSTR_SKIP_GO=1          shell e2e only
#   DKLS_NOSTR_SKIP_SHELL=1       Go tests only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=dkls-nostr-lib.sh
source "${SCRIPT_DIR}/dkls-nostr-lib.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; exit 1; }

if [ "${DKLS_NOSTR_START_RELAY:-0}" = "1" ]; then
  local_url="$(dkls_nostr_local_relay_url 2>/dev/null || echo "ws://127.0.0.1:7777")"
  if ! dkls_nostr_relay_tcp_reachable "$local_url" 2>/dev/null; then
    echo "==> Starting local Nostr relay..."
    "${SCRIPT_DIR}/start-local-relay.sh" || fail "start-local-relay.sh"
  fi
fi

dkls_nostr_setup || fail "relay setup (start BBMTLib/scripts/start-local-relay.sh or set RELAYS)"
dkls_nostr_check_relay || fail "relay check"
dkls_nostr_build_scripts
pass "CGO + dkls-scripts ready (RELAYS=${RELAYS})"

E2E_BASE="${DKLS_NOSTR_ROOT}/scripts-dkls/nostr-test-output"
rm -rf "$E2E_BASE"
mkdir -p "$E2E_BASE"

GO_TEST_FLAGS=(-count=1 -timeout 10m -run 'TestNostrJoinKeygen(Duo|Trio)')
if [ "${DKLS_NOSTR_VERBOSE:-0}" = "1" ]; then
  GO_TEST_FLAGS+=(-v)
fi

if [ "${DKLS_NOSTR_SKIP_GO:-0}" != "1" ]; then
  echo "==> Go: TestNostrJoinKeygen (duo + trio)"
  if go test ./dkls "${GO_TEST_FLAGS[@]}"; then
    pass "TestNostrJoinKeygenDuo + TestNostrJoinKeygenTrio"
  else
    fail "Nostr Go integration tests"
  fi
else
  echo -e "${YELLOW}SKIP${NC} Go tests (DKLS_NOSTR_SKIP_GO=1)"
fi

if [ "${DKLS_NOSTR_SKIP_SHELL:-0}" != "1" ]; then
  echo "==> Shell e2e: duo keygen"
  if OUTPUT_DIR="${E2E_BASE}/duo" dkls_nostr_run_duo; then
    pass "dkls-nostr duo shell e2e"
  else
    fail "dkls-nostr duo shell e2e"
  fi

  echo "==> Shell e2e: trio keygen"
  if OUTPUT_DIR="${E2E_BASE}/trio" dkls_nostr_run_trio; then
    pass "dkls-nostr trio shell e2e"
  else
    fail "dkls-nostr trio shell e2e"
  fi
else
  echo -e "${YELLOW}SKIP${NC} shell e2e (DKLS_NOSTR_SKIP_SHELL=1)"
fi

echo ""
echo "All Nostr DKLS keygen checks passed."
