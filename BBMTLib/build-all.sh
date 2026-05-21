#!/usr/bin/env bash
# Build all BoldWallet native MPC artifacts: libtss FFI + GG18 (gomobile) + DKLs23 (c-shared).
#
# Android (single Go runtime, GG18 + DKLs):
#   android/app/src/main/jniLibs/<abi>/libbbmtmobile.so
#   android/app/src/main/jniLibs/<abi>/libdkls_jni.so
#
# iOS (unified bridge — GG18 + DKLs in one Go runtime, macOS only):
#   ios/BbmtMobile/libbbmtmobile.xcframework
#
# Usage:
#   ./build-all.sh              # full pipeline
#   ./build-all.sh --clear-cache  # also clear Go module cache (build.sh)
#
# Then from repo root: npx react-native run-android | run-ios
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}"

CLEAR_CACHE=0
for arg in "$@"; do
  case "${arg}" in
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --clear-cache)
      CLEAR_CACHE=1
      ;;
    *)
      echo "Unknown option: ${arg}" >&2
      echo "Usage: $0 [--clear-cache]" >&2
      exit 1
      ;;
  esac
done

info() { echo "==> $*"; }
warn() { echo "Warning: $*" >&2; }

info "BoldWallet native build-all (libtss + GG18 + DKLs23)"
echo "Go: $(go version 2>/dev/null || echo 'not found')"
echo "Host: $(uname -s) $(uname -m)"

# --- 1) Rust libtss-ffi (host + Android ABIs when cargo-ndk is available) ---
info "[1/3] libtss-ffi (mobile-deps/libtss/build-libtss.sh)"
bash "${ROOT}/mobile-deps/libtss/build-libtss.sh"

# --- 2) GG18 gomobile + DKLs c-shared (Android; iOS xcframework on macOS) ---
info "[2/3] GG18 + DKLs23 (build.sh --with-dkls)"
BUILD_ARGS=(--with-dkls)
if [[ "${CLEAR_CACHE}" -eq 1 ]]; then
  BUILD_ARGS=(--clear-cache --with-dkls)
fi
bash "${ROOT}/build.sh" "${BUILD_ARGS[@]}"

# --- 3) Fast host smoke (Go unit tests only; LAN keygen optional via RUN_DKLS_LAN_INTEGRATION=1) ---
info "[3/3] DKLs host smoke (build-dkls.sh host, ~10s unless RUN_DKLS_LAN_INTEGRATION=1)"
bash "${ROOT}/build-dkls.sh" host

info "build-all complete."
echo ""
echo "Artifacts:"
echo "  Android:       ../android/app/src/main/jniLibs/*/libbbmtmobile.so"
echo "                 ../android/app/src/main/jniLibs/*/libdkls_jni.so"
echo "                 (Bbmt* + Dkls* JNI — no tss.aar)"
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "  iOS (both):    ../ios/BbmtMobile/libbbmtmobile.xcframework"
  echo "                 (link only this in Xcode — not Tss.xcframework + dkls separately)"
else
  warn "iOS xcframework skipped (requires macOS)"
fi
echo ""
echo "Next: cd .. && npx react-native run-android   # or run-ios on macOS"
