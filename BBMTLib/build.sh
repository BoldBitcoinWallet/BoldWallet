#!/usr/bin/env bash
# BoldWallet mobile native libs:
#   ./build-all.sh       → libtss + GG18 + DKLs (Android + iOS on macOS) — use before release
#   ./build.sh           → GG18 gomobile (tss.aar / Tss.xcframework)
#   ./build-dkls.sh      → DKLs23 c-shared (libbbmtmobile.so / libbbmtmobile.xcframework)
#   ./build.sh --with-dkls → GG18 + DKLs (same as build-all minus libtss pre-step / host smoke)
#
# Do not gomobile-bind dklsbind on Android: dkls.aar duplicates go.Seq from tss.aar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}"

WITH_DKLS=0
CLEAR_CACHE=0
for arg in "$@"; do
  case "${arg}" in
    --with-dkls) WITH_DKLS=1 ;;
    --clear-cache) CLEAR_CACHE=1 ;;
    -h|--help)
      echo "Usage: $0 [--clear-cache] [--with-dkls]"
      echo "  --with-dkls    Also run build-dkls.sh (Android + iOS on macOS)"
      exit 0
      ;;
    *)
      echo "Unknown option: ${arg}"
      echo "Usage: $0 [--clear-cache] [--with-dkls]"
      exit 1
      ;;
  esac
done

# --- Configuration & Helpers ---

# Text formatting
BOLD="\033[1m"
RESET="\033[0m"
GREEN="\033[32m"
YELLOW="\033[33m"

info() { echo -e "${BOLD}${GREEN}==>${RESET} ${BOLD}$1${RESET}"; }
warn() { echo -e "${BOLD}${YELLOW}Warning:${RESET} $1"; }

info "Starting BoldWallet TSS gomobile build (FIPS-aware, Go 1.24+)"

# --- 1. Environment Checks ---
# Note: Go 1.25's tagged-pointer runtime can trigger "fatal error: taggedPointerPack"
# in some container/virtualized environments. For FIPS Android build, use
# fips-android.sh (Docker) which uses Go 1.24.x, or install Go 1.24.x on the host.

echo "Go environment:"
go version
go env | grep -E 'GOOS|GOARCH|CGO_ENABLED|GODEBUG|GOEXPERIMENT|GOPATH|PATH'

# FIPS Policy Check (Linux specific)
if [[ "$(uname)" == "Linux" ]] && [[ -f "/etc/crypto-policies/config" ]]; then
    info "FIPS policy check (system level):"
    if grep -q '^FIPS$' /etc/crypto-policies/config 2>/dev/null; then
        echo "FIPS crypto policy active"
    else
        echo "No FIPS system policy active"
    fi
fi

# Reliable FIPS check (Cross-platform temp file)
info "Checking native FIPS 140-3 mode..."

# Portable mktemp approach: create in current dir to avoid /tmp permission/path issues on different OSs
TMP_GO_FILE="./fips_check_$(date +%s).go"

cat > "$TMP_GO_FILE" <<'EOF'
package main
import (
    "crypto/fips140"
    "fmt"
    "os"
)
func main() {
    if fips140.Enabled() {
        fmt.Fprint(os.Stdout, "enabled")
    } else {
        fmt.Fprint(os.Stdout, "disabled")
    }
}
EOF

# Run check, defaulting to disabled if run fails (e.g. if crypto/fips140 doesn't exist in older Go)
FIPS_ENABLED=$(go run "$TMP_GO_FILE" 2>/dev/null || echo "disabled/unavailable")
rm -f "$TMP_GO_FILE"

echo "Native FIPS mode: ${FIPS_ENABLED}"

# --- 2. Toolchain Setup ---

info "Preparing modules..."
go mod tidy
go mod download
go mod verify

# Ensure GOPATH/bin is in PATH
export PATH="$PATH:$(go env GOPATH)/bin"

# Install gomobile/gobind if missing
if ! command -v gomobile &> /dev/null; then
    warn "gomobile not found. Installing..."
    go install golang.org/x/mobile/cmd/gomobile@latest
fi

if ! command -v gobind &> /dev/null; then
    warn "gobind not found. Installing..."
    go install golang.org/x/mobile/cmd/gobind@latest
fi

