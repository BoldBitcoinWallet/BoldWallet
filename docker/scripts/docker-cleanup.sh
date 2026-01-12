#!/bin/bash
# Script to clean up old Docker build images and related artifacts
# Usage: ./docker-cleanup.sh [options]

set -e

IMAGE_NAME=boldwallet-apk-exporter
CONTAINER_NAME_PATTERN=temp-boldwallet

# Colors for output (only if terminal supports it)
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors)" -ge 8 ]; then
  # Terminal supports colors
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  # No color support
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

# Default options
DRY_RUN=false
CLEAN_IMAGES=true
CLEAN_CONTAINERS=true
CLEAN_BUILD_CACHE=false
CLEAN_ALL=false
KEEP_LATEST=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --no-images)
      CLEAN_IMAGES=false
      shift
      ;;
    --no-containers)
      CLEAN_CONTAINERS=false
      shift
      ;;
    --build-cache)
      CLEAN_BUILD_CACHE=true
      shift
      ;;
    --all)
      CLEAN_ALL=true
      CLEAN_BUILD_CACHE=true
      KEEP_LATEST=false
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --dry-run          Show what would be removed without actually removing"
      echo "  --no-images        Don't remove Docker images"
      echo "  --no-containers    Don't remove Docker containers"
      echo "  --build-cache      Also clean BuildKit build cache"
      echo "  --all              Clean everything (including build cache, doesn't keep latest)"
      echo "  --help, -h         Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0                 # Clean images and containers (keeps latest image)"
      echo "  $0 --dry-run       # Preview what would be removed"
      echo "  $0 --all           # Clean everything including build cache"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}=== Docker Cleanup Script ===${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}[DRY RUN MODE] - No changes will be made${NC}"
  echo ""
fi

# Function to run command or show what would be run
run_or_show() {
  local cmd="$1"
  local desc="$2"
  
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[WOULD RUN]${NC} $desc"
    echo "  $cmd"
  else
    echo -e "${GREEN}[RUNNING]${NC} $desc"
    eval "$cmd" || echo -e "${RED}[WARNING]${NC} Command failed (this is OK if nothing to clean)"
  fi
}

# Clean up containers
if [ "$CLEAN_CONTAINERS" = true ]; then
  echo -e "${BLUE}--- Cleaning Containers ---${NC}"
  
  # Find containers matching our pattern
  containers=$(docker ps -a --filter "name=$CONTAINER_NAME_PATTERN" --format "{{.ID}} {{.Names}}" 2>/dev/null || true)
  
  if [ -n "$containers" ]; then
    container_ids=$(echo "$containers" | awk '{print $1}')
    container_count=$(echo "$container_ids" | wc -l | tr -d ' ')
    
    echo "Found $container_count container(s) to remove:"
    echo "$containers" | sed 's/^/  /'
    
    for id in $container_ids; do
      run_or_show "docker rm -f $id" "Removing container $id"
    done
  else
    echo "No containers found matching pattern: $CONTAINER_NAME_PATTERN"
  fi
  echo ""
fi

# Clean up images
if [ "$CLEAN_IMAGES" = true ]; then
  echo -e "${BLUE}--- Cleaning Images ---${NC}"
  
  # Find images matching our name
  images=$(docker images --format "{{.ID}} {{.Repository}}:{{.Tag}} {{.CreatedAt}}" | grep "$IMAGE_NAME" || true)
  
  if [ -n "$images" ]; then
    if [ "$KEEP_LATEST" = true ] && [ "$CLEAN_ALL" = false ]; then
      # Get the latest image (most recent)
      latest_image=$(echo "$images" | head -1 | awk '{print $1}')
      other_images=$(echo "$images" | tail -n +2)
      
      image_count=$(echo "$images" | wc -l | tr -d ' ')
      other_count=$(echo "$other_images" | wc -l | tr -d ' ')
      
      echo "Found $image_count image(s) for $IMAGE_NAME"
      echo "Latest image (keeping):"
      echo "$images" | head -1 | awk '{print "  " $2 " (ID: " $1 ")"}'
      
      if [ -n "$other_images" ] && [ "$other_count" -gt 0 ]; then
        echo ""
        echo "Removing $other_count older image(s):"
        echo "$other_images" | awk '{print "  " $2 " (ID: " $1 ")"}'
        
        for img in $(echo "$other_images" | awk '{print $1}'); do
          run_or_show "docker rmi $img" "Removing image $img"
        done
      else
        echo "No older images to remove"
      fi
    else
      # Remove all images
      image_count=$(echo "$images" | wc -l | tr -d ' ')
      echo "Found $image_count image(s) to remove:"
      echo "$images" | awk '{print "  " $2 " (ID: " $1 ")"}'
      
      for img in $(echo "$images" | awk '{print $1}'); do
        run_or_show "docker rmi -f $img" "Removing image $img"
      done
    fi
  else
    echo "No images found matching: $IMAGE_NAME"
  fi
  echo ""
fi

# Clean up BuildKit build cache
if [ "$CLEAN_BUILD_CACHE" = true ]; then
  echo -e "${BLUE}--- Cleaning BuildKit Build Cache ---${NC}"
  echo -e "${YELLOW}WARNING: This will remove all BuildKit build cache!${NC}"
  echo "This includes cached layers, but NOT downloaded dependencies (npm, Go modules, etc.)"
  echo ""
  
  if [ "$DRY_RUN" = false ]; then
    read -p "Are you sure you want to clean the build cache? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      run_or_show "docker builder prune -af" "Cleaning all build cache"
    else
      echo "Skipping build cache cleanup"
    fi
  else
    run_or_show "docker builder prune -af" "Would clean all build cache"
  fi
  echo ""
fi

# Show disk space saved (if not dry run)
if [ "$DRY_RUN" = false ]; then
  echo -e "${BLUE}--- Disk Usage ---${NC}"
  docker system df
  echo ""
fi

# Summary
echo -e "${GREEN}=== Cleanup Complete ===${NC}"
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}This was a dry run. Use without --dry-run to actually clean.${NC}"
fi

