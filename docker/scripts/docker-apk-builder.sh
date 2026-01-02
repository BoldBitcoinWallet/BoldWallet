#!/bin/bash
# Cross-platform Docker build script
# Tested on: Linux (Ubuntu), macOS
set -e

# Get the project root directory (parent of docker/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Change to project root for docker build context
cd "$PROJECT_ROOT"

GIT_REF=""
FDROID_BUILD=false
VERBOSE=false

# Help function
show_help() {
  cat << EOF
Usage: $0 [OPTIONS]

Build a React Native Android APK using Docker.

OPTIONS:
    --fdroid              Build F-Droid compatible version (removes proprietary dependencies)
    --git=REF            Build from specific git reference (commit, tag, or branch)
                          If not specified, uses local code
    --verbose, -v      Show build logs on CLI in addition to saving to build.log
    --help, -h           Show this help message

EXAMPLES:
    $0                                    # Build from local code
    $0 --fdroid                           # Build F-Droid version from local code
    $0 --git=main                          # Build from main branch
    $0 --git=v2.1.6 --verbose             # Build from tag v2.1.6 with verbose output
    $0 --fdroid --git=abc123 --verbose    # Build F-Droid version from commit abc123

OUTPUT:
    - APK: ./app-release.apk
    - Mapping: ./mapping.txt (if R8/ProGuard enabled)
    - Build logs: ./build.log

NOTES:
    - Requires Docker and Docker BuildKit
    - First build will download all dependencies (takes longer)
    - Subsequent builds use cached dependencies for faster builds
    - Use --verbose to monitor build progress in real-time

EOF
}

# Parse arguments
for ((i=1; i<=$#; i++)); do
  case "${!i}" in
    --fdroid)
      FDROID_BUILD=true
      ;;
    --git=*)
      GIT_REF="${!i#--git=}"
      ;;
    --verbose|-v)
      VERBOSE=true
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: ${!i}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

IMAGE_NAME=boldwallet-apk-exporter
CONTAINER_NAME=temp-boldwallet
APK_NAME=app-release.apk
# Use absolute path to avoid issues with sudo and working directory
OUTPUT_PATH="$PROJECT_ROOT/$APK_NAME"
MAPPING_OUTPUT="$PROJECT_ROOT/mapping.txt"
BUILD_LOG="$PROJECT_ROOT/build.log"

# Show build configuration
echo "=== Docker APK Builder ==="
echo "Configuration:"
echo "  Image name: $IMAGE_NAME"
echo "  F-Droid build: $FDROID_BUILD"
if [ -n "$GIT_REF" ]; then
  echo "  Git reference: $GIT_REF"
else
  echo "  Git reference: (using local code)"
fi
echo "  Verbose mode: $VERBOSE"
echo "  Output APK: $OUTPUT_PATH"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
  echo "[*] Docker not found."
  
  # Detect OS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    echo "[*] Please install Docker Desktop for macOS:"
    echo "    1. Download from: https://www.docker.com/products/docker-desktop"
    echo "    2. Or install via Homebrew: brew install --cask docker"
    echo "    3. Start Docker Desktop and ensure it's running"
    exit 1
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - Ubuntu/Debian
    echo "[*] Installing Docker on Linux..."
    
    # Remove broken PPAs that might break apt
    echo "[*] Cleaning up invalid PPAs (if any)..."
    sudo grep -lr 'ppa.launchpadcontent.net' /etc/apt/sources.list.d/ 2>/dev/null | while read -r ppa_file; do
      if ! apt-cache policy 2>/dev/null | grep -q "$(basename "$ppa_file" .list)"; then
        echo "  - Removing broken PPA: $ppa_file"
        sudo rm -f "$ppa_file"
      fi
    done || true

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
  else
    echo "[*] Unsupported OS: $OSTYPE"
    echo "[*] Please install Docker manually for your operating system"
    exit 1
  fi
fi

# Enable BuildKit for better caching and performance
export DOCKER_BUILDKIT=1

# Build Docker image with optional verbose output
BUILD_SUCCESS=false

if [ "$FDROID_BUILD" = true ]; then
  echo "[*] Building fdroid-patched Docker image (with BuildKit cache)..."
  if [ "$VERBOSE" = true ]; then
    echo "[*] Verbose mode: showing build output on CLI and saving to build.log"
    if docker build --build-arg fdroid=true --build-arg git_ref="$GIT_REF" -t $IMAGE_NAME . 2>&1 | tee "$BUILD_LOG"; then
      BUILD_SUCCESS=true
    fi
  else
    echo "[*] Build logs are being saved to build.log (use --verbose to see output)"
    if docker build --build-arg fdroid=true --build-arg git_ref="$GIT_REF" -t $IMAGE_NAME . > "$BUILD_LOG" 2>&1; then
      BUILD_SUCCESS=true
    fi
  fi
else
  echo "[*] Building Docker image (with BuildKit cache)..."
  if [ "$VERBOSE" = true ]; then
    echo "[*] Verbose mode: showing build output on CLI and saving to build.log"
    if docker build --build-arg git_ref="$GIT_REF" -t $IMAGE_NAME . 2>&1 | tee "$BUILD_LOG"; then
      BUILD_SUCCESS=true
    fi
  else
    echo "[*] Build logs are being saved to build.log (use --verbose to see output)"
    if docker build --build-arg git_ref="$GIT_REF" -t $IMAGE_NAME . > "$BUILD_LOG" 2>&1; then
      BUILD_SUCCESS=true
    fi
  fi
fi

# Check if build was successful
if [ "$BUILD_SUCCESS" = false ]; then
  echo ""
  echo "[*] ❌ Build failed!"
  if [ "$VERBOSE" = false ]; then
    echo "[*] Check build.log for details: tail -f $BUILD_LOG"
  fi
  exit 1
