#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
export CGO_ENABLED=1
export CGO_LDFLAGS="-L${LIBTSS_RELEASE} -llibtss_ffi -lm -framework Security -framework CoreFoundation"
go run ./scripts-dkls/main.go local-keygen "${CHAINCODE:-$(go run ./scripts-dkls/main.go random 2>/dev/null | head -c 64 || echo 00)}"
