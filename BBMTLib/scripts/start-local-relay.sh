#!/bin/bash

# Script to start a local Nostr relay for testing purposes
# Uses Docker to run nostr-rs-relay

set -euo pipefail

RELAY_PORT="${RELAY_PORT:-7777}"
RELAY_HOST="${RELAY_HOST:-localhost}"
RELAY_URL="ws://${RELAY_HOST}:${RELAY_PORT}"
DATA_DIR="${DATA_DIR:-./test-relay-data}"
CONTAINER_NAME="bbmtlib-test-relay"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Starting Local Nostr Relay for Testing"
echo "=========================================="
echo "Relay URL: $RELAY_URL"
echo "Data directory: $DATA_DIR"
echo ""

# Check if Docker is available
if ! command -v docker >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not installed or not available${NC}"
    echo "Please install Docker to run local relay for testing"
    echo ""
    echo "Alternative: Install Rust and build nostr-rs-relay from source"
    exit 1
fi

# Check if container already exists and is running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${YELLOW}Relay container is already running${NC}"
        echo "Relay URL: $RELAY_URL"
        echo "Container name: $CONTAINER_NAME"
        echo ""
        echo "To stop it, run: docker stop $CONTAINER_NAME"
        echo "To remove it, run: docker rm $CONTAINER_NAME"
        exit 0
    else
        echo "Removing existing stopped container..."
        docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
fi

# Create data directory
mkdir -p "$DATA_DIR"

# Pull the latest nostr-rs-relay image (or use a specific tag)
echo "Pulling nostr-rs-relay Docker image..."
docker pull scsibug/nostr-rs-relay:latest || {
    echo -e "${YELLOW}Warning: Failed to pull image, trying to build from source...${NC}"
    # If pull fails, we could build from source, but for now just exit
    exit 1
}

# Start the relay container
echo "Starting relay container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${RELAY_PORT}:8080" \
    -v "$(pwd)/${DATA_DIR}:/usr/src/app/db:Z" \
    --rm \
    scsibug/nostr-rs-relay:latest >/dev/null 2>&1

# Wait for relay to be ready
echo "Waiting for relay to be ready..."
MAX_WAIT=30
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${RED}Error: Relay container failed to start${NC}"
        docker logs "$CONTAINER_NAME" 2>&1 | tail -20
        exit 1
    fi
    
    # Try to connect to the relay (simple check)
    if command -v nc >/dev/null 2>&1; then
        if nc -z "$RELAY_HOST" "$RELAY_PORT" 2>/dev/null; then
            echo -e "${GREEN}✓ Relay is ready!${NC}"
            echo ""
            echo "Relay URL: $RELAY_URL"
            echo "Container name: $CONTAINER_NAME"
            echo ""
            echo "To stop the relay, run:"
            echo "  docker stop $CONTAINER_NAME"
            echo ""
            echo "Or use the stop script:"
            echo "  ./scripts/stop-local-relay.sh"
            exit 0
        fi
    else
        # If nc is not available, just wait a bit and assume it's ready
        sleep 2
        echo -e "${GREEN}✓ Relay container started (assuming ready)${NC}"
        echo ""
        echo "Relay URL: $RELAY_URL"
        echo "Container name: $CONTAINER_NAME"
        exit 0
    fi
    
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

echo -e "${YELLOW}Warning: Relay may not be fully ready, but container is running${NC}"
echo "Relay URL: $RELAY_URL"
echo "Container name: $CONTAINER_NAME"

