#!/bin/bash
set -e

IMAGE_NAME=boldwallet-apk-exporter
CONTAINER_NAME=temp-boldwallet
APK_NAME=app-release.apk
OUTPUT_PATH=./$APK_NAME

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
  echo "[*] Docker not found. Installing Docker..."

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

echo "[*] Building Docker image..."
docker build -t $IMAGE_NAME .

echo "[*] Creating temporary container..."
docker create --name $CONTAINER_NAME $IMAGE_NAME

echo "[*] Copying APK to host..."
docker cp $CONTAINER_NAME:/BoldWallet/android/app/build/outputs/apk/release/$APK_NAME $OUTPUT_PATH

echo "[*] Cleaning up..."
docker rm $CONTAINER_NAME

echo "[ok] APK extracted to: $OUTPUT_PATH"