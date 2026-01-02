#!/bin/bash
# Utility to show Docker disk usage for BoldWallet builds
# Shows space used by images, containers, and build cache

set -e

IMAGE_NAME=boldwallet-apk-exporter
CONTAINER_NAME_PATTERN=temp-boldwallet

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

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

# BoldWallet Images
echo -e "${CYAN}--- BoldWallet Images ---${NC}"
images=$(docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedAt}}" | grep -E "(REPOSITORY|$IMAGE_NAME)" || true)

if [ -n "$images" ]; then
  echo "$images" | sed 's/^/  /'
  image_count=$(docker images --format "{{.Repository}}" | grep -c "^${IMAGE_NAME}$" || echo "0")
  if [ "$image_count" -gt 0 ]; then
    echo ""
    echo -e "  ${YELLOW}Found $image_count image(s)${NC}"
  fi
else
  echo "  No images found matching: $IMAGE_NAME"
fi
echo ""

# BoldWallet Containers
echo -e "${CYAN}--- BoldWallet Containers ---${NC}"
containers=$(docker ps -a --filter "name=$CONTAINER_NAME_PATTERN" --format "table {{.Names}}\t{{.ID}}\t{{.Status}}\t{{.Size}}" 2>/dev/null || true)

if [ -n "$containers" ]; then
  echo "$containers" | sed 's/^/  /'
  container_count=$(docker ps -a --filter "name=$CONTAINER_NAME_PATTERN" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$container_count" -gt 0 ]; then
    echo ""
    echo -e "  ${YELLOW}Found $container_count container(s)${NC}"
  fi
else
  echo "  No containers found matching pattern: $CONTAINER_NAME_PATTERN"
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
  echo "  ${YELLOW}Note: Build cache includes:${NC}"
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

