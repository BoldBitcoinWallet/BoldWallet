#!/bin/bash
# Utility to show Docker disk usage for BoldWallet builds
# Shows space used by images, containers, and build cache

set -e

IMAGE_NAME=boldwallet-apk-exporter
CONTAINER_NAME_PATTERN=temp-boldwallet

# Colors for output (only if terminal supports it)
# Can be disabled with NO_COLOR=1 environment variable
USE_COLORS=false

# Check environment variable first (respects NO_COLOR standard)
if [ "${NO_COLOR:-}" = "1" ] || [ "${NO_COLOR:-}" = "true" ]; then
  USE_COLORS=false
elif [ -t 1 ] 2>/dev/null; then
  # Only enable colors if stdout is a terminal
  if command -v tput >/dev/null 2>&1; then
    colors=$(tput colors 2>/dev/null || echo "-1")
    # Only enable if we get a valid positive number >= 8
    # -1 means no color support, 0 means monochrome
    if [ -n "$colors" ] && [ "$colors" != "-1" ] && [ "$colors" != "0" ]; then
      # Use arithmetic comparison to ensure it's a valid number >= 8
      if [ "$colors" -ge 8 ] 2>/dev/null && [ "$colors" -gt 0 ] 2>/dev/null; then
        USE_COLORS=true
      fi
    fi
  fi
fi

# Safety: Default to no colors if we can't confirm support
# This prevents \033 escape codes from appearing in output

# Set color variables - use empty strings if colors disabled to prevent escape code printing
if [ "$USE_COLORS" = true ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  # Explicitly set to empty to prevent any escape codes from being printed
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  CYAN=''
  NC=''
fi

echo -e "${BLUE}=== Docker Disk Usage for BoldWallet Builds ===${NC}"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
  exit 1
fi

# Overall Docker disk usage
echo -e "${CYAN}--- Overall Docker Disk Usage ---${NC}"
docker system df
echo ""

# BoldWallet Images (all images, including unused)
echo -e "${CYAN}--- BoldWallet Images (all) ---${NC}"
images=$(docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedAt}}" | grep -E "(REPOSITORY|$IMAGE_NAME)" || true)

if [ -n "$images" ]; then
  echo "$images" | sed 's/^/  /'
  # Get image count, ensuring it's a clean integer
  image_count=$(docker images --format "{{.Repository}}" 2>/dev/null | grep -c "^${IMAGE_NAME}$" 2>/dev/null || echo "0")
  image_count=$(echo "$image_count" | tr -d '[:space:]')
  # Ensure it's a valid number, default to 0 if not
  if ! [[ "$image_count" =~ ^[0-9]+$ ]]; then
    image_count=0
  fi
  if [ "$image_count" -gt 0 ]; then
    echo ""
    echo -e "  ${YELLOW}Found $image_count image(s) (all images, including unused)${NC}"
  fi
else
  echo "  No images found matching: $IMAGE_NAME"
fi
echo ""

# BoldWallet Containers (all containers, including stopped)
echo -e "${CYAN}--- BoldWallet Containers (all, including stopped) ---${NC}"
containers=$(docker ps -a --filter "name=$CONTAINER_NAME_PATTERN" --format "table {{.Names}}\t{{.ID}}\t{{.Status}}\t{{.Size}}" 2>/dev/null || true)

if [ -n "$containers" ]; then
  echo "$containers" | sed 's/^/  /'
  # Get container count, ensuring it's a clean integer
  container_count=$(docker ps -a --filter "name=$CONTAINER_NAME_PATTERN" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d '[:space:]')
  # Get active (running) container count
  active_count=$(docker ps --filter "name=$CONTAINER_NAME_PATTERN" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d '[:space:]')
  # Ensure it's a valid number, default to 0 if not
  if ! [[ "$container_count" =~ ^[0-9]+$ ]]; then
    container_count=0
  fi
  if ! [[ "$active_count" =~ ^[0-9]+$ ]]; then
    active_count=0
  fi
  if [ "$container_count" -gt 0 ]; then
    echo ""
    if [ "$active_count" -gt 0 ]; then
      stopped_count=$((container_count - active_count))
      echo -e "  ${YELLOW}Found $container_count container(s) total ($active_count running, $stopped_count stopped)${NC}"
    else
      echo -e "  ${YELLOW}Found $container_count container(s) (all stopped)${NC}"
    fi
  fi
else
  echo "  No containers found matching pattern: $CONTAINER_NAME_PATTERN"
fi
echo ""

# BoldWallet Volumes (if any exist)
echo -e "${CYAN}--- BoldWallet Volumes ---${NC}"
# Check for volumes that might be related (though our build doesn't typically create named volumes)
volumes=$(docker volume ls --format "table {{.Name}}\t{{.Driver}}\t{{.Mountpoint}}" 2>/dev/null | grep -iE "(bold|wallet|temp-bold)" || true)

