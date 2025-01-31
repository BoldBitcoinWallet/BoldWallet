#!/bin/bash

# Script to automate generating a release APK for React Native
# Place this in the 'android' folder and run it using `./generate-apk.sh`

# Colors for better output
GREEN="\e[32m"
RED="\e[31m"
RESET="\e[0m"

# Keystore details (modify these with your own values)
KEYSTORE_FILE="my-release-key.jks"
KEY_ALIAS="my-key"
KEYSTORE_PASSWORD="your_keystore_password"
KEY_PASSWORD="your_key_password"

# Paths
KEYSTORE_PATH="app/$KEYSTORE_FILE"
GRADLE_PROPERTIES_PATH="gradle.properties"

echo -e "${GREEN}--- Starting React Native APK Release Build Automation ---${RESET}"

# Step 1: Generate Keystore if it doesn't exist
if [ ! -f "$KEYSTORE_PATH" ]; then
    echo -e "${GREEN}Generating new Keystore...${RESET}"
    keytool -genkey -v -keystore "$KEYSTORE_PATH" \
        -keyalg RSA -keysize 2048 -validity 10000 -alias "$KEY_ALIAS" \
        -storepass "$KEYSTORE_PASSWORD" -keypass "$KEY_PASSWORD"

    echo -e "${GREEN}Keystore generated at: $KEYSTORE_PATH${RESET}"
else
    echo -e "${GREEN}Keystore already exists. Skipping generation.${RESET}"
fi

# Step 2: Update gradle.properties with Keystore credentials
if ! grep -q "MYAPP_UPLOAD_STORE_FILE" "$GRADLE_PROPERTIES_PATH"; then
    echo -e "${GREEN}Adding Keystore configuration to gradle.properties...${RESET}"
    cat <<EOL >> $GRADLE_PROPERTIES_PATH

MYAPP_UPLOAD_STORE_FILE=$KEYSTORE_FILE
MYAPP_UPLOAD_KEY_ALIAS=$KEY_ALIAS
MYAPP_UPLOAD_STORE_PASSWORD=$KEYSTORE_PASSWORD
MYAPP_UPLOAD_KEY_PASSWORD=$KEY_PASSWORD
EOL
else
    echo -e "${GREEN}Keystore configuration already exists in gradle.properties. Skipping.${RESET}"
fi

# Step 3: Build the Release APK
echo -e "${GREEN}Building the Release APK...${RESET}"
./gradlew clean
./gradlew assembleRelease

# Step 4: Locate and display APK
APK_PATH="app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_PATH" ]; then
    echo -e "${GREEN}Build successful! APK located at:${RESET} $APK_PATH"
else
    echo -e "${RED}Build failed! Check the logs for errors.${RESET}"
    exit 1
fi

# Step 5: Install APK on connected device (optional)
read -p "Do you want to install the APK on a connected device? (y/n): " INSTALL_CHOICE
if [ "$INSTALL_CHOICE" = "y" ]; then
    echo -e "${GREEN}Installing APK on connected device...${RESET}"
    adb install "$APK_PATH"
    echo -e "${GREEN}Installation complete.${RESET}"
else
    echo -e "${GREEN}Skipping installation.${RESET}"
fi

echo -e "${GREEN}--- Done! ---${RESET}"


