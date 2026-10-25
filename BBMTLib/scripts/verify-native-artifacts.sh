#!/usr/bin/env bash
# Post-build verification: ABI headers, JNI symbols, artifact presence,
# Go toolchain floor (F28-exp: CVE-2026-111943 needs go1.26.10+ in every .so).
set -euo pipefail

MIN_GO="1.26.10"

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

# ver_ge A B: true if dotted version A >= B (numeric per component).
ver_ge() {
  local IFS=.
  local i a b x y
  a=($1); b=($2)
  for i in 0 1 2; do
    x=$((10#${a[i]:-0})); y=$((10#${b[i]:-0}))
    if [ "${x}" -gt "${y}" ]; then return 0; fi
    if [ "${x}" -lt "${y}" ]; then return 1; fi
  done
  return 0
}

# F28-exp: every shipped .so must be built with go >= MIN_GO, and all ABIs
# must agree (no mixed toolchains). `go version -m` is authoritative.
command -v go >/dev/null 2>&1 || fail "go not on PATH (post-build env must have it)"
seen_versions=""
for abi in arm64-v8a armeabi-v7a x86_64; do
  so="${JNI_OUT}/${abi}/libbbmtmobile.so"
  goversion="$(go version -m "${so}" 2>/dev/null | head -1 | sed 's/.*: go//')"
  [ -n "${goversion}" ] || fail "${abi}: cannot read Go version from ${so}"
  ver_ge "${goversion}" "${MIN_GO}" || fail "${abi}: Go ${goversion} < ${MIN_GO} (rebuild with fixed toolchain)"
  seen_versions="${seen_versions} ${goversion}"
  pass "${abi} Go ${goversion}"
done
if [ "$(echo "${seen_versions}" | tr ' ' '\n' | sort -u | grep -c .)" -ne 1 ]; then
  fail "mixed Go versions across ABIs:${seen_versions}"
fi

validate_goint_abi armeabi-v7a 32
validate_goint_abi arm64-v8a 64
validate_goint_abi x86_64 64

bash "${CHECK_JNI}" "${JNI_OUT}/arm64-v8a/libdkls_jni.so"

xc="${ROOT}/../ios/BbmtMobile/libbbmtmobile.xcframework"
if [ -d "${xc}" ]; then
  pass "iOS libbbmtmobile.xcframework"
  # F28-exp: `go version -m` cannot read merged .a archives, so check
  # embedded toolchain strings instead: must contain the fixed version
  # and must not contain any vulnerable go1.26 single-patch version.
  for xc_a in "${xc}"/*/*.a; do
    [ -f "${xc_a}" ] || continue
    versions="$(strings "${xc_a}" | grep -oE "go1\.[0-9]+\.[0-9]+" | sort -u)"
    [ -n "${versions}" ] || fail "iOS $(basename "${xc_a}"): no Go strings (stale/wrong archive?)"
    for v in ${versions}; do
      ver_ge "${v#go}" "${MIN_GO}" \
        || fail "iOS $(basename "${xc_a}"): vulnerable ${v} strings present (rebuild with >= ${MIN_GO})"
    done
    pass "iOS $(basename "${xc_a}") Go strings OK (${versions})"
  done
else
  warn_msg="iOS xcframework not found (skip on Linux CI)"
  echo "  --  ${warn_msg}"
fi

echo ""
echo "Native artifact verification: PASS"
