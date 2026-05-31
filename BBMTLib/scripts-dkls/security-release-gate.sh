#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT_DIR}"

echo "==> Security release gate: sensitive log scan"
bash ".github/scripts/check-sensitive-logs.sh"

echo "==> Security release gate: pinned libtss revision check"
EXPECTED_REF="$(sed -n 's/^LIBTSS_REF_EXPECTED=\"\(.*\)\"$/\1/p' BBMTLib/mobile-deps/libtss/build-libtss.sh)"
ACTUAL_REF="$(git -C ../libtss rev-parse HEAD)"
if [ -z "${EXPECTED_REF}" ] || [ "${ACTUAL_REF}" != "${EXPECTED_REF}" ]; then
  echo "Pinned libtss mismatch: expected ${EXPECTED_REF}, got ${ACTUAL_REF}" >&2
  exit 1
fi

echo "==> Security release gate: MPC package tests"
(cd BBMTLib && go test ./tss/... ./dkls/...)

echo "==> Security release gate passed"
