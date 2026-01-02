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
# Use absolute path to avoid issues with sudo and working directory
OUTPUT_PATH=$(pwd)/$APK_NAME

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

# Verify the APK exists in the container before trying to copy
echo "[*] Verifying APK exists in container..."
APK_EXISTS=$(docker run --rm --entrypoint sh $IMAGE_NAME -c "test -f /BoldWallet/android/app/build/outputs/apk/release/app-release.apk && echo 'EXISTS' || echo 'MISSING'")
if [ "$APK_EXISTS" != "EXISTS" ]; then
  echo "[*] ❌ APK file does not exist in container!"
  docker rm $CONTAINER_NAME
  exit 1
fi
echo "[*] ✅ APK file confirmed in container"

# Try to find APK in various possible locations
APK_PATHS=(
  "/BoldWallet/android/app/build/outputs/apk/release/$APK_NAME"
  "/BoldWallet/android/app/build/outputs/apk/release/app-release-unsigned.apk"
  "/BoldWallet/android/app/build/outputs/apk/release/app-release.apk"
  "/app-release.apk"
)

APK_FOUND=false
APK_SOURCE="/BoldWallet/android/app/build/outputs/apk/release/app-release.apk"

echo "[*] Copying APK from: $APK_SOURCE"
echo "[*] Output will be saved to: $OUTPUT_PATH"

# Method 1: Try docker cp (works with stopped containers)
echo "[*] Attempting extraction with docker cp..."
if docker cp $CONTAINER_NAME:$APK_SOURCE $OUTPUT_PATH 2>&1; then
  if [ -f "$OUTPUT_PATH" ] && [ -s "$OUTPUT_PATH" ]; then
    chmod 644 "$OUTPUT_PATH"
    echo "[*] ✅ APK extracted successfully with docker cp!"
    ls -lh "$OUTPUT_PATH"
    APK_FOUND=true
  else
    echo "[*] ⚠️  docker cp completed but file is missing or empty"
    rm -f "$OUTPUT_PATH"
  fi
else
  echo "[*] ⚠️  docker cp failed, trying alternative method..."
fi

# Method 2: Use docker run with cat (most reliable)
if [ "$APK_FOUND" = false ]; then
  echo "[*] Using docker run with cat (alternative method)..."
  docker rm $CONTAINER_NAME 2>/dev/null || true
  docker run --rm --entrypoint cat $IMAGE_NAME $APK_SOURCE > "$OUTPUT_PATH" 2>&1
  if [ -f "$OUTPUT_PATH" ] && [ -s "$OUTPUT_PATH" ]; then
    # Verify it's actually an APK (should start with ZIP magic bytes)
    if file "$OUTPUT_PATH" | grep -q "Zip\|Android"; then
      chmod 644 "$OUTPUT_PATH"
      echo "[*] ✅ APK extracted successfully with docker run!"
      ls -lh "$OUTPUT_PATH"
      APK_FOUND=true
    else
      echo "[*] ⚠️  File extracted but doesn't appear to be a valid APK"
      rm -f "$OUTPUT_PATH"
    fi
  else
    echo "[*] ⚠️  docker run method also failed"
    rm -f "$OUTPUT_PATH"
  fi
  # Recreate container for cleanup if needed
  docker create --name $CONTAINER_NAME $IMAGE_NAME >/dev/null 2>&1 || true
fi

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
MAPPING_OUTPUT="$(pwd)/mapping.txt"
if docker cp $CONTAINER_NAME:$MAPPING_SOURCE $MAPPING_OUTPUT 2>/dev/null; then
  chmod 644 "$MAPPING_OUTPUT"
  echo "[*] ✅ Mapping file extracted: $MAPPING_OUTPUT"
else
  echo "[*] Note: Mapping file not found (this is OK if R8/ProGuard is disabled)"
fi

echo "[*] Cleaning up container and temp files..."
docker rm $CONTAINER_NAME
rm -rf ./container-contents ./apk-temp 2>/dev/null || true

echo ""
echo "[ok] ✅ Extraction complete!"
echo "  APK: $OUTPUT_PATH"
if [ -f "$MAPPING_OUTPUT" ]; then
  echo "  Mapping: $MAPPING_OUTPUT"
fi

