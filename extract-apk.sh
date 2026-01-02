#!/bin/bash
# Simple script to extract APK from already-built Docker image
# Run this on the machine where you built the Docker image

set -e

IMAGE_NAME=boldwallet-apk-exporter
CONTAINER_NAME=temp-boldwallet-extract
APK_NAME=app-release.apk
OUTPUT_PATH=./$APK_NAME

echo "[*] Extracting APK from Docker image: $IMAGE_NAME"

# Check if image exists
if ! docker images --format "{{.Repository}}" | grep -q "^${IMAGE_NAME}$"; then
  echo "[*] Error: Docker image '$IMAGE_NAME' not found"
  echo "[*] Available images:"
  docker images --format "  {{.Repository}}:{{.Tag}}" | head -10
  exit 1
fi

# Remove existing container if it exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[*] Removing existing container: $CONTAINER_NAME"
  docker rm $CONTAINER_NAME
fi

echo "[*] Creating temporary container..."
docker create --name $CONTAINER_NAME $IMAGE_NAME

echo "[*] Copying APK to host..."
# Copy APK from container
if docker cp $CONTAINER_NAME:/BoldWallet/android/app/build/outputs/apk/release/$APK_NAME $OUTPUT_PATH 2>/dev/null; then
  chmod 644 "$OUTPUT_PATH"
  echo "[*] ✅ APK extracted successfully: $OUTPUT_PATH"
  ls -lh "$OUTPUT_PATH"
else
  echo "[*] ❌ Error: Failed to copy APK from container"
  echo "[*] Checking container contents..."
  docker cp $CONTAINER_NAME:/BoldWallet/android/app/build/outputs/apk/release/ ./apk-check/ 2>/dev/null || true
  ls -la ./apk-check/ 2>/dev/null || echo "  (Could not list APK directory)"
  docker rm $CONTAINER_NAME
  exit 1
fi

# Copy mapping file if it exists
MAPPING_SOURCE="/BoldWallet/android/app/build/outputs/mapping/release/mapping.txt"
MAPPING_OUTPUT="./mapping.txt"
if docker cp $CONTAINER_NAME:$MAPPING_SOURCE $MAPPING_OUTPUT 2>/dev/null; then
  chmod 644 "$MAPPING_OUTPUT"
  echo "[*] ✅ Mapping file extracted: $MAPPING_OUTPUT"
else
  echo "[*] Note: Mapping file not found (this is OK if R8/ProGuard is disabled)"
fi

echo "[*] Cleaning up..."
docker rm $CONTAINER_NAME

echo ""
echo "[ok] ✅ Extraction complete!"
echo "  APK: $OUTPUT_PATH"
if [ -f "$MAPPING_OUTPUT" ]; then
  echo "  Mapping: $MAPPING_OUTPUT"
fi

