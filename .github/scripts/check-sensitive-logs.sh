#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT_DIR}"

PATTERN='raw_json=|sessionID=%s, sessionKey=%s|fullNonce=%s|peerNonce=%s|Input [0-9]+ sighash:|PSBT_JSON:|runNostrPreAgreement.*nonce:'

echo "Running sensitive log regression scan..."
if git ls-files -z \
  BBMTLib \
  ios \
  android \
  ':!:**/*.md' \
  ':!:.github/scripts/check-sensitive-logs.sh' \
  ':!:BBMTLib/tss/logs.go' |
  xargs -0 grep -n -E "${PATTERN}"; then
  echo ""
  echo "Sensitive log pattern found. Remove or redact before merging."
  exit 1
fi

echo "Sensitive log scan passed."