if [ -n "$volumes" ]; then
  echo "$volumes" | sed 's/^/  /'
  volume_count=$(docker volume ls --format "{{.Name}}" 2>/dev/null | grep -iE "(bold|wallet|temp-bold)" | wc -l | tr -d '[:space:]')
  if [ -n "$volume_count" ] && [ "$volume_count" != "0" ]; then
    echo ""
    echo -e "  ${YELLOW}Found $volume_count volume(s)${NC}"
  fi
else
  echo "  No volumes found matching BoldWallet patterns"
  echo "  (Note: Build uses cache mounts, not named volumes)"
fi
echo ""

# BoldWallet Networks (if any exist)
echo -e "${CYAN}--- BoldWallet Networks ---${NC}"
# Check for networks that might be related (though our build doesn't typically create networks)
networks=$(docker network ls --format "table {{.Name}}\t{{.Driver}}\t{{.Scope}}" 2>/dev/null | grep -iE "(bold|wallet|temp-bold)" || true)

if [ -n "$networks" ]; then
  echo "$networks" | sed 's/^/  /'
  network_count=$(docker network ls --format "{{.Name}}" 2>/dev/null | grep -iE "(bold|wallet|temp-bold)" | wc -l | tr -d '[:space:]')
  if [ -n "$network_count" ] && [ "$network_count" != "0" ]; then
    echo ""
    echo -e "  ${YELLOW}Found $network_count network(s)${NC}"
  fi
else
  echo "  No networks found matching BoldWallet patterns"
  echo "  (Note: Build doesn't create custom networks)"
fi
echo ""

# BuildKit Build Cache
echo -e "${CYAN}--- BuildKit Build Cache ---${NC}"
# Parse the docker system df output more carefully
cache_line=$(docker system df | grep -i "build cache" || echo "")

if [ -n "$cache_line" ]; then
  # Extract cache info from the line
  # Format: "Build Cache     83        0         21.4GB    21.4GB"
  # Fields:  TYPE1  TYPE2    COUNT     ACTIVE    SIZE      RECLAIMABLE
  cache_count=$(echo "$cache_line" | awk '{print $3}')
  cache_active=$(echo "$cache_line" | awk '{print $4}')
  cache_size=$(echo "$cache_line" | awk '{print $5}')
  cache_reclaimable=$(echo "$cache_line" | awk '{print $6}')
  
  echo "  Cache entries: $cache_count"
  echo "  Active entries: $cache_active"
  echo "  Total size: $cache_size"
  if [ -n "$cache_reclaimable" ] && [ "$cache_reclaimable" != "0B" ] && [ "$cache_reclaimable" != "0" ]; then
    echo "  Reclaimable: $cache_reclaimable"
  fi
  echo ""
  if [ "$USE_COLORS" = true ]; then
    echo -e "  ${YELLOW}Note: Build cache includes:${NC}"
  else
    echo "  Note: Build cache includes:"
  fi
  echo "    - npm cache (~/.npm)"
  echo "    - Go module cache (~/go/pkg/mod)"
  echo "    - Go build cache (~/.cache/go-build)"
  echo "    - Android SDK cache (~/.android)"
  echo "    - Gradle cache (~/.gradle)"
  echo "    - Docker layer cache"
else
  echo "  No build cache information available"
fi
echo ""

# Detailed breakdown by cache type (if available)
echo -e "${CYAN}--- Cache Breakdown (if available) ---${NC}"
if command -v docker &> /dev/null && docker builder du &> /dev/null 2>&1; then
  cache_breakdown=$(docker builder du 2>/dev/null | head -20)
  if [ -n "$cache_breakdown" ]; then
    echo "$cache_breakdown" | sed 's/^/  /'
    echo ""
    echo -e "  ${YELLOW}Note:${NC} Individual entries may show 0B* because:"
    echo "    - (*) indicates shared/referenced cache entries"
    echo "    - Actual size is included in the total above"
    echo "    - Cache entries are deduplicated and shared across builds"
  else
    echo "  Detailed cache breakdown not available"
  fi
else
  echo "  Use 'docker system df -v' for detailed breakdown"
fi
echo ""

# Summary
echo -e "${CYAN}--- Summary ---${NC}"
total_docker=$(docker system df --format "{{.Size}}" | head -1)
echo "  Total Docker disk usage: $total_docker"
echo ""
echo -e "${YELLOW}Tips:${NC}"
echo "  - Run './docker-cleanup.sh' to clean old images/containers"
echo "  - Run './docker-cleanup.sh --build-cache' to clean build cache"
echo "  - Use 'docker system prune -a' to clean all unused Docker resources"
echo "  - Build cache speeds up builds but uses disk space"
echo ""

