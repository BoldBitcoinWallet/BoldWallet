#!/bin/bash

# Generate Signed Release Bundle (AAB) with 16KB alignment
# Usage: ./android/generate-signed-bundle.sh [keystore_password] [key_password]
#   Args override env; with neither, the script fails with usage below.
#   Prefer env vars (see android/BUILD-SECRETS.md) to keep secrets out of
#   shell history.
#
# VERSIONED FILE (see the .gitignore exception): must never contain secrets.

set -euo pipefail

echo "🔐 Generating Signed Release Bundle (AAB) with 16KB alignment..."

# Passwords: positional args if given, else environment. No defaults.
KEYSTORE_PASSWORD="${KEYSTORE_PASSWORD:-}"
KEY_PASSWORD="${KEY_PASSWORD:-}"
if [ $# -ge 1 ]; then KEYSTORE_PASSWORD="$1"; fi
if [ $# -ge 2 ]; then KEY_PASSWORD="$2"; fi
: "${KEYSTORE_PASSWORD:?Provide keystore password as \$1 or KEYSTORE_PASSWORD env var}"
: "${KEY_PASSWORD:?Provide key password as \$2 or KEY_PASSWORD env var}"

# Check if keystore exists
KEYSTORE_FILE="android/app/BoldBitcoinWallet.jks"
if [ ! -f "$KEYSTORE_FILE" ]; then
    echo "❌ Release keystore not found at: $KEYSTORE_FILE"
    echo "Please ensure your release keystore is in the correct location."
    exit 1
fi

echo "✅ Found release keystore: $KEYSTORE_FILE"

# Prompt for passwords if not provided
if [ -z "$KEYSTORE_PASSWORD" ]; then
    echo -n "Enter keystore password: "
    read -s KEYSTORE_PASSWORD
    echo
fi

if [ -z "$KEY_PASSWORD" ]; then
    echo -n "Enter key password: "
    read -s KEY_PASSWORD
    echo
fi

# Update gradle.properties with correct passwords
echo "🔧 Updating signing configuration..."
KEYSTORE_NAME=$(basename "$KEYSTORE_FILE")

# Create a temporary gradle.properties with correct passwords
cp android/gradle.properties android/gradle.properties.backup
cat > android/gradle.properties << EOF
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m
org.gradle.parallel=true
org.gradle.caching=true

android.useAndroidX=true
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64

newArchEnabled=true
hermesEnabled=true

VisionCamera_enableCodeScanner=false

# 16KB page size support
android.enableJetifier=true

MYAPP_UPLOAD_STORE_FILE=$KEYSTORE_NAME
MYAPP_UPLOAD_KEY_ALIAS=bbsr-key
MYAPP_UPLOAD_STORE_PASSWORD=$KEYSTORE_PASSWORD
MYAPP_UPLOAD_KEY_PASSWORD=$KEY_PASSWORD
EOF

echo "📱 Building signed release bundle..."
cd android

# Build the signed bundle (arm64-v8a Play AAB)
echo "🔨 Running bundleRelease (arm64-v8a)..."
./gradlew bundleRelease -PplayAbi=arm64-v8a -PreactNativeArchitectures=arm64-v8a

cd ..

# Restore original gradle.properties
mv android/gradle.properties.backup android/gradle.properties

# Check if bundle was created
BUNDLE_PATH="android/app/build/outputs/bundle/release/app-release.aab"
if [ ! -f "$BUNDLE_PATH" ]; then
    echo "❌ Signed bundle not found at: $BUNDLE_PATH"
    echo "Build might have failed. Check the logs above."
    exit 1
fi

echo "✅ Signed bundle created: $BUNDLE_PATH"

# Mapping + native debug symbols for the same versionCode
(cd android && bash scripts/copy-play-artifacts.sh)

# Apply 16KB alignment fix
echo "🔧 Applying 16KB alignment fix to signed bundle..."
ALIGNED_BUNDLE_PATH="android/app/build/outputs/bundle/release/app-release_16kb_aligned.aab"

python3 android/fix-elf-alignment.py "$BUNDLE_PATH"

# Check if aligned bundle was created
if [ -f "$ALIGNED_BUNDLE_PATH" ]; then
    echo "✅ 16KB aligned signed bundle created: $ALIGNED_BUNDLE_PATH"
    
    # Replace original with aligned version
    cp "$ALIGNED_BUNDLE_PATH" "$BUNDLE_PATH"
    echo "✅ Original bundle replaced with 16KB aligned version"
    
    # Verify alignment
    echo "🔍 Verifying 16KB alignment..."
    ./android/pageCheck.sh "$BUNDLE_PATH"
else
    echo "⚠️  Aligned bundle not found, checking original..."
    ./android/pageCheck.sh "$BUNDLE_PATH"
fi

# Display final information
echo ""
echo "🎉 Signed Release Bundle Generation Complete!"
echo "📁 Bundle location: $BUNDLE_PATH"
echo "📊 Bundle size: $(du -h "$BUNDLE_PATH" | cut -f1)"
echo ""
echo "✅ Ready for Google Play Store submission!"
echo "🔐 Bundle is properly signed with your release keystore"
echo "📱 Bundle supports 16KB page size (Android 15+ requirement)"
echo ""
echo "Next steps:"
echo "1. Upload the bundle to Google Play Console"
echo "2. Complete the release process in Play Console"
echo "3. Your app will be compliant with Android 15 requirements"