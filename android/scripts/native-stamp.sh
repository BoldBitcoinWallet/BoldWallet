#!/usr/bin/env bash
# F28 build-integrity stamp: proves android/app/src/main/jniLibs/<abi>/*.so
# were built from the current in-repo sources by BBMTLib/build-dkls.sh android.
#
# HAZARD (Wave 4 incident): jniLibs/*.so are gitignored local artifacts and gradle
# never rebuilds them (no externalNativeBuild path wiring; android/app/CMakeLists.txt
# is inert). Editing cpp/ or Go sources without re-running build-dkls.sh android
# silently ships stale native code. This stamp makes that a fail-fast build error.
#
# Usage:
#   native-stamp.sh write <abi>...   # build-dkls.sh after a successful Android build
#   native-stamp.sh verify            # gradle verifyDklsNativeStamp + local checks
#   native-stamp.sh selftest          # CI logic test (shadow tree, no NDK/Go/.so needed)
#   native-stamp.sh check-dirs        # Go available: GO_DIRS still covers ./bbmtmobile deps?
#
# BLIND SPOTS (hashed nowhere; documented residual):
#   - ../../libtss/libtss-go (go.mod replace target, outside this repo)
#   - liblibtss_ffi.a (cargo-ndk output, outside this repo)
#   - NDK revision (recorded informationally; warn-only on mismatch)
#   - iOS libbbmtmobile.xcframework (same staleness class; future F28-iOS work)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CPP_DIR="${NATIVE_STAMP_CPP_DIR:-${REPO_ROOT}/android/app/src/main/cpp}"
JNI_OUT="${NATIVE_STAMP_JNI_OUT:-${REPO_ROOT}/android/app/src/main/jniLibs}"
BBMTLIB="${NATIVE_STAMP_BBMTLIB:-${REPO_ROOT}/BBMTLib}"
STAMP_FILE="${NATIVE_STAMP_FILE:-${REPO_ROOT}/android/app/native-srcstamp.txt}"
BUILD_SCRIPT="${BBMTLIB}/build-dkls.sh"

STAMP_VERSION=1
CANON_ABIS="arm64-v8a armeabi-v7a x86_64"
# Exact in-repo packages linked into ./bbmtmobile (go list -deps ./bbmtmobile/).
# If bbmtmobile gains a new in-repo import, add its dir here or the stamp misses it.
GO_DIRS="bbmtmobile dkls internal/cstrwipe internal/keyhandles tss tss/nostrtransport"

fail() { echo "NATIVE-STAMP FAIL: $*" >&2; exit 1; }
info() { echo "==> $*"; }

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "need sha256sum or shasum"
  fi
}

# Hash of a file list: sorted per-file hashes, then hashed. Stable across machines.
hash_file_list() {
  local list_file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sort "${list_file}" | sha256sum | awk '{print $1}'
  else
    sort "${list_file}" | shasum -a 256 | awk '{print $1}'
  fi
}

compute_go_src() {
  local tmp="$1"
  : > "${tmp}"
  local d f
  for d in ${GO_DIRS}; do
    [ -d "${BBMTLIB}/${d}" ] || fail "missing Go dir ${BBMTLIB}/${d}"
    while IFS= read -r f; do
      echo "$(sha256_file "${f}")  ${f#${BBMTLIB}/}" >> "${tmp}"
    done < <(find "${BBMTLIB}/${d}" -name '*.go' ! -name '*_test.go' -type f | sort)
  done
  for f in go.mod go.sum; do
    [ -f "${BBMTLIB}/${f}" ] || fail "missing ${BBMTLIB}/${f}"
    echo "$(sha256_file "${BBMTLIB}/${f}")  ${f}" >> "${tmp}"
  done
  hash_file_list "${tmp}"
}

compute_cpp_src() {
  local tmp="$1"
  : > "${tmp}"
  [ -d "${CPP_DIR}" ] || fail "missing cpp dir ${CPP_DIR}"
  local f
  while IFS= read -r f; do
    echo "$(sha256_file "${f}")  ${f#${CPP_DIR}/}" >> "${tmp}"
  done < <(find "${CPP_DIR}" -type f | sort)
  hash_file_list "${tmp}"
}

ndk_rev() {
  local ndk="${ANDROID_NDK_HOME:-${ANDROID_HOME:-}/ndk-bundle}"
  if [ -f "${ndk}/source.properties" ]; then
    grep -o 'Pkg.Revision = .*' "${ndk}/source.properties" | head -1 | sed 's/Pkg.Revision = //'
  else
    echo "unknown"
  fi
}

