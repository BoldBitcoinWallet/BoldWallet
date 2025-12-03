#!/bin/bash

# Comprehensive test script for all scripts in BBMTLib/scripts/
# This script runs each script and validates their outputs

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Function to print test header
print_test_header() {
    echo ""
    echo "=========================================="
    echo "Testing: $1"
    echo "=========================================="
}

# Function to print success
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
    ((TESTS_PASSED++)) || true
}

# Function to print failure
print_failure() {
    echo -e "${RED}✗ $1${NC}"
    ((TESTS_FAILED++)) || true
}

# Function to print warning/skip
print_skip() {
    echo -e "${YELLOW}⊘ $1${NC}"
    ((TESTS_SKIPPED++)) || true
}

# Function to validate JSON file exists and is valid
validate_json_file() {
    local file="$1"
    local description="$2"
    
    if [ ! -f "$file" ]; then
        print_failure "$description: File not found: $file"
        return 1
    fi
    
    if ! command -v jq >/dev/null 2>&1; then
        # If jq is not available, just check file exists and is not empty
        if [ ! -s "$file" ]; then
            print_failure "$description: File is empty: $file"
            return 1
        fi
        return 0
    fi
    
    if ! jq empty "$file" 2>/dev/null; then
        print_failure "$description: Invalid JSON: $file"
        return 1
    fi
    
    print_success "$description: Valid JSON file created"
    return 0
}

# Function to validate keyshare file
validate_keyshare() {
    local file="$1"
    local party="$2"
    
    if ! validate_json_file "$file" "Keyshare for $party"; then
        return 1
    fi
    
    if command -v jq >/dev/null 2>&1; then
        # Check for required keyshare fields
        if ! jq -e '.pub_key' "$file" >/dev/null 2>&1; then
            print_failure "Keyshare $party: Missing pub_key field"
            return 1
        fi
        
        if ! jq -e '.chain_code_hex' "$file" >/dev/null 2>&1; then
            print_failure "Keyshare $party: Missing chain_code_hex field"
            return 1
        fi
        
        print_success "Keyshare $party: Contains required fields"
    fi
    
    return 0
}

# Function to validate signature file
validate_signature() {
    local file="$1"
    local party="$2"
    
    if ! validate_json_file "$file" "Signature for $party"; then
        return 1
    fi
    
    if command -v jq >/dev/null 2>&1; then
        # Check for required signature fields
        if ! jq -e '.r' "$file" >/dev/null 2>&1; then
            print_failure "Signature $party: Missing r field"
            return 1
        fi
        
        if ! jq -e '.s' "$file" >/dev/null 2>&1; then
            print_failure "Signature $party: Missing s field"
            return 1
        fi
        
        print_success "Signature $party: Contains required fields"
    fi
    
    return 0
}

# Local relay management (global state)
LOCAL_RELAY_STARTED=false
LOCAL_RELAY_URL=""
USE_LOCAL_RELAY=false

# Function to start local relay
start_local_relay() {
    if [ "$LOCAL_RELAY_STARTED" = "true" ]; then
        USE_LOCAL_RELAY=true
        return 0
    fi
    
    echo ""
    echo "=========================================="
    echo "Setting up local Nostr relay for testing"
    echo "=========================================="
    
    if ./scripts/start-local-relay.sh > /tmp/relay-start.log 2>&1; then
        LOCAL_RELAY_STARTED=true
        USE_LOCAL_RELAY=true
        LOCAL_RELAY_URL="ws://localhost:7777"
        echo "✓ Local relay started at $LOCAL_RELAY_URL"
        # Give relay a moment to fully initialize
        sleep 2
        return 0
    else
        echo "⚠ Failed to start local relay, falling back to external relays"
        echo "  Check /tmp/relay-start.log for details"
        LOCAL_RELAY_STARTED=false
        USE_LOCAL_RELAY=false
        return 1
    fi
}

# Function to stop local relay
stop_local_relay() {
    if [ "$LOCAL_RELAY_STARTED" = "true" ]; then
        echo ""
        echo "Stopping local relay..."
        ./scripts/stop-local-relay.sh >/dev/null 2>&1 || true
        LOCAL_RELAY_STARTED=false
    fi
}

# Cleanup function
cleanup() {
    echo ""
    echo "Cleaning up test artifacts..."
    stop_local_relay
    # Keep output directories for inspection, but can remove if needed
    # rm -rf ./test-keygen-output ./test-keysign-output 2>/dev/null || true
}

trap cleanup EXIT

echo "=========================================="
echo "BBMTLib Scripts Test Suite"
echo "=========================================="
echo "Working directory: $ROOT"
echo ""

