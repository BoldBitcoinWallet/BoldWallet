#!/bin/bash

# Script to automate generating a release APK for React Native
# Place this in the 'android' folder and run it using `./generate-apk.sh`

# Colors for better output
#GREEN="\e[32m"
#RED="\e[31m"
#RESET="\e[0m"
GREEN=""
RED=""
RESET=""

APK_PATH="app/build/outputs/apk/release/app-release.apk"

# Step 5: Install APK on connected device (optional)
  for device in $(adb devices | grep -w "device" | awk '{print $1}'); do
      echo -e "${GREEN}Installing APK on connected device ${device}...${RESET}"
      adb -s "$device" install "$APK_PATH"
  done
  echo -e "${GREEN}Installation complete.${RESET}"

echo -e "${GREEN}--- Done! ---${RESET}"