cmd_write() {
  [ "$#" -ge 1 ] || fail "write needs at least one ABI"
  local abi
  for abi in "$@"; do
    [ -f "${JNI_OUT}/${abi}/libbbmtmobile.so" ] || fail "missing ${JNI_OUT}/${abi}/libbbmtmobile.so (build incomplete?)"
    [ -f "${JNI_OUT}/${abi}/libdkls_jni.so" ] || fail "missing ${JNI_OUT}/${abi}/libdkls_jni.so (build incomplete?)"
    [ -f "${JNI_OUT}/${abi}/libbbmtmobile.h" ] || fail "missing ${JNI_OUT}/${abi}/libbbmtmobile.h (build incomplete?)"
  done
  local tmp
  tmp="$(mktemp)"
  local go_src cpp_src script_sha
  go_src="$(compute_go_src "${tmp}.go")"
  cpp_src="$(compute_cpp_src "${tmp}.cpp")"
  script_sha="$(sha256_file "${BUILD_SCRIPT}")"
  {
    echo "# F28 native stamp. Written by BBMTLib/build-dkls.sh android. DO NOT EDIT."
    echo "# Asserts jniLibs/*.so match in-repo sources. See android/scripts/native-stamp.sh."
    echo "stamp_version=${STAMP_VERSION}"
    echo "abis=$(printf '%s\n' "$@" | sort | tr '\n' ' ' | sed 's/ $//')"
    echo "go_src=${go_src}"
    echo "cpp_src=${cpp_src}"
    echo "build_script=${script_sha}"
    echo "ndk_rev=$(ndk_rev)"
    for abi in "$@"; do
      echo "hdr_${abi}=$(sha256_file "${JNI_OUT}/${abi}/libbbmtmobile.h")"
    done
  } > "${tmp}.stamp"
  mv -f "${tmp}.stamp" "${STAMP_FILE}"
  rm -f "${tmp}" "${tmp}.go" "${tmp}.cpp"
  info "native stamp written: ${STAMP_FILE} (abis: $*)"
}

cmd_verify() {
  [ -f "${STAMP_FILE}" ] || fail "missing ${STAMP_FILE} — run BBMTLib/build-dkls.sh android, then retry the gradle build"
  local ver abis go_src cpp_src script_sha
  ver="$(grep '^stamp_version=' "${STAMP_FILE}" | cut -d= -f2)"
  [ "${ver}" = "${STAMP_VERSION}" ] || fail "stamp version ${ver} != ${STAMP_VERSION} — re-run BBMTLib/build-dkls.sh android"
  abis="$(grep '^abis=' "${STAMP_FILE}" | cut -d= -f2)"
  local abi
  for abi in ${CANON_ABIS}; do
    echo " ${abis} " | grep -q " ${abi} " || fail "stamp covers only [${abis}] — partial build; re-run BBMTLib/build-dkls.sh android for all ABIs (${CANON_ABIS})"
    [ -f "${JNI_OUT}/${abi}/libbbmtmobile.so" ] || fail "missing ${JNI_OUT}/${abi}/libbbmtmobile.so — re-run BBMTLib/build-dkls.sh android"
    [ -f "${JNI_OUT}/${abi}/libdkls_jni.so" ] || fail "missing ${JNI_OUT}/${abi}/libdkls_jni.so — re-run BBMTLib/build-dkls.sh android"
  done
  local tmp
  tmp="$(mktemp)"
  go_src="$(compute_go_src "${tmp}.go")"
  cpp_src="$(compute_cpp_src "${tmp}.cpp")"
  script_sha="$(sha256_file "${BUILD_SCRIPT}")"
  rm -f "${tmp}" "${tmp}.go" "${tmp}.cpp"
  [ "$(grep '^go_src=' "${STAMP_FILE}" | cut -d= -f2)" = "${go_src}" ] \
    || fail "Go sources changed since native build — re-run BBMTLib/build-dkls.sh android"
  [ "$(grep '^cpp_src=' "${STAMP_FILE}" | cut -d= -f2)" = "${cpp_src}" ] \
    || fail "cpp sources changed since native build — re-run BBMTLib/build-dkls.sh android"
  [ "$(grep '^build_script=' "${STAMP_FILE}" | cut -d= -f2)" = "${script_sha}" ] \
    || fail "build-dkls.sh changed since native build — re-run BBMTLib/build-dkls.sh android"
  for abi in ${CANON_ABIS}; do
    local want hdr
    want="$(grep "^hdr_${abi}=" "${STAMP_FILE}" | cut -d= -f2)"
    hdr="$(sha256_file "${JNI_OUT}/${abi}/libbbmtmobile.h")"
    [ "${want}" = "${hdr}" ] || fail "per-ABI header jniLibs/${abi}/libbbmtmobile.h changed — re-run BBMTLib/build-dkls.sh android"
  done
  local stamp_ndk
  stamp_ndk="$(grep '^ndk_rev=' "${STAMP_FILE}" | cut -d= -f2)"
  if [ "${stamp_ndk}" != "$(ndk_rev)" ]; then
    echo "NATIVE-STAMP WARN: NDK rev differs (stamp: ${stamp_ndk}, now: $(ndk_rev)) — informational only" >&2
  fi
  info "native stamp OK (abis: ${abis})"
}

