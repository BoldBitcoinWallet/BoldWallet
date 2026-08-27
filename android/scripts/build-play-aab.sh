#!/usr/bin/env bash
# Play App Bundle: arm64-v8a only (matches Play listing + 16 KB pages).
# Run from the android/ directory after assembleRelease (or standalone).
set -euo pipefail

./gradlew bundleRelease -PplayAbi=arm64-v8a -PreactNativeArchitectures=arm64-v8a

AAB_PATH="app/build/outputs/bundle/release/app-release.aab"
if [ ! -f "$AAB_PATH" ]; then
  echo "Play AAB not found at ${AAB_PATH}" >&2
  exit 1
fi
cp "$AAB_PATH" "app-release.aab"
echo "Play AAB: ${AAB_PATH}"
echo "Copied to: app-release.aab"
