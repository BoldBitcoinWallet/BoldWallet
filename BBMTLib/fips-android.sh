#!/bin/bash
set -euo pipefail

# Always run from the BBMTLib directory regardless of where the script is called from.
cd "$(dirname "$0")"

# Dockerfile.fips
docker buildx build --load --platform linux/amd64 -f Dockerfile.fips -t boldwallet-builder:fips .

# Generate lib
docker run --rm \
  --platform linux/amd64 \
  -v "$(pwd)":/workspace \
  boldwallet-builder:fips ./build.sh

# List outputs
ls -lh tss.aar tss-sources.jar 2>/dev/null || echo "No artifacts found"

# Copy Android artifacts
if [[ -d "../android/app/libs" ]]; then
    cp -v tss.aar ../android/app/libs/tss.aar || echo "Warning: copy tss.aar failed"
    cp -v tss-sources.jar ../android/app/libs/tss-sources.jar || echo "Warning: copy sources.jar failed"
else
    echo "Skipping Android copy"
fi