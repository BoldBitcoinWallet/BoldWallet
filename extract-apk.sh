#!/bin/bash
# Simple script to extract APK from already-built Docker image
# Run this on the machine where you built the Docker image

set -e

# Function to run diagnostic commands (don't fail on error)
run_diagnostic() {
  echo "[*] $1"
  docker run --rm --entrypoint sh $IMAGE_NAME -c "$2" 2>&1 || echo "  (Command failed or no output)"
}

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

echo "[*] Checking container contents..."
# First, let's see what's actually in the container
echo "[*] Searching for APK files in container..."
docker cp $CONTAINER_NAME:/BoldWallet/ ./container-contents/ 2>/dev/null || true

# Try to find APK in various possible locations
APK_PATHS=(
  "/BoldWallet/android/app/build/outputs/apk/release/$APK_NAME"
  "/BoldWallet/android/app/build/outputs/apk/release/app-release-unsigned.apk"
  "/BoldWallet/android/app/build/outputs/apk/release/app-release.apk"
  "/app-release.apk"
)

APK_FOUND=false
for APK_PATH in "${APK_PATHS[@]}"; do
  echo "[*] Trying: $APK_PATH"
  if docker cp $CONTAINER_NAME:$APK_PATH $OUTPUT_PATH 2>/dev/null; then
    if [ -f "$OUTPUT_PATH" ] && [ -s "$OUTPUT_PATH" ]; then
      chmod 644 "$OUTPUT_PATH"
      echo "[*] ✅ APK extracted successfully from: $APK_PATH"
      ls -lh "$OUTPUT_PATH"
      APK_FOUND=true
      break
    else
      rm -f "$OUTPUT_PATH"
    fi
  fi
done

if [ "$APK_FOUND" = false ]; then
  echo ""
  echo "[*] ❌ Error: APK not found in container"
  echo "[*] Running diagnostics..."
  echo ""
  
  run_diagnostic "Searching for all APK files:" "find /BoldWallet -name '*.apk' -type f 2>/dev/null | head -20"
  
  run_diagnostic "Checking build outputs directory:" "ls -laR /BoldWallet/android/app/build/outputs/ 2>/dev/null | head -30"
  
  run_diagnostic "Checking if android directory exists:" "ls -la /BoldWallet/android/ 2>/dev/null | head -20"
  
  run_diagnostic "Checking working directory structure:" "ls -la /BoldWallet/ | head -20"
  
  echo ""
  echo "[*] Possible issues:"
  echo "  1. The build may have failed silently"
  echo "  2. The APK might be in a different location"
  echo "  3. Check the build logs for errors"
  echo ""
  echo "[*] You can also manually inspect the container:"
  echo "  docker run --rm -it --entrypoint sh $IMAGE_NAME"
  echo ""
  
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

echo "[*] Cleaning up container and temp files..."
docker rm $CONTAINER_NAME
rm -rf ./container-contents 2>/dev/null || true

echo ""
echo "[ok] ✅ Extraction complete!"
echo "  APK: $OUTPUT_PATH"
if [ -f "$MAPPING_OUTPUT" ]; then
  echo "  Mapping: $MAPPING_OUTPUT"
fi

