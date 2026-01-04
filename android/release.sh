#!/bin/bash

# Script to automate generating a release APK for React Native
# This script generates a DEV keystore for local development builds.
# For production releases, use signed-release.sh with production credentials.

# Dev keystore details (for local development only)
# Note: Modern Java uses PKCS12 format which requires same password for store and key
KEYSTORE_FILE="dev-release-key.jks"
KEY_ALIAS="dev-key"
KEYSTORE_PASSWORD="dev-keystore-password"
KEY_PASSWORD="dev-keystore-password"  # Must match KEYSTORE_PASSWORD for PKCS12

# Paths
KEYSTORE_PATH="app/$KEYSTORE_FILE"
GRADLE_PROPERTIES_PATH="release.properties"

echo -e "--- Starting React Native APK Release Build Automation ---"

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

# Step 1: Generate or verify Dev Keystore
KEYSTORE_VALID=false

if [ -f "$KEYSTORE_PATH" ]; then
    echo -e "Dev keystore exists. Verifying it works with current credentials..."
    # Try to list the keystore to verify password works
    if keytool -list -keystore "$KEYSTORE_PATH" -storepass "$KEYSTORE_PASSWORD" -alias "$KEY_ALIAS" >/dev/null 2>&1; then
        KEYSTORE_VALID=true
        echo -e "✅ Existing dev keystore is valid."
    else
        echo -e "⚠️  Existing keystore doesn't work with current credentials."
        echo -e "🗑️  Removing old keystore to regenerate..."
        rm -f "$KEYSTORE_PATH"
        KEYSTORE_VALID=false
    fi
fi

if [ "$KEYSTORE_VALID" = false ]; then
    echo -e "Generating new DEV keystore for local development..."
    echo -e "⚠️  This is a DEV keystore - NOT for production releases!"
    keytool -genkey -v -keystore "$KEYSTORE_PATH" \
        -keyalg RSA -keysize 2048 -validity 10000 -alias "$KEY_ALIAS" \
        -dname "CN=Dev, OU=Dev, O=Dev, L=Dev, ST=Dev, C=US" \
        -storepass "$KEYSTORE_PASSWORD" -keypass "$KEY_PASSWORD" 2>&1

    if [ $? -eq 0 ]; then
        echo -e "✅ Dev keystore generated at: $KEYSTORE_PATH"
        echo -e "⚠️  This keystore is for development/testing only!"
    else
        echo -e "❌ Failed to generate keystore!"
        exit 1
    fi
fi

# Step 2: Update release.properties with Keystore credentials
if [ ! -f "$GRADLE_PROPERTIES_PATH" ]; then
    echo -e "Creating release.properties file..."
    touch "$GRADLE_PROPERTIES_PATH"
fi

# Function to update or add property
update_property() {
    local key=$1
    local value=$2
    if grep -q "^${key}=" "$GRADLE_PROPERTIES_PATH"; then
        # Update existing property
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s|^${key}=.*|${key}=${value}|" "$GRADLE_PROPERTIES_PATH"
        else
            # Linux
            sed -i "s|^${key}=.*|${key}=${value}|" "$GRADLE_PROPERTIES_PATH"
        fi
        echo -e "Updated ${key} in release.properties"
    else
        # Add new property
        echo "${key}=${value}" >> "$GRADLE_PROPERTIES_PATH"
        echo -e "Added ${key} to release.properties"
    fi
}

# Update all keystore properties
echo -e "Updating DEV keystore configuration in release.properties..."
update_property "MYAPP_UPLOAD_STORE_FILE" "$KEYSTORE_PATH"
update_property "MYAPP_UPLOAD_KEY_ALIAS" "$KEY_ALIAS"
update_property "MYAPP_UPLOAD_STORE_PASSWORD" "$KEYSTORE_PASSWORD"
update_property "MYAPP_UPLOAD_KEY_PASSWORD" "$KEY_PASSWORD"

echo -e ""
echo -e "⚠️  NOTE: This build uses a DEV keystore for local development."
echo -e "⚠️  For production releases, use signed-release.sh instead."
echo -e ""

# Step 3: Build the Release APK
echo -e "Building the Release APK..."
./gradlew assembleRelease

# Step 4: Locate and display APK
APK_PATH="app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_PATH" ]; then
    echo -e "Build successful! APK located at: $APK_PATH"
else
    echo -e "Build failed! Check the logs for errors."
    # Restore original gradle.properties if we used local one
    if [ "$RESTORE_PROPERTIES" = true ] && [ -f "gradle.properties.docker.backup" ]; then
        mv gradle.properties.docker.backup gradle.properties
    fi
    exit 1
fi

# Restore original gradle.properties if we used local one
if [ "$RESTORE_PROPERTIES" = true ] && [ -f "gradle.properties.docker.backup" ]; then
    mv gradle.properties.docker.backup gradle.properties
    echo -e "📦 Restored gradle.properties (Docker settings)"
fi

echo -e "--- Done! ---"