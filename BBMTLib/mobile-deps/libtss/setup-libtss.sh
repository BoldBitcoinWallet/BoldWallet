#!/usr/bin/env bash
# Prepare pinned libtss checkout beside BoldWallet for BBMTLib CGO builds.
set -euo pipefail

BBMTLIB_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIBTSS_DIR="${LIBTSS_DIR:-$(cd "${BBMTLIB_ROOT}/../.." && pwd)/libtss}"
LIBTSS_REF="${LIBTSS_REF:-ae1f891ee2dd67b6e841eaf673f7a1c0e8040815}"
PATCH_FILE="${BBMTLIB_ROOT}/mobile-deps/libtss/derive-path-with-chain-code.patch"

info() { echo "==> $*"; }

if [ ! -d "${LIBTSS_DIR}/.git" ]; then
  info "Cloning libtss into ${LIBTSS_DIR}"
  rm -rf "${LIBTSS_DIR}"
  git clone https://github.com/0xCarbon/libtss.git "${LIBTSS_DIR}"
fi

info "Checking out pinned libtss revision ${LIBTSS_REF}"
git -C "${LIBTSS_DIR}" fetch --tags --force origin
git -C "${LIBTSS_DIR}" checkout "${LIBTSS_REF}"
ACTUAL_REF="$(git -C "${LIBTSS_DIR}" rev-parse HEAD)"
if [ "${ACTUAL_REF}" != "${LIBTSS_REF}" ]; then
  echo "ERROR: libtss revision mismatch: got ${ACTUAL_REF}, expected ${LIBTSS_REF}" >&2
  exit 1
fi

if ! grep -q "DerivePathWithChainCode" "${LIBTSS_DIR}/libtss-go/tss/derive.go"; then
  info "Applying derive-path-with-chain-code patch"
  git -C "${LIBTSS_DIR}" apply "${PATCH_FILE}"
fi

test -f "${LIBTSS_DIR}/libtss-go/go.mod"
grep -q "DerivePathWithChainCode" "${LIBTSS_DIR}/libtss-go/tss/derive.go"
info "libtss is ready at ${LIBTSS_DIR} (${ACTUAL_REF})"
