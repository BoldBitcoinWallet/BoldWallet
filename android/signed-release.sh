#!/bin/bash
set -euo pipefail

# Script to automate generating a release APK for React Native
# Place this in the 'android' folder and run it using `./generate-apk.sh`
#
# VERSIONED FILE (see the .gitignore exception): must never contain secrets.
# Passwords come from the environment; see android/BUILD-SECRETS.md.

# Keystore details (modify these with your own values)
KEYSTORE_FILE="BoldBitcoinWallet.jks"
KEY_ALIAS="bbsr-key"

: "${KEYSTORE_PASSWORD:?Set KEYSTORE_PASSWORD in the environment (see android/BUILD-SECRETS.md).}"
: "${KEY_PASSWORD:?Set KEY_PASSWORD in the environment (see android/BUILD-SECRETS.md).}"

# Paths
KEYSTORE_PATH="app/$KEYSTORE_FILE"
RELEASE_PROPERTIES_PATH="release.properties"

echo -e "--- Starting React Native APK Release Build Automation (PRODUCTION) ---"
echo -e "⚠️  This script uses PRODUCTION credentials for official releases."

# Detect build environment and use appropriate Gradle properties
# Priority: local > docker-linux > docker-macos (default)
if [ -f "gradle.properties.local" ] && [ ! -f "/.dockerenv" ] && [ -z "${DOCKER_BUILD:-}" ]; then
    # Local build - use most aggressive settings
    echo -e "📦 Detected local build - using gradle.properties.local (optimized for native performance)"
    if [ -f "gradle.properties" ]; then
        cp gradle.properties gradle.properties.docker.backup 2>/dev/null || true
    fi
    cp gradle.properties.local gradle.properties
    RESTORE_PROPERTIES=true
elif [ -f "gradle.properties.docker-linux" ] && [ -n "${DOCKER_BUILD:-}" ] && [ "${DOCKER_HOST_OS:-}" = "linux" ]; then
    # Docker on Linux host - use aggressive settings (no QEMU)
    echo -e "🐳🐧 Detected Docker on Linux host - using gradle.properties.docker-linux (native build, no QEMU)"
    if [ -f "gradle.properties" ]; then
        cp gradle.properties gradle.properties.docker.backup 2>/dev/null || true
    fi
    cp gradle.properties.docker-linux gradle.properties
    RESTORE_PROPERTIES=true
else
    # Docker on macOS host (QEMU) or default - use conservative settings
    echo -e "🐳🍎 Using Docker build settings (gradle.properties - optimized for QEMU/macOS)"
    RESTORE_PROPERTIES=false
fi

# Step 1: Generate Keystore if it doesn't exist
if [ ! -f "$KEYSTORE_PATH" ]; then
    echo -e "⚠️  WARNING: Production keystore not found!"
    echo -e "⚠️  Generating new keystore - this should only happen once!"
    keytool -genkey -v -keystore "$KEYSTORE_PATH" \
        -keyalg RSA -keysize 2048 -validity 10000 -alias "$KEY_ALIAS" \
        -storepass "$KEYSTORE_PASSWORD" -keypass "$KEY_PASSWORD"

    echo -e "✅ Production keystore generated at: $KEYSTORE_PATH"
else
    echo -e "✅ Production keystore found."
fi

# Step 2: Update release.properties with Production Keystore credentials
# This file is in .gitignore, so credentials won't be committed
if [ ! -f "$RELEASE_PROPERTIES_PATH" ]; then
    echo -e "Creating release.properties file..."
    touch "$RELEASE_PROPERTIES_PATH"
fi

# Function to update or add property
update_property() {
    local key=$1
    local value=$2
    if grep -q "^${key}=" "$RELEASE_PROPERTIES_PATH"; then
        # Update existing property
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s|^${key}=.*|${key}=${value}|" "$RELEASE_PROPERTIES_PATH"
        else
            # Linux
            sed -i "s|^${key}=.*|${key}=${value}|" "$RELEASE_PROPERTIES_PATH"
        fi
        echo -e "Updated ${key} in release.properties"
    else
        # Add new property
        echo "${key}=${value}" >> "$RELEASE_PROPERTIES_PATH"
        echo -e "Added ${key} to release.properties"
    fi
}

echo -e "Updating PRODUCTION keystore configuration in release.properties..."
update_property "MYAPP_UPLOAD_STORE_FILE" "$KEYSTORE_PATH"
update_property "MYAPP_UPLOAD_KEY_ALIAS" "$KEY_ALIAS"
update_property "MYAPP_UPLOAD_STORE_PASSWORD" "$KEYSTORE_PASSWORD"
update_property "MYAPP_UPLOAD_KEY_PASSWORD" "$KEY_PASSWORD"

restore_gradle_properties() {
    if [ "${RESTORE_PROPERTIES:-false}" = true ] && [ -f "gradle.properties.docker.backup" ]; then
        mv gradle.properties.docker.backup gradle.properties
        echo -e "📦 Restored gradle.properties (Docker settings)"
    fi
}

echo -e ""
echo -e "--- Play Console packaging check ---"
if ! bash scripts/check-play-manifest.sh; then
    restore_gradle_properties
    exit 1
