#!/usr/bin/env bash
set -euo pipefail

echo "=== BoldWallet TSS gomobile build (FIPS-aware, Go 1.25+) ==="

# Environment checks
echo "Go environment:"
go version
go env | grep -E 'GOOS|GOARCH|CGO_ENABLED|GODEBUG|GOEXPERIMENT|GOPATH|PATH'

echo "FIPS policy check (system level):"
if grep -q '^FIPS$' /etc/crypto-policies/config 2>/dev/null; then
    echo "FIPS crypto policy active"
else
    echo "No FIPS system policy"
fi

# Reliable FIPS check
echo "Checking native FIPS 140-3 mode..."
TMP_GO_FILE=$(mktemp /tmp/fips-check.XXXXXX.go)
cat > "$TMP_GO_FILE" <<'EOF'
package main
import ("crypto/fips140"; "fmt"; "os")
func main() {
    if fips140.Enabled() { fmt.Fprint(os.Stdout, "enabled") } else { fmt.Fprint(os.Stdout, "disabled") }
}
EOF
FIPS_ENABLED=$(go run "$TMP_GO_FILE" 2>/dev/null || echo "disabled")
rm -f "$TMP_GO_FILE"
echo "Native FIPS mode: ${FIPS_ENABLED} (expected 'DISABLED' in container)"

# Modules (no -v on download — invalid in Go 1.25+)
echo "Preparing modules..."
go mod tidy
go mod download
go mod verify

# gomobile + gobind setup
echo "Setting up gomobile and gobind..."
export PATH="$PATH:$(go env GOPATH)/bin"

# Binaries should already be installed in Dockerfile (pinned version)
which gomobile || { echo "gomobile missing"; exit 1; }
which gobind || { echo "gobind missing"; exit 1; }

# Force init again (safe idempotent)
echo "Running gomobile init..."
gomobile init || { echo "Init failed – verbose retry"; gomobile init -v; }

# Verify gobind works
gobind -h >/dev/null 2>&1 || { echo "gobind not functional"; gobind -h; exit 1; }

# Optional cache clear
if [[ "${1:-}" == "--clear-cache" ]]; then
    echo "Clearing cache..."
    go clean -modcache
    go mod download
fi

# Android bind
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
gomobile bind -v -target=android -androidapi 21 github.com/BoldBitcoinWallet/BBMTLib/tss

# Copy Android artifacts
if [[ -d "../android/app/libs" ]]; then
    cp -v tss.aar ../android/app/libs/tss.aar || echo "Warning: copy tss.aar failed"
    cp -v tss-sources.jar ../android/app/libs/tss-sources.jar || echo "Warning: copy sources.jar failed"
else
    echo "Skipping Android copy"
fi

if [[ "$(uname)" == "Darwin" ]]; then
    echo "macOS detected → building iOS/macOS targets"
    gomobile bind -v -target=ios,iossimulator,macos github.com/BoldBitcoinWallet/BBMTLib/tss
    # Copy iOS artifacts
    if [[ -d "../ios" ]]; then
        rm -rf ../ios/Tss.xcframework 2>/dev/null || true
        cp -a ./Tss.xcframework ../ios/ || echo "Warning: copy Tss.xcframework failed"
    else
        echo "Skipping iOS copy"
    fi
else
    echo "Not running on macOS → skipping iOS/macOS targets (requires Xcode)"
    echo "Run ./build.sh directly on macOS for iOS/macOS framework"
fi

# Run go mod tidy again at the end to ensure go.mod/go.sum are up to date
# This ensures any dependencies added during the build are included
echo "Updating go.mod/go.sum..."
go mod tidy