#!/bin/bash

# Check for --clear-cache flag
CLEAR_CACHE=false
for arg in "$@"; do
    if [ "$arg" = "--clear-cache" ]; then
        CLEAR_CACHE=true
        break
    fi
done

echo "building gomobile tss lib"
go mod tidy

# Clear module cache if --clear-cache flag is provided
if [ "$CLEAR_CACHE" = true ]; then
    echo "Clearing module cache to force fresh download..."
    go clean -modcache
fi

# Force download of all dependencies
echo "Downloading all dependencies..."
go mod download

# Install gomobile if not already installed
if ! command -v gomobile &> /dev/null; then
    echo "gomobile not found, installing..."
    go install golang.org/x/mobile/cmd/gomobile@latest
    # Add Go bin directory to PATH if not already there
    export PATH="$PATH:$(go env GOPATH)/bin"
fi

gomobile init
export GOFLAGS="-mod=mod"
# NIST FIPS 140-3: use Go Cryptographic Module (enables FIPS mode in the built binary)
export GOFIPS140="${GOFIPS140:-v1.0.0}"

echo "Verifying FIPS 140-3 mode..."

TMP_FIPS_FILE=$(mktemp /tmp/fipscheck-XXXX.go)

cat > "$TMP_FIPS_FILE" <<'EOF'
package main

import (
	"fmt"
	"crypto/internal/fips140"
)

func main() {
	if fips140.Enabled() {
		fmt.Print("enabled")
	} else {
		fmt.Print("disabled")
	}
}
EOF

FIPS_STATUS=$(go run "$TMP_FIPS_FILE" 2>/dev/null)
rm -f "$TMP_FIPS_FILE"

if [ "$FIPS_STATUS" = "enabled" ]; then
	echo "FIPS mode: ENABLED"
else
	echo "FIPS mode: DISABLED"
	echo "ERROR: Go toolchain is not running in FIPS mode"
	exit 1
fi
gomobile bind -v -target=android -androidapi 21 github.com/BoldBitcoinWallet/BBMTLib/tss
cp tss.aar ../android/app/libs/tss.aar
cp tss-sources.jar ../android/app/libs/tss-sources.jar

gomobile bind -v -target=ios,iossimulator,macos github.com/BoldBitcoinWallet/BBMTLib/tss
# Remove old framework first (cp -r fails with symlinks when destination exists)
rm -rf ../ios/Tss.xcframework
cp -R ./Tss.xcframework ../ios/

# Run go mod tidy again at the end to ensure go.mod/go.sum are up to date
# This ensures any dependencies added during the build are included
echo "Updating go.mod/go.sum..."
go mod tidy
