#!/usr/bin/env bash
# Build libtss-ffi static libraries for host and mobile targets.
set -euo pipefail

BBMTLIB="$(cd "$(dirname "$0")/../.." && pwd)"
LIBTSS="$(cd "${BBMTLIB}/../../libtss" && pwd)"
OUT="$(cd "$(dirname "$0")" && pwd)"
LIBTSS_REF_EXPECTED="ae1f891ee2dd67b6e841eaf673f7a1c0e8040815"

info() { echo "==> $*"; }

LIBTSS_REF_ACTUAL="$(git -C "${LIBTSS}" rev-parse HEAD)"
if [ "${LIBTSS_REF_ACTUAL}" != "${LIBTSS_REF_EXPECTED}" ]; then
  echo "ERROR: libtss revision mismatch: got ${LIBTSS_REF_ACTUAL}, expected ${LIBTSS_REF_EXPECTED}" >&2
  exit 1
fi
info "Using pinned libtss revision ${LIBTSS_REF_ACTUAL}"

info "Building libtss-ffi (host release)..."
(cd "${LIBTSS}" && cargo build --release -p libtss-ffi)

mkdir -p "${OUT}/host" "${OUT}/android" "${OUT}/ios"
cp "${LIBTSS}/target/release/liblibtss_ffi.a" "${OUT}/host/" 2>/dev/null || \
  cp "${LIBTSS}/target/release/liblibtss_ffi.dylib" "${OUT}/host/" 2>/dev/null || true
cp "${LIBTSS}/libtss-ffi/libtss.h" "${OUT}/"
cp "${LIBTSS}/libtss-go/tss/tss_ffi.h" "${OUT}/" 2>/dev/null || true

if command -v cargo-ndk &>/dev/null; then
  info "Building Android ABIs..."
  (cd "${LIBTSS}" && bash scripts/build-android.sh)
  # cargo-ndk copies cdylib .so to jniLibs; Go c-shared needs staticlib .a from target/.
  copy_android_static() {
    local abi="$1"
    local triple="$2"
    local src="${LIBTSS}/target/${triple}/release/liblibtss_ffi.a"
    if [ -f "${src}" ]; then
      mkdir -p "${OUT}/android/${abi}"
      cp -f "${src}" "${OUT}/android/${abi}/"
      info "  ${abi} <- ${src}"
    else
      info "  skip ${abi} (no ${src})"
    fi
  }
  copy_android_static arm64-v8a aarch64-linux-android
  copy_android_static armeabi-v7a armv7-linux-androideabi
  copy_android_static x86_64 x86_64-linux-android
  copy_android_static x86 i686-linux-android
else
  info "cargo-ndk not installed; skipping Android libs"
fi

if command -v rustup &>/dev/null; then
  info "Building iOS targets (if rust targets installed)..."
  (cd "${LIBTSS}" && \
    rustup target add aarch64-apple-ios aarch64-apple-ios-sim 2>/dev/null || true && \
    cargo build --release --target aarch64-apple-ios -p libtss-ffi 2>/dev/null && \
    mkdir -p "${OUT}/ios/device" && \
    cp target/aarch64-apple-ios/release/liblibtss_ffi.a "${OUT}/ios/device/" 2>/dev/null || \
    info "iOS device build skipped") || true
fi

info "Done. Artifacts under ${OUT}"
