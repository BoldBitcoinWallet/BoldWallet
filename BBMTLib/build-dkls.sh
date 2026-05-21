#!/usr/bin/env bash
# Build libbbmtmobile (Go c-shared + libtss-ffi) for host and Android ABIs.
# Android: libbbmtmobile.so + dkls_jni (Bbmt* GG18 + Dkls*; no gomobile tss.aar).
# iOS: c-archive xcframework (Bbmt* + Dkls* via BbmtBridge).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}"

LIBTSS="$(cd "${ROOT}/../../libtss" && pwd)"
JNI_OUT="${ROOT}/../android/app/src/main/jniLibs"
CPP_DIR="${ROOT}/../android/app/src/main/cpp"
MIN_API="${MIN_API:-21}"

export CGO_ENABLED=1

info() { echo "==> $*"; }
warn() { echo "Warning: $*" >&2; }

resolve_ndk() {
  if [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "${ANDROID_NDK_HOME}" ]; then
    echo "${ANDROID_NDK_HOME}"
    return
  fi
  if [ -n "${ANDROID_HOME:-}" ] && [ -d "${ANDROID_HOME}/ndk" ]; then
    # Prefer highest numeric NDK (cargo-ndk needs r23+); skip legacy rc* folders.
    ls -d "${ANDROID_HOME}/ndk"/*/ 2>/dev/null \
      | sed 's:/*$::' \
      | grep -E '/ndk/[0-9]+\.' \
      | sort -t. -k1,1n -k2,2n -k3,3n \
      | tail -1
    return
  fi
  echo ""
}

ndk_prebuilt_host() {
  local ndk="$1"
  local dir="${ndk}/toolchains/llvm/prebuilt"
  if [ -d "${dir}/darwin-arm64" ]; then
    echo "darwin-arm64"
  elif [ -d "${dir}/darwin-x86_64" ]; then
    echo "darwin-x86_64"
  elif [ -d "${dir}/linux-x86_64" ]; then
    echo "linux-x86_64"
  else
    echo ""
  fi
}

build_host() {
  info "Building libtss-ffi (host)..."
  (cd "${LIBTSS}" && cargo build --release -p libtss-ffi)
  local host_lib="${LIBTSS}/target/release"
  mkdir -p bin
  export CGO_LDFLAGS="-L${host_lib} -llibtss_ffi -lm"
  if [ "$(uname -s)" = "Darwin" ]; then
    export CGO_LDFLAGS="${CGO_LDFLAGS} -framework Security -framework CoreFoundation"
  else
    export CGO_LDFLAGS="${CGO_LDFLAGS} -ldl -lpthread"
  fi
  info "Building bbmtmobile for host..."
  go build -buildmode=c-shared -o bin/libbbmtmobile ./bbmtmobile/
  cp -f bin/libbbmtmobile.h "${CPP_DIR}/libbbmtmobile.h" 2>/dev/null || true
  info "Host smoke test (fast unit + join-barrier; no LAN keygen)..."
  go test -count=1 -timeout 3m ./dkls/ -run 'TestHelloDkg|TestDKGAndSignInProcess|TestDKGAndSignInProcessTrio|TestRunDKGWithSenderInProcess|TestRunDKGWithSenderTrioInProcess|TestDedupe|TestRecvPeer|TestMerge|TestLanAwaitJoinersPartialTrio'
  if [ "${RUN_DKLS_LAN_INTEGRATION:-0}" = "1" ]; then
    info "LAN keygen integration (RUN_DKLS_LAN_INTEGRATION=1, may take ~15m)..."
    go test -count=1 -timeout 15m ./dkls/ -run 'TestLanJoinKeygenDuo$|TestLanJoinKeygenTrio$|TestLanJoinKeygenTrioDerivedSessionKey'
  fi
}

build_android_abi() {
  local abi="$1"
  local goarch="$2"
  local goarm="${3:-}"
  local clang_triple="$4"

  local ndk
  ndk="$(resolve_ndk)"
  if [ -z "${ndk}" ]; then
    warn "ANDROID_NDK_HOME / ANDROID_HOME not set; skip Android ${abi}"
    return 1
  fi
  local host
  host="$(ndk_prebuilt_host "${ndk}")"
  if [ -z "${host}" ]; then
    warn "Unknown NDK prebuilt host under ${ndk}"
    return 1
  fi

  local ffi_dir="${ROOT}/mobile-deps/libtss/android/${abi}"
  if [ ! -f "${ffi_dir}/liblibtss_ffi.a" ]; then
    ffi_dir="${LIBTSS}/jniLibs/${abi}"
  fi
  if [ ! -f "${ffi_dir}/liblibtss_ffi.a" ]; then
    warn "Missing liblibtss_ffi.a for ${abi} — run mobile-deps/libtss/build-libtss.sh"
    return 1
  fi

  local cc="${ndk}/toolchains/llvm/prebuilt/${host}/bin/${clang_triple}${MIN_API}-clang"
  if [ ! -x "${cc}" ]; then
    warn "Compiler not found: ${cc}"
    return 1
  fi

  info "Building bbmtmobile for Android ${abi}..."
  mkdir -p "${JNI_OUT}/${abi}"
  rm -f "${JNI_OUT}/${abi}/libdklsmobile.so"
  export GOOS=android
  export GOARCH="${goarch}"
  if [ -n "${goarm}" ]; then
    export GOARM="${goarm}"
  else
    unset GOARM 2>/dev/null || true
  fi
  export CC="${cc}"
  export CXX="${cc}++"
  export CGO_CFLAGS="-O2"
  # libtss-go #cgo android only adds -lm -llog; path to static FFI comes from here.
  export CGO_LDFLAGS="-L${ffi_dir} -l:liblibtss_ffi.a -lm -llog -landroid"

  go build -buildmode=c-shared -ldflags="-s -w" -o "${JNI_OUT}/${abi}/libbbmtmobile.so" ./bbmtmobile/

  if [ ! -f "${JNI_OUT}/${abi}/libbbmtmobile.so" ]; then
    warn "Build failed for ${abi}"
    return 1
  fi
  info "  -> ${JNI_OUT}/${abi}/libbbmtmobile.so"
}

build_android_jni_abi() {
  local abi="$1"
  local clang_triple="$2"

  local ndk
  ndk="$(resolve_ndk)"
  if [ -z "${ndk}" ]; then
    return 1
  fi
  local host
  host="$(ndk_prebuilt_host "${ndk}")"
  if [ -z "${host}" ]; then
    return 1
  fi

  local bbmt_dir="${JNI_OUT}/${abi}"
  local bbmt_so="${bbmt_dir}/libbbmtmobile.so"
  local bbmt_hdr="${bbmt_dir}/libbbmtmobile.h"
  if [ ! -f "${bbmt_so}" ]; then
    warn "Skip dkls_jni for ${abi}: missing libbbmtmobile.so"
    return 1
  fi
  if [ ! -f "${bbmt_hdr}" ]; then
    warn "Skip dkls_jni for ${abi}: missing libbbmtmobile.h (GoInt ABI must match ${abi})"
    return 1
  fi

  local cxx="${ndk}/toolchains/llvm/prebuilt/${host}/bin/${clang_triple}${MIN_API}-clang++"
  if [ ! -x "${cxx}" ]; then
    warn "C++ compiler not found: ${cxx}"
    return 1
  fi

  local out="${JNI_OUT}/${abi}/libdkls_jni.so"
  info "Building dkls_jni for Android ${abi}..."
  rm -f "${out}"
  # Per-ABI Go cgo header (GoInt32 on armeabi-v7a, GoInt64 on arm64/x86_64). Do not use cpp/libbbmtmobile.h alone.
  if ! "${cxx}" -shared -fPIC -O2 \
    -I"${bbmt_dir}" \
    -I"${CPP_DIR}" \
    "${CPP_DIR}/dkls_jni.cpp" \
    "${CPP_DIR}/bbmt_tss_jni.cpp" \
    -L"${bbmt_dir}" -lbbmtmobile \
    -llog -landroid \
    -Wl,-z,max-page-size=0x4000 \
    -o "${out}"; then
    warn "dkls_jni build failed for ${abi}"
    return 1
  fi
  info "  -> ${out}"
}

build_android() {
  info "Building libtss-ffi for Android (cargo-ndk)..."
  bash "${ROOT}/mobile-deps/libtss/build-libtss.sh"

  local ok=0
  build_android_abi arm64-v8a arm64 "" aarch64-linux-android && ok=1
  build_android_abi armeabi-v7a arm 7 armv7a-linux-androideabi && ok=1
  build_android_abi x86_64 amd64 "" x86_64-linux-android && ok=1

  if [ "${ok}" -eq 0 ]; then
    warn "No Android ABI built"
    return 1
  fi

  build_android_jni_abi arm64-v8a aarch64-linux-android
  build_android_jni_abi armeabi-v7a armv7a-linux-androideabi
  build_android_jni_abi x86_64 x86_64-linux-android

  # IDE convenience only (arm64); JNI builds use jniLibs/<abi>/libbbmtmobile.h above.
  if [ -f "${JNI_OUT}/arm64-v8a/libbbmtmobile.h" ]; then
    cp -f "${JNI_OUT}/arm64-v8a/libbbmtmobile.h" "${CPP_DIR}/libbbmtmobile.h"
  fi
}

build_ios() {
  if [ "$(uname -s)" != "Darwin" ]; then
    warn "iOS build skipped (not on macOS)"
    return 0
  fi
  # Unified GG18 + DKLs (single Go runtime). Do not link Tss.xcframework + libdklsmobile together.
  local bbmt_dir="${ROOT}/../ios/BbmtMobile"
  local dkls_dir="${ROOT}/../ios/DklsMobile"
  local ios_out="${ROOT}/mobile-deps/libtss/ios/device"
  local ios_sim_out="${ROOT}/mobile-deps/libtss/ios/sim"
  mkdir -p "${bbmt_dir}" "${dkls_dir}" "${ios_out}" "${ios_sim_out}"

  info "Building libtss-ffi for iOS device..."
  (cd "${LIBTSS}" && rustup target add aarch64-apple-ios 2>/dev/null || true)
  (cd "${LIBTSS}" && cargo build --release --target aarch64-apple-ios -p libtss-ffi)
  cp "${LIBTSS}/target/aarch64-apple-ios/release/liblibtss_ffi.a" "${ios_out}/"

  info "Building libtss-ffi for iOS simulator..."
  (cd "${LIBTSS}" && rustup target add aarch64-apple-ios-sim 2>/dev/null || true)
  (cd "${LIBTSS}" && cargo build --release --target aarch64-apple-ios-sim -p libtss-ffi)
  cp "${LIBTSS}/target/aarch64-apple-ios-sim/release/liblibtss_ffi.a" "${ios_sim_out}/"

  local device_a="${bbmt_dir}/libbbmtmobile-device.a"
  local sim_a="${bbmt_dir}/libbbmtmobile-sim.a"
  local headers_dir="${bbmt_dir}/headers"

  info "Building bbmtmobile (unified TSS+DKLs) for iOS device..."
  export CGO_LDFLAGS="-L${ios_out} -llibtss_ffi -lm -framework Security -framework CoreFoundation"
  export GOOS=ios
  export GOARCH=arm64
  export CC="$(xcrun --sdk iphoneos --find clang)"
  export CGO_CFLAGS="-isysroot $(xcrun --sdk iphoneos --show-sdk-path) -arch arm64 -miphoneos-version-min=13.0"
  go build -buildmode=c-archive -ldflags="-s -w" -o "${device_a}" ./bbmtmobile/

  info "Building bbmtmobile for iOS simulator..."
  export CGO_LDFLAGS="-L${ios_sim_out} -llibtss_ffi -lm -framework Security -framework CoreFoundation"
  export GOOS=ios
  export GOARCH=arm64
  export CC="$(xcrun --sdk iphonesimulator --find clang)"
  export CGO_CFLAGS="-isysroot $(xcrun --sdk iphonesimulator --show-sdk-path) -arch arm64 -mios-simulator-version-min=13.0"
  go build -buildmode=c-archive -ldflags="-s -w" -o "${sim_a}" ./bbmtmobile/

  if [ -f "${device_a%.a}.h" ]; then
    cp -f "${device_a%.a}.h" "${bbmt_dir}/libbbmtmobile_go.h"
    cp -f "${device_a%.a}.h" "${ROOT}/../ios/libbbmtmobile_go.h"
  fi

  mkdir -p "${headers_dir}"
  cp -f "${bbmt_dir}/libbbmtmobile_go.h" "${headers_dir}/"

  local device_merged="${bbmt_dir}/libbbmtmobile-merged-device.a"
  local sim_merged="${bbmt_dir}/libbbmtmobile-merged-sim.a"
  libtool -static -o "${device_merged}" "${device_a}" "${ios_out}/liblibtss_ffi.a"
  libtool -static -o "${sim_merged}" "${sim_a}" "${ios_sim_out}/liblibtss_ffi.a"

  rm -rf "${bbmt_dir}/libbbmtmobile.xcframework"
  xcodebuild -create-xcframework \
    -library "${device_merged}" -headers "${headers_dir}" \
    -library "${sim_merged}" -headers "${headers_dir}" \
    -output "${bbmt_dir}/libbbmtmobile.xcframework"

  cp -f "${device_merged}" "${bbmt_dir}/libbbmtmobile.a"

  # Legacy path (some docs/scripts); iOS app should use BbmtMobile only.
  cp -f "${bbmt_dir}/libbbmtmobile_go.h" "${dkls_dir}/libdklsmobile_go.h" 2>/dev/null || true

  info "iOS xcframework: ios/BbmtMobile/libbbmtmobile.xcframework (replaces Tss + libdklsmobile)"
}

main() {
  case "${1:-all}" in
    host) build_host ;;
    android) build_android ;;
    ios) build_ios ;;
    all)
      build_host
      build_android || warn "Android build incomplete"
      build_ios || warn "iOS build incomplete"
      ;;
    *)
      echo "Usage: $0 [host|android|ios|all]"
      exit 1
      ;;
  esac
  info "Done."
}

main "$@"