fi

echo "[*] ✅ Docker image built successfully!"

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

# Copy APK from container using reliable method
APK_SOURCE="/BoldWallet/android/app/build/outputs/apk/release/$APK_NAME"
MAPPING_SOURCE="/BoldWallet/android/app/build/outputs/mapping/release/mapping.txt"

echo "[*] Extracting APK from container..."
APK_EXTRACTED=false

# Method 1: Try docker cp (works in most cases)
if docker cp $CONTAINER_NAME:$APK_SOURCE $OUTPUT_PATH 2>/dev/null; then
  if [ -f "$OUTPUT_PATH" ] && [ -s "$OUTPUT_PATH" ]; then
    # Verify it's actually an APK (should be a ZIP file)
    if file "$OUTPUT_PATH" 2>/dev/null | grep -q "Zip\|Android\|archive" || [ $(stat -f%z "$OUTPUT_PATH" 2>/dev/null || stat -c%s "$OUTPUT_PATH" 2>/dev/null) -gt 1000000 ]; then
      chmod 644 "$OUTPUT_PATH"
      echo "[*] ✅ APK extracted successfully with docker cp"
      APK_EXTRACTED=true
    else
      echo "[*] ⚠️  docker cp result appears invalid, trying alternative method..."
      rm -f "$OUTPUT_PATH"
    fi
  fi
fi

# Method 2: Use docker run with cat (more reliable fallback)
if [ "$APK_EXTRACTED" = false ]; then
  echo "[*] Using docker run method (alternative extraction)..."
  docker rm $CONTAINER_NAME 2>/dev/null || true
  docker run --rm --entrypoint cat $IMAGE_NAME $APK_SOURCE > "$OUTPUT_PATH" 2>&1
  if [ -f "$OUTPUT_PATH" ] && [ -s "$OUTPUT_PATH" ]; then
    # Verify it's actually an APK
    if file "$OUTPUT_PATH" 2>/dev/null | grep -q "Zip\|Android\|archive" || [ $(stat -f%z "$OUTPUT_PATH" 2>/dev/null || stat -c%s "$OUTPUT_PATH" 2>/dev/null) -gt 1000000 ]; then
      chmod 644 "$OUTPUT_PATH"
      echo "[*] ✅ APK extracted successfully with docker run"
      APK_EXTRACTED=true
    else
      echo "[*] ❌ Extracted file doesn't appear to be a valid APK"
      rm -f "$OUTPUT_PATH"
    fi
  fi
  # Recreate container for mapping file extraction if needed
  docker create --name $CONTAINER_NAME $IMAGE_NAME >/dev/null 2>&1 || true
fi

if [ "$APK_EXTRACTED" = false ]; then
  echo "[*] ❌ Error: Failed to extract APK from container"
  docker rm $CONTAINER_NAME 2>/dev/null || true
  exit 1
fi

# Copy mapping file if it exists (for Play Console)
echo "[*] Extracting mapping file (if available)..."
MAPPING_EXTRACTED=false

# Try docker cp first
if docker cp $CONTAINER_NAME:$MAPPING_SOURCE $MAPPING_OUTPUT 2>/dev/null; then
  if [ -f "$MAPPING_OUTPUT" ] && [ -s "$MAPPING_OUTPUT" ]; then
    chmod 644 "$MAPPING_OUTPUT"
    echo "[*] ✅ Mapping file extracted: $MAPPING_OUTPUT"
    MAPPING_EXTRACTED=true
  fi
fi

# Fallback to docker run if docker cp failed
if [ "$MAPPING_EXTRACTED" = false ]; then
  docker rm $CONTAINER_NAME 2>/dev/null || true
  if docker run --rm --entrypoint cat $IMAGE_NAME $MAPPING_SOURCE > "$MAPPING_OUTPUT" 2>/dev/null; then
    if [ -f "$MAPPING_OUTPUT" ] && [ -s "$MAPPING_OUTPUT" ]; then
      chmod 644 "$MAPPING_OUTPUT"
      echo "[*] ✅ Mapping file extracted (via docker run): $MAPPING_OUTPUT"
      MAPPING_EXTRACTED=true
    fi
  fi
  docker create --name $CONTAINER_NAME $IMAGE_NAME >/dev/null 2>&1 || true
fi

if [ "$MAPPING_EXTRACTED" = false ]; then
  echo "[*] Note: Mapping file not found (R8/ProGuard may not be enabled or mapping not generated)"
fi

echo "[*] Cleaning up..."
docker rm $CONTAINER_NAME 2>/dev/null || true

# Fix ownership if run with sudo
if [ -f "$OUTPUT_PATH" ] && [ "$(id -u)" = "0" ]; then
  # If running as root, try to change ownership to the original user
  if [ -n "$SUDO_USER" ]; then
    echo "[*] Fixing file ownership..."
    chown $SUDO_USER:$SUDO_USER "$OUTPUT_PATH" 2>/dev/null || true
    if [ -f "$MAPPING_OUTPUT" ]; then
      chown $SUDO_USER:$SUDO_USER "$MAPPING_OUTPUT" 2>/dev/null || true
    fi
  fi
fi

echo ""
echo "[ok] ✅ Build and extraction complete!"
echo "  APK: $OUTPUT_PATH"
if [ -f "$MAPPING_OUTPUT" ]; then
  echo "  Mapping: $MAPPING_OUTPUT"
fi

# Show file info
if [ -f "$OUTPUT_PATH" ]; then
  echo ""
  echo "[*] File information:"
  ls -lh "$OUTPUT_PATH"
fi
