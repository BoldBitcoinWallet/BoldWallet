#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=dkls-nostr-lib.sh
source "${SCRIPT_DIR}/dkls-nostr-lib.sh"

dkls_nostr_setup
dkls_nostr_build_scripts
dkls_nostr_run_duo
echo "Outputs in ${OUTPUT_DIR:-./scripts-dkls/nostr-keygen-output}"
