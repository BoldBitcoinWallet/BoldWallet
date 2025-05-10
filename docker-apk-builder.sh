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

if [ "$FDROID_BUILD" = true ]; then
  echo "[*] Building fdroid-patched Docker image..."
  docker build --build-arg fdroid=true --build-arg git_ref="$GIT_REF" -t $IMAGE_NAME . > build.log 2>&1
else
  echo "[*] Building Docker image..."
  docker build --build-arg git_ref="$GIT_REF" -t $IMAGE_NAME . > build.log 2>&1
fi

echo "[*] Creating temporary container..."
docker create --name $CONTAINER_NAME $IMAGE_NAME

echo "[*] Copying APK to host..."
docker cp $CONTAINER_NAME:/BoldWallet/android/app/build/outputs/apk/release/$APK_NAME $OUTPUT_PATH

echo "[*] Cleaning up..."
docker rm $CONTAINER_NAME

echo "[ok] APK extracted to: $OUTPUT_PATH"
