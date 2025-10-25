#!/bin/bash

# Script to automate generating a release APK for React Native
# Place this in the 'android' folder and run it using `./generate-apk.sh`

# Keystore details (modify these with your own values)
KEYSTORE_FILE="my-release-key.jks"
KEY_ALIAS="my-key"
KEYSTORE_PASSWORD="your_actual_password_here"
KEY_PASSWORD="your_actual_password_here"

# Paths
KEYSTORE_PATH="app/$KEYSTORE_FILE"
GRADLE_PROPERTIES_PATH="release.properties"

echo -e "--- Starting React Native APK Release Build Automation ---"

# Step 1: Generate Keystore if it doesn't exist
if [ ! -f "$KEYSTORE_PATH" ]; then
    echo -e "Generating new Keystore..."
    keytool -genkey -v -keystore "$KEYSTORE_PATH" \
        -keyalg RSA -keysize 2048 -validity 10000 -alias "$KEY_ALIAS" \
        -dname "CN=Unknown, OU=Unknown, O=Unknown, L=Unknown, ST=Unknown, C=Unknown" \
        -storepass "$KEY_PASSWORD" -keypass "$KEY_PASSWORD"

    echo -e "Keystore generated at: $KEYSTORE_PATH"
else
    echo -e "Keystore already exists. Skipping generation."
fi

# Step 2: Update *.properties with Keystore credentials
if ! grep -q "MYAPP_UPLOAD_STORE_FILE" "$GRADLE_PROPERTIES_PATH"; then
    echo -e "Adding Keystore configuration to gradle.properties..."
    cat <<EOL >> $GRADLE_PROPERTIES_PATH
MYAPP_UPLOAD_STORE_FILE=$KEYSTORE_FILE
MYAPP_UPLOAD_KEY_ALIAS=$KEY_ALIAS
MYAPP_UPLOAD_STORE_PASSWORD=$KEYSTORE_PASSWORD
MYAPP_UPLOAD_KEY_PASSWORD=$KEY_PASSWORD
EOL
else
    echo -e "Keystore configuration already exists in release.properties. Skipping."
fi

# Step 3: Build the Release APK
echo -e "Building the Release APK..."
./gradlew assembleRelease

# Step 4: Locate and display APK
APK_PATH="app/release/app-release.apk"
if [ -f "$APK_PATH" ]; then
    echo -e "Build successful! APK located at: $APK_PATH"
else
    echo -e "Build failed! Check the logs for errors."
    exit 1
fi

echo -e "--- Done! ---"