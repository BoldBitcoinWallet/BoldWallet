#!/usr/bin/env bash
# Copy mapping.txt + native-debug-symbols.zip next to the android/ tree for Play upload.
# Run from the android/ directory after a release minify build.
set -euo pipefail

VERSION_CODE=$(grep -o 'versionCode [0-9]*' app/build.gradle | grep -o '[0-9]*' | head -1)
MAPPING_FILE="app/build/outputs/mapping/release/mapping.txt"
if [ -f "$MAPPING_FILE" ]; then
  cp "$MAPPING_FILE" "mapping.txt"
  echo "Mapping: mapping.txt (upload with AAB versionCode ${VERSION_CODE})"
else
  echo "Warning: mapping.txt not found at ${MAPPING_FILE}" >&2
fi

NATIVE_SYMBOLS="app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip"
if [ -f "$NATIVE_SYMBOLS" ]; then
  cp "$NATIVE_SYMBOLS" "native-debug-symbols.zip"
  echo "Native symbols: native-debug-symbols.zip (same versionCode ${VERSION_CODE})"
else
  echo "Warning: native-debug-symbols.zip not found at ${NATIVE_SYMBOLS}" >&2
fi