fi

# Step 3: Build the Release APK (sideload / F-Droid, multi-ABI)
echo -e "Building the Release APK..."
# ./gradlew clean
./gradlew assembleRelease
ASSEMBLE_STATUS=$?
if [ $ASSEMBLE_STATUS -ne 0 ]; then
    restore_gradle_properties
    exit $ASSEMBLE_STATUS
fi

# Step 4: Locate and display APK
APK_PATH="app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
    echo -e "❌ Build failed! APK not found at: $APK_PATH"
    restore_gradle_properties
    exit 1
fi

echo -e "✅ Build successful! APK located at: $APK_PATH"

# Play AAB is arm64-v8a only (matches current Play listing + 16 KB pages).
echo -e ""
echo -e "Building the Play App Bundle (arm64-v8a)..."
if ! bash scripts/build-play-aab.sh; then
    restore_gradle_properties
    exit 1
fi
echo -e "✅ Play AAB copied to: app-release.aab (upload this to Play Console)"

restore_gradle_properties

# Step 5: Verify APK Signature
echo -e ""
echo -e "--- Verifying APK Signature ---"

# Find apksigner tool (try common locations)
APKSIGNER=""
if [ -n "$ANDROID_HOME" ]; then
    # Try to find the latest build-tools version
    BUILD_TOOLS_DIR="$ANDROID_HOME/build-tools"
    if [ -d "$BUILD_TOOLS_DIR" ]; then
        LATEST_VERSION=$(ls -1 "$BUILD_TOOLS_DIR" | sort -V | tail -1)
        if [ -n "$LATEST_VERSION" ] && [ -f "$BUILD_TOOLS_DIR/$LATEST_VERSION/apksigner" ]; then
            APKSIGNER="$BUILD_TOOLS_DIR/$LATEST_VERSION/apksigner"
        fi
    fi
fi

# Fallback: try common paths
if [ -z "$APKSIGNER" ] || [ ! -f "$APKSIGNER" ]; then
    POSSIBLE_PATHS=(
        "$HOME/Library/Android/sdk/build-tools/*/apksigner"
        "/usr/local/android-sdk/build-tools/*/apksigner"
        "/opt/android-sdk/build-tools/*/apksigner"
    )
    for path_pattern in "${POSSIBLE_PATHS[@]}"; do
        for path in $path_pattern; do
            if [ -f "$path" ]; then
                APKSIGNER="$path"
                break 2
            fi
        done
    done
fi

if [ -z "$APKSIGNER" ] || [ ! -f "$APKSIGNER" ]; then
    echo -e "⚠️  Warning: apksigner not found. Skipping signature verification."
    echo -e "   Install Android SDK build-tools or set ANDROID_HOME to enable verification."
