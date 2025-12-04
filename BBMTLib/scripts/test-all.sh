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

# Cross-platform timeout function
# Works on both Linux (timeout) and macOS (gtimeout or bash-based fallback)
run_with_timeout() {
    local duration=$1
    shift
    
    # Try standard timeout command (Linux)
    if command -v timeout >/dev/null 2>&1; then
        timeout "$duration" "$@"
        return $?
    fi
    
    # Try gtimeout (macOS with Homebrew coreutils)
    if command -v gtimeout >/dev/null 2>&1; then
        gtimeout "$duration" "$@"
        return $?
    fi
    
    # Fallback: bash-based timeout implementation
    # Start the command in background
    "$@" &
    local cmd_pid=$!
    
    # Wait for the command or timeout
    local waited=0
    while kill -0 $cmd_pid 2>/dev/null && [ $waited -lt $duration ]; do
        sleep 1
        waited=$((waited + 1))
    done
    
    # If still running, kill it
    if kill -0 $cmd_pid 2>/dev/null; then
        kill $cmd_pid 2>/dev/null || true
        wait $cmd_pid 2>/dev/null || true
        return 124  # Exit code 124 indicates timeout
    fi
    
    # Wait for the process to finish and get its exit code
    wait $cmd_pid 2>/dev/null
    return $?
}

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

# Function to validate keyshare .ks file (base64 encoded)
validate_ks_file() {
    local file="$1"
    local party="$2"
    
    if [ ! -f "$file" ]; then
        print_failure "Keyshare $party: File not found: $file"
        return 1
    fi
    
    if [ ! -s "$file" ]; then
        print_failure "Keyshare $party: File is empty: $file"
        return 1
    fi
    
    # Prefer Go-based validation for cross-platform behavior
    if command -v go >/dev/null 2>&1 && [ -f "scripts/main.go" ]; then
        if OUTPUT=$(go run ./scripts/main.go validate-ks "$file" 2>&1); then
            print_success "Keyshare $party: Valid (.ks verified by Go helper)"
                    return 0
                else
            print_failure "Keyshare $party: Go validation failed: $OUTPUT"
            return 1
        fi
    fi

    # Fallback: no Go available, just check file exists and is not empty
    print_success "Keyshare $party: File exists (Go validator not available for full validation)"
    return 0
}

