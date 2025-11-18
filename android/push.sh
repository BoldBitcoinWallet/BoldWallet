#!/bin/bash

# Script to automate generating a release APK for React Native
# Place this in the 'android' folder and run it using `./generate-apk.sh`

# Colors for better output

APK_PATH="app/build/outputs/apk/release/app-release.apk"
echo -e "APK path: $APK_PATH"
# Step 5: Install APK on connected device (optional)
  for device in $(adb devices | grep -w "device" | awk '{print $1}'); do
      echo -e "Installing APK on connected device ${device}..."
      adb -s "$device" install "$APK_PATH"
  done
  echo -e "Installation complete."

echo -e "--- Done! ---"