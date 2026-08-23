#!/usr/bin/env bash
# Static Play Console packaging checks (features, locales, storage, R8, release artifacts).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="${ROOT}/android/app/src/main/AndroidManifest.xml"
GRADLE="${ROOT}/android/app/build.gradle"
PLAY_AAB_SH="${ROOT}/android/scripts/build-play-aab.sh"
PLAY_COPY_SH="${ROOT}/android/scripts/copy-play-artifacts.sh"

fail() {
  echo "Play manifest check failed: $*" >&2
  exit 1
}

[ -f "$MANIFEST" ] || fail "missing $MANIFEST"
[ -f "$GRADLE" ] || fail "missing $GRADLE"
[ -f "$PLAY_AAB_SH" ] || fail "missing $PLAY_AAB_SH"
[ -f "$PLAY_COPY_SH" ] || fail "missing $PLAY_COPY_SH"

for feature in \
  android.hardware.camera \
  android.hardware.camera.autofocus \
  android.hardware.camera.flash \
  android.hardware.camera.front \
  android.hardware.location \
  android.hardware.location.gps \
  android.hardware.wifi
do
  grep -q "android:name=\"${feature}\" android:required=\"false\"" "$MANIFEST" \
    || fail "uses-feature ${feature} must be required=false"
done

grep -q 'android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="32"' "$MANIFEST" \
  || fail "ACCESS_FINE_LOCATION must be maxSdkVersion 32"
grep -q 'android.permission.ACCESS_COARSE_LOCATION" android:maxSdkVersion="32"' "$MANIFEST" \
  || fail "ACCESS_COARSE_LOCATION must be maxSdkVersion 32"
grep -q 'android.permission.NEARBY_WIFI_DEVICES' "$MANIFEST" \
  || fail "NEARBY_WIFI_DEVICES missing"
grep -q 'android:usesPermissionFlags="neverForLocation"' "$MANIFEST" \
  || fail "NEARBY_WIFI_DEVICES must set neverForLocation"

for perm in READ_EXTERNAL_STORAGE WRITE_EXTERNAL_STORAGE; do
  grep -A2 "android.permission.${perm}" "$MANIFEST" | grep -q 'android:maxSdkVersion="32"' \
    || fail "${perm} must be maxSdkVersion 32"
done

grep -q 'resConfigs "en"' "$GRADLE" || fail 'build.gradle must set resConfigs "en"'
grep -q 'proguard-android-optimize.txt' "$GRADLE" \
  || fail "release must use proguard-android-optimize.txt"
grep -q "debugSymbolLevel 'SYMBOL_TABLE'" "$GRADLE" \
  || fail "release must set ndk.debugSymbolLevel SYMBOL_TABLE"
grep -q 'bundleRelease' "$PLAY_AAB_SH" || fail "build-play-aab.sh must run bundleRelease"
grep -q 'playAbi=arm64-v8a' "$PLAY_AAB_SH" || fail "Play AAB must be arm64-v8a"
grep -q 'native-debug-symbols.zip' "$PLAY_COPY_SH" \
  || fail "copy-play-artifacts.sh must copy native symbols"

grep -q 'android.intent.category.LAUNCHER' "$MANIFEST" \
  || fail "LAUNCHER category missing"
MAIN_BLOCK="$(awk '/android:name=".MainActivity"/,/<\/activity>/' "$MANIFEST")"
echo "$MAIN_BLOCK" | grep -q 'android.intent.category.LAUNCHER' \
  && fail "MainActivity must not declare LAUNCHER (use activity-alias)"
grep -q 'android:name=".DefaultIconActivity"' "$MANIFEST" \
  || fail "DefaultIconActivity alias missing"
grep -q 'android:name=".DefaultIconActivity"' "$MANIFEST" \
  && grep -A8 'android:name=".DefaultIconActivity"' "$MANIFEST" | grep -q 'android:enabled="true"' \
  || fail "DefaultIconActivity must be enabled by default"

echo "Play Console packaging check OK"
echo ""
echo "Device QA before Play promote:"
echo "  - LAN NSD pair on API 29, 32, and 34+"
echo "  - Camera QR still prompts only when used"
echo "  - GG18 + DKLS keygen/sign on this minify+shrink build"
echo "  - F-Droid/unsigned path still builds (no Play Integrity library)"
