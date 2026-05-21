#!/bin/bash

# Script to start a local Nostr relay for testing purposes
# Uses Docker to run nostr-rs-relay

set -euo pipefail

RELAY_PORT="${RELAY_PORT:-7777}"
RELAY_HOST="${RELAY_HOST:-localhost}"
RELAY_URL="ws://${RELAY_HOST}:${RELAY_PORT}"
DATA_DIR="${DATA_DIR:-./test-relay-data}"
CONTAINER_NAME="nostr-relay-local"
IMAGE_NAME="nostr-relay-local:latest"

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
    exit 1
fi

# Check if container already exists and is running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${YELLOW}Relay container is already running${NC}"
        echo "Relay URL: $RELAY_URL"
        exit 0
    else
        echo "Removing existing stopped container..."
        docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
fi

# Create data directory
DATA_DIR_ABS="$(cd "$(dirname "$DATA_DIR")" && pwd)/$(basename "$DATA_DIR")"
mkdir -p "$DATA_DIR_ABS"
chmod 777 "$DATA_DIR_ABS" || true

# ✅ FIXED: build instead of pulling nonexistent / wrong arch image
if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${IMAGE_NAME}$"; then
    echo "✓ nostr-relay image already exists"
else
    echo "Building nostr-relay image locally (ARM native)..."
    docker build -t nostr-relay-local ./nostr-rs-relay || {
        echo -e "${RED}Error: Failed to build image${NC}"
        exit 1
    }
fi

# Start the relay container
echo "Starting relay container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${RELAY_PORT}:8080" \
    -v "${DATA_DIR_ABS}:/usr/src/app/db" \
    --rm \
    "$IMAGE_NAME" >/dev/null 2>&1

# Wait for relay to be ready
echo "Waiting for relay to be ready..."
MAX_WAIT=60
WAIT_COUNT=0
CONTAINER_READY=false
PORT_READY=false
LOGS_READY=false

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${RED}Error: Relay container failed to start${NC}"
        docker logs "$CONTAINER_NAME" 2>&1 | tail -30
        exit 1
    fi
    CONTAINER_READY=true

    # Check if port is open
    PORT_READY=false
    if command -v nc >/dev/null 2>&1; then
        nc -z "$RELAY_HOST" "$RELAY_PORT" && PORT_READY=true || true
    elif command -v timeout >/dev/null 2>&1; then
        timeout 1 bash -c "echo > /dev/tcp/$RELAY_HOST/$RELAY_PORT" && PORT_READY=true || true
    else
        PORT_READY=true
    fi

    # Check logs
    LOGS_READY=false
    if docker logs "$CONTAINER_NAME" 2>&1 | grep -qiE "(listening|ready|started|database.*ready)"; then
        LOGS_READY=true
    fi

    if [ "$CONTAINER_READY" = "true" ] && [ "$PORT_READY" = "true" ] && [ "$LOGS_READY" = "true" ]; then
        echo "  Relay basic checks passed, stabilizing..."
        sleep 8

        # HTTP check
        HTTP_READY=false
        if command -v curl >/dev/null 2>&1; then
            for i in {1..5}; do
                curl -s --max-time 2 "http://${RELAY_HOST}:${RELAY_PORT}/" >/dev/null && HTTP_READY=true && break
                sleep 1
            done
        else
            HTTP_READY=true
        fi

        [ "$HTTP_READY" = "true" ] && \
            echo -e "${GREEN}✓ Relay HTTP check passed${NC}" || \
            echo -e "${YELLOW}⚠ HTTP check failed${NC}"

        # Optional WS test
        if [ -f "./scripts/test-websocket-connection.sh" ]; then
            echo "Testing WebSocket..."
            ./scripts/test-websocket-connection.sh "$RELAY_URL" || \
                echo -e "${YELLOW}⚠ WS test not perfect (common during init)${NC}"
        fi

        echo ""
        echo -e "${GREEN}✓ Relay is ready!${NC}"
        echo "Relay URL: $RELAY_URL"
        exit 0
    fi

    if [ $((WAIT_COUNT % 5)) -eq 0 ] && [ $WAIT_COUNT -gt 0 ]; then
        echo "  Waiting... (${WAIT_COUNT}s/${MAX_WAIT}s)"
    fi

    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

echo -e "${YELLOW}Timeout waiting for relay${NC}"
docker logs "$CONTAINER_NAME" | tail -20
exit 1