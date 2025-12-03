#!/bin/bash

# Script to stop the local Nostr relay

set -euo pipefail

CONTAINER_NAME="bbmtlib-test-relay"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "Stopping local Nostr relay..."

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1
    echo -e "${GREEN}✓ Relay stopped${NC}"
elif docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${YELLOW}Relay container exists but is not running${NC}"
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Removed stopped container${NC}"
else
    echo -e "${YELLOW}No relay container found${NC}"
fi

