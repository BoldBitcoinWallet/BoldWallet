#!/usr/bin/env bash
# Post-build verification: ABI headers, JNI symbols, artifact presence.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JNI_OUT="${ROOT}/../android/app/src/main/jniLibs"
CPP_DIR="${ROOT}/../android/app/src/main/cpp"
CHECK_JNI="${ROOT}/../android/scripts/check-jni-exports.sh"

info() { echo "==> $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "  OK  $*"; }

validate_goint_abi() {
  local abi="$1"
  local pointer_bits="$2"
  local hdr="${JNI_OUT}/${abi}/libbbmtmobile.h"
  [ -f "${hdr}" ] || fail "missing ${hdr}"

  if [ "${pointer_bits}" = "32" ]; then
    grep -q 'typedef GoInt32 GoInt;' "${hdr}" || fail "${abi}: expected GoInt32"
    if grep -q '_check_for_64_bit_pointer_matching_GoInt' "${hdr}"; then
      fail "${abi}: header has 64-bit GoInt check (wrong ABI)"
    fi
  else
    grep -q 'typedef GoInt64 GoInt;' "${hdr}" || fail "${abi}: expected GoInt64"
    grep -q '_check_for_64_bit_pointer_matching_GoInt' "${hdr}" || fail "${abi}: missing 64-bit GoInt check"
  fi
  pass "${abi} GoInt ABI (${pointer_bits}-bit)"
}

info "Verifying native artifacts"
[ -f "${CHECK_JNI}" ] || fail "missing check-jni-exports.sh"

for abi in arm64-v8a armeabi-v7a x86_64; do
  so="${JNI_OUT}/${abi}/libbbmtmobile.so"
  jni="${JNI_OUT}/${abi}/libdkls_jni.so"
  [ -f "${so}" ] || fail "missing ${so}"
  [ -f "${jni}" ] || fail "missing ${jni}"
  pass "${abi} libbbmtmobile.so + libdkls_jni.so"
done

validate_goint_abi armeabi-v7a 32
validate_goint_abi arm64-v8a 64
validate_goint_abi x86_64 64

bash "${CHECK_JNI}" "${JNI_OUT}/arm64-v8a/libdkls_jni.so"

xc="${ROOT}/../ios/BbmtMobile/libbbmtmobile.xcframework"
if [ -d "${xc}" ]; then
  pass "iOS libbbmtmobile.xcframework"
else
  warn_msg="iOS xcframework not found (skip on Linux CI)"
  echo "  --  ${warn_msg}"
fi

echo ""
echo "Native artifact verification: PASS"
