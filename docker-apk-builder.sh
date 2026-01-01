#!/bin/bash
# Linux - Ubuntu Tested
set -e

GIT_REF=""
FDROID_BUILD=false

# Parse arguments
for ((i=1; i<=$#; i++)); do
  case "${!i}" in
    --fdroid)
      FDROID_BUILD=true
      ;;
    --git=*)
      GIT_REF="${!i#--git=}"
      ;;
  esac
done

IMAGE_NAME=boldwallet-apk-exporter
CONTAINER_NAME=temp-boldwallet
APK_NAME=app-release.apk
OUTPUT_PATH=./$APK_NAME

# Check if Docker is installed. Linux - Ubuntu Tested
if ! command -v docker &> /dev/null; then
  echo "[*] Docker not found. Installing Docker..."

  # Remove broken PPAs that might break apt
  echo "[*] Cleaning up invalid PPAs (if any)..."
  sudo grep -lr 'ppa.launchpadcontent.net' /etc/apt/sources.list.d/ | while read -r ppa_file; do
    if ! apt-cache policy | grep -q "$(basename "$ppa_file" .list)"; then
      echo "  - Removing broken PPA: $ppa_file"
      sudo rm -f "$ppa_file"
    fi
  done

  # Update package info and install dependencies
  sudo apt update
  sudo apt install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

  # Add Docker's official GPG key
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  # Set up the stable repository
  echo \
    "deb [arch=$(dpkg --print-architecture) \
    signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  # Install Docker Engine
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  echo "[ok] Docker installed."
fi

# Enable BuildKit for better caching and performance
export DOCKER_BUILDKIT=1

if [ "$FDROID_BUILD" = true ]; then
  echo "[*] Building fdroid-patched Docker image (with BuildKit cache)..."
  docker build --build-arg fdroid=true --build-arg git_ref="$GIT_REF" -t $IMAGE_NAME . > build.log 2>&1
else
  echo "[*] Building Docker image (with BuildKit cache)..."
  docker build --build-arg git_ref="$GIT_REF" -t $IMAGE_NAME . > build.log 2>&1
fi

# Remove existing container if it exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[*] Removing existing container: $CONTAINER_NAME"
  docker rm $CONTAINER_NAME
fi

echo "[*] Creating temporary container..."
docker create --name $CONTAINER_NAME $IMAGE_NAME

echo "[*] Copying APK to host..."
# Remove existing APK if it exists and is not writable
if [ -f "$OUTPUT_PATH" ] && [ ! -w "$OUTPUT_PATH" ]; then
  echo "[*] Removing existing read-only APK file..."
  rm -f "$OUTPUT_PATH"
fi

# Check if output directory is writable
OUTPUT_DIR=$(dirname "$OUTPUT_PATH")
if [ "$OUTPUT_DIR" = "." ]; then
  OUTPUT_DIR=$(pwd)
fi

if [ ! -w "$OUTPUT_DIR" ]; then
  echo "[*] Error: Output directory is not writable: $OUTPUT_DIR"
  echo "[*] Attempting to fix permissions..."
  chmod u+w "$OUTPUT_DIR" 2>/dev/null || {
    echo "[*] Error: Cannot write to $OUTPUT_DIR. Please check permissions."
    docker rm $CONTAINER_NAME
    exit 1
  }
fi

# Copy APK from container
docker cp $CONTAINER_NAME:/BoldWallet/android/app/build/outputs/apk/release/$APK_NAME $OUTPUT_PATH

# Copy mapping file if it exists (for Play Console)
MAPPING_SOURCE="/BoldWallet/android/app/build/outputs/mapping/release/mapping.txt"
MAPPING_OUTPUT="./mapping.txt"
# Try to copy mapping file (will fail silently if it doesn't exist)
if docker cp $CONTAINER_NAME:$MAPPING_SOURCE $MAPPING_OUTPUT 2>/dev/null; then
  echo "[*] Mapping file extracted: $MAPPING_OUTPUT"
else
  echo "[*] Note: Mapping file not found (R8/ProGuard may not be enabled or mapping not generated)"
fi

# Ensure the copied files have proper permissions
if [ -f "$OUTPUT_PATH" ]; then
  chmod 644 "$OUTPUT_PATH"
  echo "[*] APK file permissions set to 644 (rw-r--r--)"
else
  echo "[*] Error: APK file was not copied successfully"
  docker rm $CONTAINER_NAME
  exit 1
fi

if [ -f "$MAPPING_OUTPUT" ]; then
  chmod 644 "$MAPPING_OUTPUT"
fi

echo "[*] Cleaning up..."
docker rm $CONTAINER_NAME

echo "[ok] APK extracted to: $OUTPUT_PATH"