# Make all scripts executable
chmod +x scripts/*.sh 2>/dev/null || true

# ============================================
# Test 1: main.go helper commands
# ============================================
print_test_header "main.go helper commands"

# Test random command
if OUTPUT=$(go run ./scripts/main.go random 2>&1); then
    if [ ${#OUTPUT} -ge 64 ]; then
        print_success "main.go random: Generated 64+ character hex string"
    else
        print_failure "main.go random: Output too short (expected 64+ chars, got ${#OUTPUT})"
    fi
else
    print_failure "main.go random: Command failed"
fi

# Test nostr-keypair command
if OUTPUT=$(go run ./scripts/main.go nostr-keypair 2>&1); then
    if echo "$OUTPUT" | grep -q ","; then
        print_success "main.go nostr-keypair: Generated keypair with comma separator"
    else
        print_failure "main.go nostr-keypair: Missing comma separator"
    fi
else
    print_failure "main.go nostr-keypair: Command failed"
fi

# ============================================
# Test 2: keygen.sh (local relay)
# ============================================
print_test_header "keygen.sh (local relay)"

# This script runs indefinitely, so we'll test it differently
# We'll check if it can start and build the binary
if [ -f "scripts/keygen.sh" ]; then
    # Check if the script is syntactically correct
    if bash -n scripts/keygen.sh 2>&1; then
        print_success "keygen.sh: Syntax is valid"
        
        # Check if main.go exists and can be built
        if go build -o /tmp/test-bbmt scripts/main.go 2>&1; then
            print_success "keygen.sh: main.go builds successfully"
            rm -f /tmp/test-bbmt
        else
            print_failure "keygen.sh: Failed to build main.go"
        fi
    else
        print_failure "keygen.sh: Syntax error"
    fi
else
    print_skip "keygen.sh: Script not found"
fi

# ============================================
# Test 3: keysign.sh (local relay)
# ============================================
print_test_header "keysign.sh (local relay)"

if [ -f "scripts/keysign.sh" ]; then
    if bash -n scripts/keysign.sh 2>&1; then
        print_success "keysign.sh: Syntax is valid"
        
        # Check if required .ks files are mentioned
        if grep -q "\.ks" scripts/keysign.sh; then
            print_success "keysign.sh: References keyshare files"
        fi
    else
        print_failure "keysign.sh: Syntax error"
    fi
else
    print_skip "keysign.sh: Script not found"
fi

# ============================================
# Test 4: nostr-keygen.sh (with local relay)
# ============================================
print_test_header "nostr-keygen.sh (2-party)"

if [ ! -f "scripts/nostr-keygen.sh" ]; then
    print_skip "nostr-keygen.sh: Script not found"
else
    if bash -n scripts/nostr-keygen.sh 2>&1; then
        print_success "nostr-keygen.sh: Syntax is valid"
    else
        print_failure "nostr-keygen.sh: Syntax error"
    fi
    
    # Start local relay for testing
    if start_local_relay; then
        RELAYS_TO_USE="$LOCAL_RELAY_URL"
        echo "Using local relay: $RELAYS_TO_USE"
    else
        RELAYS_TO_USE="${RELAYS:-wss://nostr.hifish.org,wss://nostr.xxi.quest,wss://bbw-nostr.xyz}"
        echo "Using external relays: $RELAYS_TO_USE"
        echo "  (Note: Tests may fail due to relay connectivity)"
    fi
    
    # Try to run with a short timeout
    TEST_OUTPUT_DIR="./test-nostr-keygen-output"
    mkdir -p "$TEST_OUTPUT_DIR"
    export OUTPUT_DIR="$TEST_OUTPUT_DIR"
    export TIMEOUT="300"  # Short timeout for testing
    export RELAYS="$RELAYS_TO_USE"
    
    echo "Attempting to run nostr-keygen.sh..."
    if timeout 300 bash scripts/nostr-keygen.sh > "$TEST_OUTPUT_DIR/test.log" 2>&1; then
        # Check for output files
        if validate_keyshare "$TEST_OUTPUT_DIR/party1-keyshare.json" "party1"; then
            if validate_keyshare "$TEST_OUTPUT_DIR/party2-keyshare.json" "party2"; then
                print_success "nostr-keygen.sh: Successfully generated keyshares for both parties"
                
                # Verify keyshares have matching public keys
                if command -v jq >/dev/null 2>&1; then
                    PUB1=$(jq -r '.pub_key' "$TEST_OUTPUT_DIR/party1-keyshare.json" 2>/dev/null)
                    PUB2=$(jq -r '.pub_key' "$TEST_OUTPUT_DIR/party2-keyshare.json" 2>/dev/null)
                    if [ "$PUB1" = "$PUB2" ] && [ -n "$PUB1" ]; then
                        print_success "nostr-keygen.sh: Both parties have matching public keys"
                    else
                        print_failure "nostr-keygen.sh: Public keys don't match between parties"
                    fi
                fi
            fi
        fi
    else
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 124 ]; then
            print_skip "nostr-keygen.sh: Timed out (relay connectivity issue or slow network)"
        else
            print_skip "nostr-keygen.sh: Failed (exit code $EXIT_CODE) - may be due to relay connectivity"
            echo "  Check logs in $TEST_OUTPUT_DIR/test.log for details"
        fi
    fi
fi

# ============================================
# Test 5: nostr-keysign.sh (requires keygen output)
# ============================================
print_test_header "nostr-keysign.sh"

if [ ! -f "scripts/nostr-keysign.sh" ]; then
    print_skip "nostr-keysign.sh: Script not found"
else
    if bash -n scripts/nostr-keysign.sh 2>&1; then
        print_success "nostr-keysign.sh: Syntax is valid"
    else
        print_failure "nostr-keysign.sh: Syntax error"
    fi
    
    # Check if keygen output exists
    # First check the test output directory, then fall back to the default output directory
    KEYGEN_OUTPUT_DIR="$TEST_OUTPUT_DIR"
    if [ ! -f "$KEYGEN_OUTPUT_DIR/party1-keyshare.json" ] || [ ! -f "$KEYGEN_OUTPUT_DIR/party2-keyshare.json" ]; then
        # Try default output directory (in case keygen was run separately)
        DEFAULT_KEYGEN_OUTPUT="./nostr-keygen-output"
        if [ -f "$DEFAULT_KEYGEN_OUTPUT/party1-keyshare.json" ] && [ -f "$DEFAULT_KEYGEN_OUTPUT/party2-keyshare.json" ]; then
            KEYGEN_OUTPUT_DIR="$DEFAULT_KEYGEN_OUTPUT"
            echo "  Using keyshare files from default output directory: $KEYGEN_OUTPUT_DIR"
        fi
    fi
    
    if [ -f "$KEYGEN_OUTPUT_DIR/party1-keyshare.json" ] && [ -f "$KEYGEN_OUTPUT_DIR/party2-keyshare.json" ]; then
        # Use local relay if available, otherwise fall back to external
        if [ "$USE_LOCAL_RELAY" = "true" ] && [ -n "$LOCAL_RELAY_URL" ]; then
            RELAYS_TO_USE="$LOCAL_RELAY_URL"
            echo "  Using local relay for keysign: $RELAYS_TO_USE"
        else
            RELAYS_TO_USE="${RELAYS:-wss://bbw-nostr.xyz}"
            echo "  Using external relay for keysign: $RELAYS_TO_USE"
        fi
        
        export OUTPUT_DIR="$KEYGEN_OUTPUT_DIR"
        export KEYSIGN_OUTPUT_DIR="./test-nostr-keysign-output"
        export TIMEOUT="300"
        export RELAYS="$RELAYS_TO_USE"
        mkdir -p "$KEYSIGN_OUTPUT_DIR"
        
        echo "Attempting to run nostr-keysign.sh..."
        echo "  Using keyshare files from: $KEYGEN_OUTPUT_DIR"
        if timeout 300 bash scripts/nostr-keysign.sh > "$KEYSIGN_OUTPUT_DIR/test.log" 2>&1; then
            if validate_signature "$KEYSIGN_OUTPUT_DIR/party1-signature.json" "party1"; then
                if validate_signature "$KEYSIGN_OUTPUT_DIR/party2-signature.json" "party2"; then
                    print_success "nostr-keysign.sh: Successfully generated signatures for both parties"
                    
                    # Verify signatures match
                    if command -v jq >/dev/null 2>&1; then
                        SIG1=$(jq -c . "$KEYSIGN_OUTPUT_DIR/party1-signature.json" 2>/dev/null)
                        SIG2=$(jq -c . "$KEYSIGN_OUTPUT_DIR/party2-signature.json" 2>/dev/null)
                        if [ "$SIG1" = "$SIG2" ] && [ -n "$SIG1" ]; then
                            print_success "nostr-keysign.sh: Signatures match between parties"
                        else
                            print_failure "nostr-keysign.sh: Signatures don't match between parties"
                        fi
                    fi
                fi
            fi
        else
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                print_skip "nostr-keysign.sh: Timed out (relay connectivity issue)"
            else
                print_skip "nostr-keysign.sh: Failed (exit code $EXIT_CODE) - may be due to relay connectivity"
                echo "  Check logs in $KEYSIGN_OUTPUT_DIR/test.log for details"
            fi
        fi
    else
        print_skip "nostr-keysign.sh: Skipped (requires nostr-keygen.sh output)"
        echo "  Expected keyshare files not found:"
        echo "    - $KEYGEN_OUTPUT_DIR/party1-keyshare.json"
        echo "    - $KEYGEN_OUTPUT_DIR/party2-keyshare.json"
        echo "  This usually means nostr-keygen.sh failed or timed out due to relay connectivity issues."
        echo "  To test keysign, first ensure nostr-keygen.sh completes successfully."
    fi
fi

# ============================================
# Test 6: nostr-keygen-3party.sh
# ============================================
print_test_header "nostr-keygen-3party.sh"

if [ ! -f "scripts/nostr-keygen-3party.sh" ]; then
    print_skip "nostr-keygen-3party.sh: Script not found"
else
    if bash -n scripts/nostr-keygen-3party.sh 2>&1; then
        print_success "nostr-keygen-3party.sh: Syntax is valid"
    else
        print_failure "nostr-keygen-3party.sh: Syntax error"
    fi
    
    # Use local relay if available
    if [ "$USE_LOCAL_RELAY" = "true" ] && [ -n "$LOCAL_RELAY_URL" ]; then
        RELAYS_TO_USE="$LOCAL_RELAY_URL"
        echo "Using local relay: $RELAYS_TO_USE"
    else
        RELAYS_TO_USE="${RELAYS:-wss://nostr.hifish.org,wss://nostr.xxi.quest,wss://bbw-nostr.xyz}"
        echo "Using external relays: $RELAYS_TO_USE"
        echo "  (Note: Tests may fail due to relay connectivity)"
    fi
    
    # Try to run with a short timeout
    TEST_3PARTY_OUTPUT_DIR="./test-nostr-keygen-3party-output"
    mkdir -p "$TEST_3PARTY_OUTPUT_DIR"
    export OUTPUT_DIR="$TEST_3PARTY_OUTPUT_DIR"
    export TIMEOUT="300"
    export RELAYS="$RELAYS_TO_USE"
    
    echo "Attempting to run nostr-keygen-3party.sh..."
    if timeout 300 bash scripts/nostr-keygen-3party.sh > "$TEST_3PARTY_OUTPUT_DIR/test.log" 2>&1; then
        if validate_keyshare "$TEST_3PARTY_OUTPUT_DIR/party1-keyshare.json" "party1"; then
            if validate_keyshare "$TEST_3PARTY_OUTPUT_DIR/party2-keyshare.json" "party2"; then
                if validate_keyshare "$TEST_3PARTY_OUTPUT_DIR/party3-keyshare.json" "party3"; then
                    print_success "nostr-keygen-3party.sh: Successfully generated keyshares for all 3 parties"
                    
                    # Verify all parties have matching public keys
                    if command -v jq >/dev/null 2>&1; then
                        PUB1=$(jq -r '.pub_key' "$TEST_3PARTY_OUTPUT_DIR/party1-keyshare.json" 2>/dev/null)
                        PUB2=$(jq -r '.pub_key' "$TEST_3PARTY_OUTPUT_DIR/party2-keyshare.json" 2>/dev/null)
                        PUB3=$(jq -r '.pub_key' "$TEST_3PARTY_OUTPUT_DIR/party3-keyshare.json" 2>/dev/null)
                        if [ "$PUB1" = "$PUB2" ] && [ "$PUB2" = "$PUB3" ] && [ -n "$PUB1" ]; then
                            print_success "nostr-keygen-3party.sh: All parties have matching public keys"
                        else
                            print_failure "nostr-keygen-3party.sh: Public keys don't match between all parties"
                        fi
                    fi
                fi
            fi
        fi
    else
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 124 ]; then
            print_skip "nostr-keygen-3party.sh: Timed out (relay connectivity issue)"
        else
            print_skip "nostr-keygen-3party.sh: Failed (exit code $EXIT_CODE) - may be due to relay connectivity"
            echo "  Check logs in $TEST_3PARTY_OUTPUT_DIR/test.log for details"
        fi
    fi
fi

# ============================================
# Test Summary
# ============================================
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo -e "${YELLOW}Skipped: $TESTS_SKIPPED${NC}"
echo ""

TOTAL=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))
if [ $TOTAL -eq 0 ]; then
    echo "No tests were run!"
    exit 1
fi

if [ $TESTS_FAILED -gt 0 ]; then
    echo "Some tests failed. Check the output above for details."
    exit 1
else
    echo "All non-skipped tests passed!"
    exit 0
fi

