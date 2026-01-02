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

# Function to format bytes to human readable
format_size() {
  local bytes=$1
  if [ -z "$bytes" ] || [ "$bytes" -eq 0 ]; then
    echo "0 B"
    return
  fi
  
  local kb=$((bytes / 1024))
  local mb=$((kb / 1024))
  local gb=$((mb / 1024))
  
  if [ $gb -gt 0 ]; then
    printf "%.2f GB" $(echo "scale=2; $bytes / 1073741824" | bc)
  elif [ $mb -gt 0 ]; then
    printf "%.2f MB" $(echo "scale=2; $bytes / 1048576" | bc)
  elif [ $kb -gt 0 ]; then
    printf "%.2f KB" $(echo "scale=2; $bytes / 1024" | bc)
  else
    echo "${bytes} B"
  fi
}

# Function to get size in bytes (for calculations)
get_size_bytes() {
  local size_str="$1"
  # Remove spaces and convert to bytes
  echo "$size_str" | awk '{
    if ($0 ~ /GB/) { print $1 * 1073741824 }
    else if ($0 ~ /MB/) { print $1 * 1048576 }
    else if ($0 ~ /KB/) { print $1 * 1024 }
    else { print $1 }
  }'
}

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
images=$(docker images --format "{{.ID}} {{.Repository}}:{{.Tag}} {{.Size}}" | grep "$IMAGE_NAME" || true)

if [ -n "$images" ]; then
  total_size=0
  image_count=0
  
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      image_id=$(echo "$line" | awk '{print $1}')
      image_name=$(echo "$line" | awk '{print $2}')
      image_size=$(echo "$line" | awk '{for(i=3;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/ $//')
      
      echo -e "  ${GREEN}$image_name${NC}"
      echo "    ID: $image_id"
      echo "    Size: $image_size"
      echo ""
      
      image_count=$((image_count + 1))
      # Add to total (approximate)
      size_bytes=$(get_size_bytes "$image_size")
      total_size=$((total_size + size_bytes))
    fi
  done <<< "$images"
  
  if [ $image_count -gt 0 ]; then
    total_formatted=$(format_size $total_size)
    echo -e "  ${YELLOW}Total: $image_count image(s), ~$total_formatted${NC}"
  fi
else
  echo "  No images found matching: $IMAGE_NAME"
fi
echo ""

# BoldWallet Containers
echo -e "${CYAN}--- BoldWallet Containers ---${NC}"
containers=$(docker ps -a --filter "name=$CONTAINER_NAME_PATTERN" --format "{{.ID}} {{.Names}} {{.Size}}" 2>/dev/null || true)

if [ -n "$containers" ]; then
  container_count=0
  total_container_size=0
  
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      container_id=$(echo "$line" | awk '{print $1}')
      container_name=$(echo "$line" | awk '{print $2}')
      container_size=$(echo "$line" | awk '{for(i=3;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/ $//')
      
      echo -e "  ${GREEN}$container_name${NC}"
      echo "    ID: $container_id"
      echo "    Size: $container_size"
      echo ""
      
      container_count=$((container_count + 1))
      size_bytes=$(get_size_bytes "$container_size")
      total_container_size=$((total_container_size + size_bytes))
    fi
  done <<< "$containers"
  
  if [ $container_count -gt 0 ]; then
    total_formatted=$(format_size $total_container_size)
    echo -e "  ${YELLOW}Total: $container_count container(s), ~$total_formatted${NC}"
  fi
else
  echo "  No containers found matching pattern: $CONTAINER_NAME_PATTERN"
fi
echo ""

# BuildKit Build Cache
echo -e "${CYAN}--- BuildKit Build Cache ---${NC}"
cache_info=$(docker system df --format "{{.Type}}\t{{.TotalCount}}\t{{.Size}}" | grep "Build Cache" || echo "")

if [ -n "$cache_info" ]; then
  cache_size=$(echo "$cache_info" | awk '{print $3}')
  cache_count=$(echo "$cache_info" | awk '{print $2}')
  echo "  Cache entries: $cache_count"
  echo "  Total size: $cache_size"
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
  docker builder du 2>/dev/null | head -20 || echo "  Detailed cache breakdown not available"
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