cmd_selftest() {
  local shadow
  shadow="$(mktemp -d)"
  trap 'rm -rf "${shadow}"' EXIT
  export NATIVE_STAMP_CPP_DIR="${shadow}/cpp"
  export NATIVE_STAMP_JNI_OUT="${shadow}/jniLibs"
  export NATIVE_STAMP_BBMTLIB="${shadow}/bbmtlib"
  export NATIVE_STAMP_FILE="${shadow}/stamp.txt"
  mkdir -p "${NATIVE_STAMP_CPP_DIR}" "${NATIVE_STAMP_BBMTLIB}/bbmtmobile" \
    "${NATIVE_STAMP_BBMTLIB}/dkls" "${NATIVE_STAMP_BBMTLIB}/internal/cstrwipe" \
    "${NATIVE_STAMP_BBMTLIB}/internal/keyhandles" "${NATIVE_STAMP_BBMTLIB}/tss" \
    "${NATIVE_STAMP_BBMTLIB}/tss/nostrtransport"
  echo "int x;" > "${NATIVE_STAMP_CPP_DIR}/a.cpp"
  for d in ${GO_DIRS}; do echo "package x" > "${NATIVE_STAMP_BBMTLIB}/${d}/x.go"; done
  echo "module m" > "${NATIVE_STAMP_BBMTLIB}/go.mod"
  echo "sums" > "${NATIVE_STAMP_BBMTLIB}/go.sum"
  echo "build" > "${NATIVE_STAMP_BBMTLIB}/build-dkls.sh"
  local abi
  for abi in ${CANON_ABIS}; do
    mkdir -p "${NATIVE_STAMP_JNI_OUT}/${abi}"
    echo "so" > "${NATIVE_STAMP_JNI_OUT}/${abi}/libbbmtmobile.so"
    echo "jni" > "${NATIVE_STAMP_JNI_OUT}/${abi}/libdkls_jni.so"
    echo "hdr" > "${NATIVE_STAMP_JNI_OUT}/${abi}/libbbmtmobile.h"
  done
  local self="$0"
  bash "${self}" write ${CANON_ABIS} >/dev/null || fail "selftest: write failed"
  bash "${self}" verify >/dev/null || fail "selftest: verify-after-write failed"
  echo "tamper" >> "${NATIVE_STAMP_CPP_DIR}/a.cpp"
  if bash "${self}" verify >/dev/null 2>&1; then fail "selftest: cpp tamper not detected"; fi
  echo "int x;" > "${NATIVE_STAMP_CPP_DIR}/a.cpp"
  echo "tamper" >> "${NATIVE_STAMP_BBMTLIB}/tss/x.go"
  if bash "${self}" verify >/dev/null 2>&1; then fail "selftest: Go tamper not detected"; fi
  rm -f "${NATIVE_STAMP_FILE}"
  if bash "${self}" verify >/dev/null 2>&1; then fail "selftest: missing stamp not detected"; fi
  bash "${self}" write arm64-v8a >/dev/null || fail "selftest: partial write failed"
  if bash "${self}" verify >/dev/null 2>&1; then fail "selftest: partial-ABI stamp not detected"; fi
  trap - EXIT
  rm -rf "${shadow}"
  info "native stamp selftest: PASS"
}

cmd_check_dirs() {
  command -v go >/dev/null 2>&1 || fail "check-dirs needs Go on PATH"
  local module deps d missing=0
  module="$(awk '/^module /{print $2}' "${BBMTLIB}/go.mod")"
  deps="$(cd "${BBMTLIB}" && go list -deps ./bbmtmobile/ 2>/dev/null | grep "^${module}/" | sed "s#^${module}/##" | sort -u)"
  [ -n "${deps}" ] || fail "check-dirs: empty dep list (libtss checkout missing?)"
  for d in ${deps}; do
    echo " ${GO_DIRS} " | grep -q " ${d} " || { echo "GO_DIRS missing linked package: ${d}" >&2; missing=1; }
  done
  [ "${missing}" -eq 0 ] || fail "GO_DIRS drift — update android/scripts/native-stamp.sh"
  info "GO_DIRS covers all linked in-repo packages"
}

case "${1:-}" in
  write) shift; cmd_write "$@" ;;
  verify) cmd_verify ;;
  selftest) cmd_selftest ;;
  check-dirs) cmd_check_dirs ;;
  *) echo "usage: $0 {write <abi>...|verify|selftest|check-dirs}" >&2; exit 1 ;;
esac
