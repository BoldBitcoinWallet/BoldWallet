#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
export CGO_ENABLED=1
export CGO_LDFLAGS="-L${LIBTSS_RELEASE} -llibtss_ffi -lm -framework Security -framework CoreFoundation"
# Fail loudly on RNG failure — never fall back to a constant chaincode.
# With `set -euo pipefail`, a failing `random` aborts the script here.
CHAINCODE="${CHAINCODE:-$(go run ./scripts-dkls/main.go random)}"
go run ./scripts-dkls/main.go local-keygen "$CHAINCODE"