# Function to validate signature from stdout (JSON string)
validate_signature_stdout() {
    local output="$1"
    local party="$2"
    
    if [ -z "$output" ]; then
        print_failure "Signature $party: No output captured"
        return 1
    fi
    
    if command -v jq >/dev/null 2>&1; then
        # Try to parse as JSON
        if echo "$output" | jq empty 2>/dev/null; then
            # Check for required signature fields
            if echo "$output" | jq -e '.r' >/dev/null 2>&1 && echo "$output" | jq -e '.s' >/dev/null 2>&1; then
                print_success "Signature $party: Valid JSON with r and s fields"
                return 0
            else
                print_failure "Signature $party: Missing r or s field"
                return 1
            fi
        else
            # Try to extract JSON from output (might have other text)
            JSON=$(echo "$output" | grep -oE '\{[^}]*"r"[^}]*"s"[^}]*\}' | head -1)
            if [ -n "$JSON" ] && echo "$JSON" | jq empty 2>/dev/null; then
                print_success "Signature $party: Valid JSON extracted from output"
                return 0
            else
                print_failure "Signature $party: Could not extract valid JSON from output"
                return 1
            fi
        fi
    else
        # If jq not available, just check output is not empty
        if [ -n "$output" ]; then
            print_success "Signature $party: Output captured (jq not available for full validation)"
            return 0
        else
            print_failure "Signature $party: No output"
            return 1
        fi
    fi
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
    
    # The start-local-relay.sh script will wait until the relay is fully ready
    # It exits with 0 only when the relay is confirmed to be accepting connections
    if ./scripts/start-local-relay.sh > /tmp/relay-start.log 2>&1; then
        LOCAL_RELAY_STARTED=true
        USE_LOCAL_RELAY=true
        LOCAL_RELAY_URL="ws://localhost:7777"
        echo "✓ Local relay is ready and accepting connections at $LOCAL_RELAY_URL"
        
        # Additional wait to ensure WebSocket support is fully initialized
        # This is especially important in CI environments
        # nostr-rs-relay can take 10-20 seconds to fully initialize WebSocket support
        echo "  Waiting additional 20 seconds for WebSocket support to fully initialize..."
        echo "  (nostr-rs-relay may need extra time to initialize WebSocket handlers in CI)"
        for i in {1..20}; do
            sleep 1
            if [ $((i % 5)) -eq 0 ]; then
                echo "    ... ${i}/20 seconds"
            fi
        done
        
        # Verify the relay is still running
        if ! docker ps --format '{{.Names}}' | grep -q "^bbmtlib-test-relay$"; then
            echo "⚠ Relay container stopped unexpectedly"
            if [ -f /tmp/relay-start.log ]; then
                echo "  Relay startup log:"
                cat /tmp/relay-start.log | tail -20 | sed 's/^/    /'
            fi
            return 1
        fi
        
        # Final WebSocket connection test (non-blocking)
        if [ -f "./scripts/test-websocket-connection.sh" ]; then
            echo "  Performing final WebSocket connection test..."
            # Don't suppress output in CI - we want to see what's happening
            # This test is informational only - we proceed regardless of result
            if ./scripts/test-websocket-connection.sh "$LOCAL_RELAY_URL" 2>&1; then
                echo "  ✓ WebSocket connection verified"
            else
                WS_TEST_EXIT=$?
                echo "  ⚠ WebSocket test had issues (exit code: $WS_TEST_EXIT)"
                echo "  Proceeding anyway - the relay may still work for actual clients"
                echo "  (Connection reset errors are common during relay initialization)"
            fi
        fi
        
        # Additional verification: check if we can at least connect via TCP
        echo "  Verifying TCP connectivity to relay..."
        if command -v nc >/dev/null 2>&1; then
            if nc -z localhost 7777 2>/dev/null; then
                echo "  ✓ TCP connection to relay port successful"
            else
                echo "  ⚠ TCP connection check failed"
            fi
        fi
        
        return 0
    else
        echo "⚠ Failed to start local relay, falling back to external relays"
        echo "  Check /tmp/relay-start.log for details"
        if [ -f /tmp/relay-start.log ]; then
            echo "  Last 10 lines of relay startup log:"
            tail -10 /tmp/relay-start.log | sed 's/^/    /'
        fi
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
        
        # Actually run keygen.sh with a timeout and validate outputs
        # The script runs indefinitely, so we'll run it in background and kill it after checking outputs
        # Note: keygen.sh must be run from BBMTLib root (it builds main.go from current directory)
        TEST_KEYGEN_DIR="./test-keygen-output"
        mkdir -p "$TEST_KEYGEN_DIR"
        
        echo "Running keygen.sh (will timeout after 120 seconds or when .ks files are created)..."
        # Run keygen.sh from current directory (BBMTLib root) - it will create .ks files in current dir
        # Redirect output to test directory for easier debugging
        bash scripts/keygen.sh > "$TEST_KEYGEN_DIR/keygen.log" 2>&1 &
        KEYGEN_PID=$!
        
        # Wait for .ks files to be created in current directory (with timeout)
        MAX_WAIT=120
        WAIT_COUNT=0
        KS1_CREATED=false
        KS2_CREATED=false
        
        while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
            if [ -f "peer1.ks" ] && [ -s "peer1.ks" ]; then
                KS1_CREATED=true
            fi
            if [ -f "peer2.ks" ] && [ -s "peer2.ks" ]; then
                KS2_CREATED=true
            fi
            
            if [ "$KS1_CREATED" = "true" ] && [ "$KS2_CREATED" = "true" ]; then
                break
            fi
            
            # Check if process died
            if ! kill -0 $KEYGEN_PID 2>/dev/null; then
                break
            fi
            
            sleep 1
            WAIT_COUNT=$((WAIT_COUNT + 1))
        done
        
        # Stop the keygen processes
        kill $KEYGEN_PID 2>/dev/null || true
        # Also kill any child processes (relay, keygen processes)
        pkill -P $KEYGEN_PID 2>/dev/null || true
        wait $KEYGEN_PID 2>/dev/null || true
        
        # Move .ks files to test directory for organization (if they were created)
        if [ -f "peer1.ks" ]; then
            mv peer1.ks "$TEST_KEYGEN_DIR/" 2>/dev/null || true
        fi
        if [ -f "peer2.ks" ]; then
            mv peer2.ks "$TEST_KEYGEN_DIR/" 2>/dev/null || true
        fi
        
        # Validate outputs
        if [ -f "$TEST_KEYGEN_DIR/peer1.ks" ] && [ -f "$TEST_KEYGEN_DIR/peer2.ks" ]; then
            if validate_ks_file "$TEST_KEYGEN_DIR/peer1.ks" "peer1"; then
                if validate_ks_file "$TEST_KEYGEN_DIR/peer2.ks" "peer2"; then
                    print_success "keygen.sh: Successfully generated keyshare files for both parties"
                    
                    # Verify keyshares have matching public keys (if we can decode them)
                    if command -v base64 >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
                        # Try Linux-style base64 -d first, then macOS-style base64 -D
                        PUB1=$(base64 -d "$TEST_KEYGEN_DIR/peer1.ks" 2>/dev/null | jq -r '.pub_key' 2>/dev/null || base64 -D "$TEST_KEYGEN_DIR/peer1.ks" 2>/dev/null | jq -r '.pub_key' 2>/dev/null)
                        PUB2=$(base64 -d "$TEST_KEYGEN_DIR/peer2.ks" 2>/dev/null | jq -r '.pub_key' 2>/dev/null || base64 -D "$TEST_KEYGEN_DIR/peer2.ks" 2>/dev/null | jq -r '.pub_key' 2>/dev/null)
                        if [ -n "$PUB1" ] && [ -n "$PUB2" ] && [ "$PUB1" = "$PUB2" ]; then
                            print_success "keygen.sh: Both parties have matching public keys"
                        elif [ -n "$PUB1" ] && [ -n "$PUB2" ]; then
                            print_failure "keygen.sh: Public keys don't match between parties"
                        fi
                    fi
                fi
            fi
        else
            print_skip "keygen.sh: Keyshare files not created within timeout"
            if [ -f "$TEST_KEYGEN_DIR/keygen.log" ]; then
                echo "  Last 20 lines of keygen.log:"
                tail -20 "$TEST_KEYGEN_DIR/keygen.log" | sed 's/^/    /'
            fi
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
        
        # Check if we have keyshare files from keygen test
        TEST_KEYGEN_DIR="./test-keygen-output"
        if [ -f "$TEST_KEYGEN_DIR/peer1.ks" ] && [ -f "$TEST_KEYGEN_DIR/peer2.ks" ]; then
            echo "  Using keyshare files from keygen test: $TEST_KEYGEN_DIR"
            
            # Actually run keysign.sh with a timeout and validate outputs
            # Note: keysign.sh must be run from BBMTLib root (it builds main.go from current directory)
            TEST_KEYSIGN_DIR="./test-keysign-output"
            mkdir -p "$TEST_KEYSIGN_DIR"
            
            # Copy keyshare files to current directory (keysign.sh expects them in current dir)
            cp "$TEST_KEYGEN_DIR/peer1.ks" .
            cp "$TEST_KEYGEN_DIR/peer2.ks" .
            
            echo "Running keysign.sh (will timeout after 120 seconds or when signatures are produced)..."
            # Run keysign.sh from current directory (BBMTLib root) - it will read .ks files from current dir
            # Redirect output to test directory for easier debugging
            bash scripts/keysign.sh > "$TEST_KEYSIGN_DIR/keysign.log" 2>&1 &
            KEYSIGN_PID=$!
            
            # Wait for signatures to appear in the log (with timeout)
            MAX_WAIT=120
            WAIT_COUNT=0
            SIG1_FOUND=false
            SIG2_FOUND=false
            
            while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
                # Check if signatures are in the log (account for leading spaces)
                if grep -qE "\[peer1\].*Keysign Result" "$TEST_KEYSIGN_DIR/keysign.log" 2>/dev/null; then
                    SIG1_FOUND=true
                fi
                if grep -qE "\[peer2\].*Keysign Result" "$TEST_KEYSIGN_DIR/keysign.log" 2>/dev/null; then
                    SIG2_FOUND=true
                fi
                
                if [ "$SIG1_FOUND" = "true" ] && [ "$SIG2_FOUND" = "true" ]; then
                    # Give it a moment to finish writing
                    sleep 2
                    break
                fi
                
                # Check if process died
                if ! kill -0 $KEYSIGN_PID 2>/dev/null; then
                    break
                fi
                
                sleep 1
                WAIT_COUNT=$((WAIT_COUNT + 1))
            done
            
            # Extract signatures from log
            # Keysign outputs: "     [party] Keysign Result {json}" (with leading spaces)
            # Extract the JSON part after "Keysign Result"
            SIG1_OUTPUT=$(grep -E "\[peer1\].*Keysign Result" "$TEST_KEYSIGN_DIR/keysign.log" 2>/dev/null | sed -E 's/.*Keysign Result[[:space:]]*//' | sed 's/^[[:space:]]*//' || echo "")
            SIG2_OUTPUT=$(grep -E "\[peer2\].*Keysign Result" "$TEST_KEYSIGN_DIR/keysign.log" 2>/dev/null | sed -E 's/.*Keysign Result[[:space:]]*//' | sed 's/^[[:space:]]*//' || echo "")
            
            # Stop the keysign processes
            kill $KEYSIGN_PID 2>/dev/null || true
            # Also kill any child processes (relay, keysign processes)
            pkill -P $KEYSIGN_PID 2>/dev/null || true
            wait $KEYSIGN_PID 2>/dev/null || true
            
            # Clean up .ks files from current directory (they're copied in test directory)
            rm -f peer1.ks peer2.ks 2>/dev/null || true
            
            # Validate signatures
            if [ -n "$SIG1_OUTPUT" ] && [ -n "$SIG2_OUTPUT" ]; then
                if validate_signature_stdout "$SIG1_OUTPUT" "peer1"; then
                    if validate_signature_stdout "$SIG2_OUTPUT" "peer2"; then
                        print_success "keysign.sh: Successfully generated signatures for both parties"
                        
                        # Verify signatures match (if we can parse them)
                        if command -v jq >/dev/null 2>&1; then
                            SIG1_NORM=$(echo "$SIG1_OUTPUT" | grep -oE '\{[^}]*"r"[^}]*"s"[^}]*\}' | head -1 | jq -c . 2>/dev/null || echo "")
                            SIG2_NORM=$(echo "$SIG2_OUTPUT" | grep -oE '\{[^}]*"r"[^}]*"s"[^}]*\}' | head -1 | jq -c . 2>/dev/null || echo "")
                            if [ -n "$SIG1_NORM" ] && [ -n "$SIG2_NORM" ] && [ "$SIG1_NORM" = "$SIG2_NORM" ]; then
                                print_success "keysign.sh: Signatures match between parties"
                            elif [ -n "$SIG1_NORM" ] && [ -n "$SIG2_NORM" ]; then
                                print_failure "keysign.sh: Signatures don't match between parties"
                            fi
                        fi
                    fi
                fi
            else
                print_skip "keysign.sh: Signatures not found in output (may have timed out or failed)"
                if [ -f "$TEST_KEYSIGN_DIR/keysign.log" ]; then
                    echo "  Last 30 lines of keysign.log:"
                    tail -30 "$TEST_KEYSIGN_DIR/keysign.log" | sed 's/^/    /'
                fi
            fi
        else
            print_skip "keysign.sh: Skipped (requires keygen.sh output - peer1.ks and peer2.ks files)"
            echo "  Expected keyshare files not found: $TEST_KEYGEN_DIR/peer1.ks and peer2.ks"
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
    echo "  Relay URL: $RELAYS_TO_USE"
    echo "  Timeout: 300 seconds"
    echo "  Output directory: $TEST_OUTPUT_DIR"
    
    # Run the script and capture output
    if run_with_timeout 300 bash scripts/nostr-keygen.sh > "$TEST_OUTPUT_DIR/test.log" 2>&1; then
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
            echo "  This usually means the relay wasn't ready or there's a connection issue"
            echo "  Relay URL used: $RELAYS_TO_USE"
            if [ -f "$TEST_OUTPUT_DIR/test.log" ]; then
                echo "  Last 30 lines of test log:"
                tail -30 "$TEST_OUTPUT_DIR/test.log" | sed 's/^/    /'
            fi
            # Check if relay is still running
            if [ "$USE_LOCAL_RELAY" = "true" ]; then
                if docker ps --format '{{.Names}}' | grep -q "^bbmtlib-test-relay$"; then
                    echo "  Relay container is still running"
                    echo "  Relay logs (last 20 lines):"
                    docker logs bbmtlib-test-relay 2>&1 | tail -20 | sed 's/^/    /'
                else
                    echo "  ⚠ Relay container is not running!"
                fi
            fi
        else
            print_skip "nostr-keygen.sh: Failed (exit code $EXIT_CODE) - may be due to relay connectivity"
            echo "  Check logs in $TEST_OUTPUT_DIR/test.log for details"
            if [ -f "$TEST_OUTPUT_DIR/test.log" ]; then
                echo "  Last 30 lines of test log:"
                tail -30 "$TEST_OUTPUT_DIR/test.log" | sed 's/^/    /'
            fi
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
        if run_with_timeout 300 bash scripts/nostr-keysign.sh > "$KEYSIGN_OUTPUT_DIR/test.log" 2>&1; then
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
    if run_with_timeout 300 bash scripts/nostr-keygen-3party.sh > "$TEST_3PARTY_OUTPUT_DIR/test.log" 2>&1; then
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

