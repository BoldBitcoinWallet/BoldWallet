#!/bin/bash

# Local CI pipeline test script
# This script mimics the GitHub Actions workflow locally
# Run this to test the CI pipeline without pushing to GitHub

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}Local CI Pipeline Test${NC}"
echo -e "${BLUE}==========================================${NC}"
echo "This script runs the same tests as the GitHub Actions workflow"
echo "Working directory: $ROOT"
echo ""

# Track if any step fails
FAILED=0

# Function to run a step
run_step() {
    local step_name="$1"
    shift
    local command="$*"
    
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step: $step_name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo "Command: $command"
    echo ""
    
    if eval "$command"; then
        echo -e "${GREEN}✓ Step passed: $step_name${NC}"
        return 0
    else
        echo -e "${RED}✗ Step failed: $step_name${NC}"
        FAILED=1
        return 1
    fi
}

# Step 1: Verify Go version
run_step "Verify Go version" "go version" || true

# Step 2: Install dependencies
run_step "Install dependencies" "go mod download" || true

# Step 3: Verify dependencies
run_step "Verify dependencies" "go mod verify" || true

# Step 4: Tidy dependencies
run_step "Tidy dependencies" "go mod tidy" || true

# Step 5: Check for uncommitted changes after go mod tidy
run_step "Check for uncommitted changes after go mod tidy" "
    if [ -n \"\$(git status --porcelain)\" ]; then
        echo '⚠️  go.mod or go.sum has uncommitted changes after go mod tidy'
        git diff --stat
        exit 1
    else
        echo '✓ go.mod and go.sum are clean'
    fi
" || true

# Step 6: Run Go tests
run_step "Run Go tests" "go test -v -race -coverprofile=coverage.out ./..." || true

# Step 7: Build all packages
run_step "Build all packages" "go build ./..." || true

# Step 8: Build scripts helper
run_step "Build scripts helper" "go build -o /tmp/bbmtlib-scripts ./scripts/main.go" || true

# Step 9: Test scripts helper commands
run_step "Test scripts helper commands" "
    /tmp/bbmtlib-scripts random | head -c 64
    echo ''
    /tmp/bbmtlib-scripts nostr-keypair | grep -q ','
    echo '✓ Scripts helper commands work'
" || true

# Step 10: Build nostr-keygen command
run_step "Build nostr-keygen command" "go build -o /tmp/nostr-keygen ./tss/cmd/nostr-keygen" || true

# Step 11: Build nostr-keysign command
run_step "Build nostr-keysign command" "go build -o /tmp/nostr-keysign ./tss/cmd/nostr-keysign" || true

# Step 12: Verify scripts are executable
run_step "Verify scripts are executable" "
    chmod +x scripts/*.sh
    for script in scripts/*.sh; do
        if [ -f \"\$script\" ]; then
            echo \"✓ \$script is executable\"
        fi
    done
" || true

# Step 13: Install jq (for JSON validation)
if ! command -v jq >/dev/null 2>&1; then
    echo ""
    echo -e "${YELLOW}Installing jq...${NC}"
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y jq || echo "Failed to install jq, continuing..."
    elif command -v brew >/dev/null 2>&1; then
        brew install jq || echo "Failed to install jq, continuing..."
    else
        echo "Please install jq manually for JSON validation"
    fi
fi

# Step 14: Run comprehensive script tests
run_step "Run comprehensive script tests" "./scripts/test-all.sh" || true

# Step 15: Run vet
run_step "Run vet" "go vet ./..." || true

# Step 16: Run staticcheck (if available)
if command -v staticcheck >/dev/null 2>&1 || go install honnef.co/go/tools/cmd/staticcheck@latest 2>/dev/null; then
    run_step "Run staticcheck" "staticcheck ./... || true" || true
else
    echo -e "${YELLOW}⊘ staticcheck not available, skipping${NC}"
fi

# Step 17: Check code formatting
run_step "Check code formatting" "
    if [ \"\$(gofmt -s -l . | wc -l)\" -gt 0 ]; then
        echo '❌ Code is not formatted. Run gofmt -s -w .'
        gofmt -s -d .
        exit 1
    else
        echo '✓ Code is properly formatted'
    fi
" || true

# Summary
echo ""
echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}Local CI Pipeline Test Summary${NC}"
echo -e "${BLUE}==========================================${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All steps completed${NC}"
    echo ""
    echo "Your code should pass the CI pipeline!"
    exit 0
else
    echo -e "${RED}✗ Some steps failed${NC}"
    echo ""
    echo "Please fix the errors above before pushing to GitHub"
    exit 1
fi

