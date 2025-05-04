#!/bin/bash
set -e

IMAGE_NAME=boldwallet-apk-exporter
CONTAINER_NAME=temp-boldwallet
APK_NAME=app-release.apk
OUTPUT_PATH=./$APK_NAME

echo "[*] Building Docker image..."
docker build -t $IMAGE_NAME .

echo "[*] Creating temporary container..."
docker create --name $CONTAINER_NAME $IMAGE_NAME

echo "[*] Copying APK to host..."
docker cp $CONTAINER_NAME:/BoldWallet/android/app/build/outputs/apk/release/$APK_NAME $OUTPUT_PATH

echo "[*] Cleaning up..."
docker rm $CONTAINER_NAME

echo "[ok] APK extracted to: $OUTPUT_PATH"
