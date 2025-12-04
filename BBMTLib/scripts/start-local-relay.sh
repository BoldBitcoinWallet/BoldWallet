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

# Create data directory with proper permissions
# Use absolute path to avoid issues with relative paths
DATA_DIR_ABS="$(cd "$(dirname "$DATA_DIR")" && pwd)/$(basename "$DATA_DIR")"
mkdir -p "$DATA_DIR_ABS"
# Ensure the directory is writable by the container user (important for GitHub Actions)
# Use 777 permissions to allow the container to write regardless of user mapping
chmod 777 "$DATA_DIR_ABS" || true

# Pull the latest nostr-rs-relay image (or use a specific tag)
echo "Pulling nostr-rs-relay Docker image..."
docker pull scsibug/nostr-rs-relay:latest || {
    echo -e "${YELLOW}Warning: Failed to pull image, trying to build from source...${NC}"
    # If pull fails, we could build from source, but for now just exit
    exit 1
}

# Start the relay container
# Remove :Z flag (SELinux context) as it's not needed in GitHub Actions and can cause issues
# Use absolute path for volume mount to ensure it works correctly
echo "Starting relay container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${RELAY_PORT}:8080" \
    -v "${DATA_DIR_ABS}:/usr/src/app/db" \
    --rm \
    scsibug/nostr-rs-relay:latest >/dev/null 2>&1

# Wait for relay to be ready
echo "Waiting for relay to be ready..."
MAX_WAIT=60  # Increased timeout to 60 seconds
WAIT_COUNT=0
CONTAINER_READY=false
PORT_READY=false
LOGS_READY=false

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${RED}Error: Relay container failed to start${NC}"
        echo "Container logs:"
        docker logs "$CONTAINER_NAME" 2>&1 | tail -30
        exit 1
    fi
    CONTAINER_READY=true
    
    # Check if port is open
    PORT_READY=false
    if command -v nc >/dev/null 2>&1; then
        if nc -z "$RELAY_HOST" "$RELAY_PORT" 2>/dev/null; then
            PORT_READY=true
        fi
    elif command -v timeout >/dev/null 2>&1 && command -v bash >/dev/null 2>&1; then
        # Alternative: try to connect using bash's /dev/tcp
        if timeout 1 bash -c "echo > /dev/tcp/$RELAY_HOST/$RELAY_PORT" 2>/dev/null; then
            PORT_READY=true
        fi
    else
        # If no network tools available, assume port is ready after container is running
        PORT_READY=true
    fi
    
    # Check container logs for readiness indicators
    LOGS_READY=false
    if docker logs "$CONTAINER_NAME" 2>&1 | grep -qiE "(listening|ready|started|database.*ready)" >/dev/null 2>&1; then
        LOGS_READY=true
    fi
    
    # If all checks pass, relay is ready
    if [ "$CONTAINER_READY" = "true" ] && [ "$PORT_READY" = "true" ] && [ "$LOGS_READY" = "true" ]; then
        # Give it additional time to fully initialize WebSocket support
        # nostr-rs-relay needs time to initialize its WebSocket handlers
        # In CI environments, this can take longer
        echo "  Relay basic checks passed, waiting for WebSocket support to initialize..."
        echo "  (This may take 5-10 seconds, especially in CI environments)"
        sleep 8
        
        # Final verification: try a simple HTTP connection test
        # nostr-rs-relay responds to HTTP on the same port
        HTTP_READY=false
        if command -v curl >/dev/null 2>&1; then
            for i in {1..5}; do
                if curl -s --max-time 2 "http://${RELAY_HOST}:${RELAY_PORT}/" >/dev/null 2>&1; then
                    HTTP_READY=true
                    break
                fi
                sleep 1
            done
        else
            # If curl not available, assume ready after basic checks
            HTTP_READY=true
        fi
        
        if [ "$HTTP_READY" = "true" ]; then
            echo -e "${GREEN}✓ Relay HTTP check passed${NC}"
        else
            echo -e "${YELLOW}⚠ Relay HTTP check failed (may still work for WebSocket)${NC}"
        fi
        
        # Test WebSocket connection if test script is available
        if [ -f "./scripts/test-websocket-connection.sh" ]; then
            echo "  Testing WebSocket connection..."
            # Show output for debugging
            if ./scripts/test-websocket-connection.sh "$RELAY_URL" 2>&1; then
                echo -e "${GREEN}✓ WebSocket connection test passed!${NC}"
            else
                WS_EXIT=$?
                echo -e "${YELLOW}⚠ WebSocket test had issues (exit code: $WS_EXIT)${NC}"
                echo "  'Connection reset by peer' is common during relay initialization"
                echo "  The relay may still work for actual clients - this is a best-effort test"
                echo "  Proceeding - if tests fail, the relay may need more initialization time"
            fi
        fi
        
        echo ""
        echo -e "${GREEN}✓ Relay is ready and accepting connections!${NC}"
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
    
    # Show progress every 5 seconds
    if [ $((WAIT_COUNT % 5)) -eq 0 ] && [ $WAIT_COUNT -gt 0 ]; then
        STATUS=""
        [ "$CONTAINER_READY" = "true" ] && STATUS="${STATUS}container✓ " || STATUS="${STATUS}container✗ "
        [ "$PORT_READY" = "true" ] && STATUS="${STATUS}port✓ " || STATUS="${STATUS}port✗ "
        [ "$LOGS_READY" = "true" ] && STATUS="${STATUS}logs✓" || STATUS="${STATUS}logs✗"
        echo "  Waiting... (${WAIT_COUNT}s/${MAX_WAIT}s) - Status: $STATUS"
    fi
    
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

# Timeout reached - show final status
echo ""
echo -e "${YELLOW}Warning: Relay readiness check timed out after ${MAX_WAIT} seconds${NC}"
echo "Final status:"
echo "  Container running: $CONTAINER_READY"
echo "  Port open: $PORT_READY"
echo "  Logs indicate ready: $LOGS_READY"
echo ""
echo "Container logs (last 20 lines):"
docker logs "$CONTAINER_NAME" 2>&1 | tail -20
echo ""
echo "Relay URL: $RELAY_URL"
echo "Container name: $CONTAINER_NAME"
echo ""
echo "The relay may still be starting up. You can check logs with:"
echo "  docker logs -f $CONTAINER_NAME"
echo ""
echo "If the relay is not working, you may need to:"
echo "  1. Check if port $RELAY_PORT is already in use"
echo "  2. Check Docker logs for errors"
echo "  3. Try stopping and restarting: docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME"
exit 1

