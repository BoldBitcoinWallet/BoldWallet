#!/usr/bin/env bash
# Fail if JNI exports are duplicated across dkls_jni.cpp / bbmt_tss_jni.cpp.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CPP="${ROOT}/android/app/src/main/cpp"
JNI_SO="${1:-}"

symbols="$(grep -hro 'Java_com_boldwallet_DklsNative_[A-Za-z0-9_]*' \
  "${CPP}/dkls_jni.cpp" "${CPP}/bbmt_tss_jni.cpp" 2>/dev/null | sort)"

dupes="$(echo "${symbols}" | uniq -d || true)"
if [ -n "${dupes}" ]; then
  echo "Duplicate JNI symbols:" >&2
  echo "${dupes}" >&2
  exit 1
fi

symbol_count="$(echo "${symbols}" | grep -c . || echo 0)"

required=(
  Java_com_boldwallet_DklsNative_bbmtCancelNostrMpcJni
  Java_com_boldwallet_DklsNative_bbmtPsbtIdentityHashJni
  Java_com_boldwallet_DklsNative_cancelNostrMpcJni
)

for sym in "${required[@]}"; do
  if ! echo "${symbols}" | grep -qx "${sym}"; then
    echo "Missing JNI export: ${sym}" >&2
    exit 1
  fi
done

if [ -n "${JNI_SO}" ] && [ -f "${JNI_SO}" ]; then
  for sym in "${required[@]}"; do
    if ! nm -D "${JNI_SO}" 2>/dev/null | grep -q " T ${sym}$"; then
      echo "Symbol not exported in ${JNI_SO}: ${sym}" >&2
      exit 1
    fi
  done
fi

echo "JNI export check OK (${symbol_count} symbols, no duplicates)"
