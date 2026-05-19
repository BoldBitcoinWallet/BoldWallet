#!/bin/bash
set -euo pipefail
"${BASH_SOURCE%/*}/../scripts/stop-local-relay.sh" "$@"