else
    echo -e "Using apksigner: $APKSIGNER"
    
    # Verify APK signature
    echo -e "Verifying APK signature..."
    if "$APKSIGNER" verify --verbose "$APK_PATH" >/dev/null 2>&1; then
        echo -e "✅ APK signature is valid"
        
        # Verify the certificate matches our keystore
        echo -e "Verifying certificate matches production keystore..."
        
        # Extract certificate fingerprint from APK using apksigner
        # Normalize: remove spaces, colons, and convert to lowercase for comparison
        APK_FINGERPRINT=$("$APKSIGNER" verify --print-certs "$APK_PATH" 2>/dev/null | grep -i "SHA-256 digest:" | head -1 | sed 's/.*SHA-256 digest: //' | tr -d ' ' | tr -d ':' | tr '[:upper:]' '[:lower:]')
        
        # Extract certificate fingerprint from keystore
        # Normalize: remove spaces, colons, and convert to lowercase for comparison
        KEYSTORE_FINGERPRINT=$(keytool -list -v -keystore "$KEYSTORE_PATH" -storepass "$KEYSTORE_PASSWORD" -alias "$KEY_ALIAS" 2>/dev/null | grep -i "SHA256:" | head -1 | sed 's/.*SHA256: //' | tr -d ' ' | tr -d ':' | tr '[:upper:]' '[:lower:]')
        
        if [ -n "$APK_FINGERPRINT" ] && [ -n "$KEYSTORE_FINGERPRINT" ]; then
            if [ "$APK_FINGERPRINT" = "$KEYSTORE_FINGERPRINT" ]; then
                echo -e "✅ Certificate fingerprint matches production keystore!"
                echo -e "   SHA256: ${APK_FINGERPRINT:0:32}..."
            else
                echo -e "❌ ERROR: Certificate fingerprint does NOT match production keystore!"
                echo -e "   APK fingerprint:      ${APK_FINGERPRINT:0:64}..."
                echo -e "   Keystore fingerprint: ${KEYSTORE_FINGERPRINT:0:64}..."
                echo -e "   This APK is NOT signed with the production keystore!"
                exit 1
            fi
        else
            # Fallback: try using keytool to extract from APK
            APK_CERT_FILE=$(mktemp)
            unzip -p "$APK_PATH" META-INF/*.RSA META-INF/*.DSA META-INF/*.EC 2>/dev/null | head -1 > "$APK_CERT_FILE" 2>/dev/null
            
            if [ -s "$APK_CERT_FILE" ]; then
                # Normalize: remove spaces, colons, and convert to lowercase for comparison
                APK_FINGERPRINT_FALLBACK=$(keytool -printcert -file "$APK_CERT_FILE" 2>/dev/null | grep -i "SHA256:" | sed 's/.*SHA256: //' | tr -d ' ' | tr -d ':' | tr '[:upper:]' '[:lower:]')
                rm -f "$APK_CERT_FILE"
                
                if [ -n "$APK_FINGERPRINT_FALLBACK" ] && [ "$APK_FINGERPRINT_FALLBACK" = "$KEYSTORE_FINGERPRINT" ]; then
                    echo -e "✅ Certificate fingerprint matches production keystore!"
                else
                    echo -e "⚠️  Could not verify certificate fingerprint, but signature is valid"
                    echo -e "   Please manually verify the APK is signed with the production keystore"
                fi
            else
                echo -e "⚠️  Could not extract certificate for comparison, but signature is valid"
            fi
        fi
    else
        echo -e "❌ ERROR: APK signature verification FAILED!"
        echo -e "   The APK is not properly signed!"
        exit 1
    fi
fi

# Step 6: Preserve R8/ProGuard mapping + native debug symbols (same versionCode)
echo -e ""
echo -e "--- Preserving Play deobfuscation artifacts ---"
bash scripts/copy-play-artifacts.sh

# Step 7: Generate SHA256 and GPG signature
echo -e ""
echo -e "--- Generating SHA256 and GPG Signature ---"
shasum -a 256 "$APK_PATH" > app-release.apk.sha256
if [ $? -eq 0 ]; then
    echo -e "✅ SHA256 hash generated: app-release.apk.sha256"
    cat app-release.apk.sha256
else
    echo -e "❌ Failed to generate SHA256 hash"
    exit 1
fi

gpg --armor --detach-sign app-release.apk.sha256
if [ $? -eq 0 ]; then
    echo -e "✅ GPG signature generated: app-release.apk.sha256.asc"
else
    echo -e "⚠️  Warning: GPG signature failed (this is optional)"
fi

if [ -f "app-release.aab" ]; then
    shasum -a 256 "app-release.aab" > app-release.aab.sha256
    echo -e "✅ SHA256 hash generated: app-release.aab.sha256"
    cat app-release.aab.sha256
fi

echo -e ""
echo -e "--- ✅ Production Release Complete! ---"
echo -e "APK: $APK_PATH"
if [ -f "app-release.aab" ]; then
    echo -e "AAB (Play): app-release.aab"
fi
if [ -f "mapping.txt" ]; then
    echo -e "Mapping: mapping.txt (upload to Play Console with this versionCode)"
fi
if [ -f "native-debug-symbols.zip" ]; then
    echo -e "Native symbols: native-debug-symbols.zip (upload with the same AAB)"
fi
echo -e "SHA256: app-release.apk.sha256"
echo -e "GPG Signature: app-release.apk.sha256.asc"
echo -e ""
echo -e "--- Device QA before Play promote ---"
echo -e "  [ ] Internal AAB: features optional, locales ~1, storage gone on API 33+, arm64 + 16 KB"
echo -e "  [ ] LAN NSD pair on API 29, 32, and 34+ (NEARBY_WIFI_DEVICES on 33+)"
echo -e "  [ ] Camera QR still prompts only when used"
echo -e "  [ ] GG18 + DKLS keygen/sign on this minify+shrink build"
echo -e "  [ ] F-Droid/unsigned path still builds"

# git tag -a v1.0 -m "Initial release."
# git tag -d v1.0

#/Users/mac/Library/Android/sdk/build-tools/36.0.0-rc3/apksigner sign \
#  --ks /Users/mac/work/BoldBitcoinWallet/BoldWallet/android/app/BoldBitcoinWallet.jks \
#  --ks-key-alias bbsr-key \
#  --out BoldWallet-signed.apk \
#  /Users/mac/Downloads/fdroiddata_build_com.boldwallet_47ee5f0dbd0eb401173b51b5e57c29d7f68164ae/tmp/com.boldwallet_1.apk

# GIT_COMMITTER_NAME="Your Name" \
#    GIT_COMMITTER_EMAIL="your@email.com" \
#    GIT_AUTHOR_NAME="Your Name" \
#    GIT_AUTHOR_EMAIL="your@email.com" \
#    GIT_TRACE=1 \
#    gpg --local-user YOUR_KEY_ID --sign --armor --output temp.sig temp.txt

# export GPG_TTY=$(tty)
# git tag -s v1.0.0 -u D263B572CDE81C8C -m "Release v1.0.0"  

echo -e "APK path: $APK_PATH"
# Step 5: Install APK on connected device (optional)
  for device in $(adb devices | grep -w "device" | awk '{print $1}'); do
      echo -e "Installing APK on connected device ${device}..."
      adb -s "$device" install "$APK_PATH"
  done
  echo -e "Installation complete."

echo -e "--- Done! ---"