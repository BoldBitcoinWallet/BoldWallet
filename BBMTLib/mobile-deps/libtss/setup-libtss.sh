#!/usr/bin/env bash
# Prepare pinned libtss checkout beside BoldWallet for BBMTLib CGO builds.
set -euo pipefail

BBMTLIB_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIBTSS_DIR="${LIBTSS_DIR:-$(cd "${BBMTLIB_ROOT}/../.." && pwd)/libtss}"
LIBTSS_REF="${LIBTSS_REF:-7a712f345b710f98e7f7a26582427ad814852a63}"
LIBTSS_REPO="${LIBTSS_REPO:-https://github.com/BoldBitcoinWallet/libtss.git}"

info() { echo "==> $*"; }

if [ ! -d "${LIBTSS_DIR}/.git" ]; then
  info "Cloning libtss into ${LIBTSS_DIR}"
  rm -rf "${LIBTSS_DIR}"
  git clone --recurse-submodules "${LIBTSS_REPO}" "${LIBTSS_DIR}"
fi

info "Checking out pinned libtss revision ${LIBTSS_REF}"
git -C "${LIBTSS_DIR}" fetch --tags --force origin
git -C "${LIBTSS_DIR}" checkout "${LIBTSS_REF}"
git -C "${LIBTSS_DIR}" submodule update --init --recursive
ACTUAL_REF="$(git -C "${LIBTSS_DIR}" rev-parse HEAD)"
if [ "${ACTUAL_REF}" != "${LIBTSS_REF}" ]; then
  echo "ERROR: libtss revision mismatch: got ${ACTUAL_REF}, expected ${LIBTSS_REF}" >&2
  exit 1
fi

test -f "${LIBTSS_DIR}/libtss-go/go.mod"
grep -q "DerivePathWithChainCode" "${LIBTSS_DIR}/libtss-go/tss/derive.go"
info "libtss is ready at ${LIBTSS_DIR} (${ACTUAL_REF})"
