#!/bin/bash
set -euo pipefail
"${BASH_SOURCE%/*}/../scripts/start-local-relay.sh" "$@"