# Initialize gomobile (Safe to run repeatedly, but we try standard init first)
info "Initializing gomobile..."
gomobile init || { warn "Init failed – retrying with verbose output"; gomobile init -v; }

# Verify gobind works
gobind -h >/dev/null 2>&1 || { echo "Error: gobind not functional"; exit 1; }

# Optional cache clear
if [[ "${CLEAR_CACHE}" -eq 1 ]]; then
    warn "Clearing cache as requested..."
    go clean -modcache
    go mod download
fi

# --- 3. Build: Android ---

info "Building for Android..."

# Check requirements for Android
if [[ -z "${ANDROID_HOME:-}" ]]; then
    warn "ANDROID_HOME is not set. Android build might fail if SDK is missing."
fi

# Set flag for Go modules
export GOFLAGS="-mod=mod"

# Run Bind
# Note: -androidapi 21 is the standard min version
# Android 15 requires 16 KB page size support. Go 1.23+ supports it, but we explicitly
# set the max-page-size for the linker to ensure libgojni.so is compliant.
gomobile bind -v -target=android -androidapi 21 -ldflags="-extldflags=-Wl,-z,max-page-size=16384" -o tss.aar github.com/BoldBitcoinWallet/BBMTLib/tss

# DKLs23 on Android: ./build-dkls.sh android → libbbmtmobile.so + dkls_jni (not dkls.aar).
# A second gomobile AAR duplicates go.Seq / go.Universe from tss.aar at link time.

# Copy Artifacts
if [[ -d "../android/app/libs" ]]; then
    # Run go mod tidy again at the end to ensure go.mod/go.sum are clean
    info "Copying Android artifacts..."
    cp -v tss.aar ../android/app/libs/tss.aar || warn "Copy tss.aar failed"
    echo "✓ tss.aar copied to ../android/app/libs/tss.aar"
    # gomobile bind generates sources jar alongside the aar? 
    # Usually it produces just the .aar. If you have a custom process generating -sources.jar, keep this.
    if [[ -f "tss-sources.jar" ]]; then
        cp -v tss-sources.jar ../android/app/libs/tss-sources.jar || warn "Copy sources.jar failed"
        echo "✓ tss-sources.jar copied to ../android/app/libs/tss-sources.jar"
    fi
    rm -f ../android/app/libs/dkls.aar 2>/dev/null || true
fi

# --- 4. Build: iOS/macOS ---

if [[ "$(uname)" == "Darwin" ]]; then
    info "macOS detected → Building for iOS/Simulator/macOS"
    
    # Ensure Xcode command line tools or Xcode is valid
    if ! xcode-select -p &>/dev/null; then
        echo "Error: Xcode tools not found. Cannot build for iOS."
        exit 1
    fi

    # GG18 only; DKLs23 iOS uses ./build-dkls.sh ios → libdklsmobile.xcframework + DklsBridge
    gomobile bind -v -target=ios,iossimulator,macos -o Tss.xcframework github.com/BoldBitcoinWallet/BBMTLib/tss

    # Copy Artifacts
    if [[ -d "../ios" ]]; then
        info "Copying iOS artifacts..."
        rm -rf ../ios/Tss.xcframework 2>/dev/null || true
        cp -a ./Tss.xcframework ../ios/ || warn "Copy Tss.xcframework failed"
        echo "✓ Tss.xcframework copied to ../ios/Tss.xcframework"
        rm -rf ../ios/Dkls.xcframework 2>/dev/null || true
    fi
else
    info "Not running on macOS → Skipping iOS/macOS targets"
fi

info "Tidying dependencies..."
go mod tidy || warn "go mod tidy failed"

if [[ "${WITH_DKLS}" -eq 1 ]]; then
  info "Building DKLs23 (build-dkls.sh)..."
  bash "${ROOT}/build-dkls.sh" android
  if [[ "$(uname)" == "Darwin" ]]; then
    bash "${ROOT}/build-dkls.sh" ios
  fi
else
  warn "DKLs23 not built. For release APK/IPA also run: ./build-dkls.sh android  (and ios on macOS)"
  warn "Or use: ./build.sh --with-dkls  or  ./build-all.sh"
fi

info "Build complete!"
info "  GG18:  android/app/libs/tss.aar"
info "  DKLs:  android jniLibs/*/libbbmtmobile.so, ios/BbmtMobile/libbbmtmobile.xcframework"
info "  All:   ./build-all.sh"
