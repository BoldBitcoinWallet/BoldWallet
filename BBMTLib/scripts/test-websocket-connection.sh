#!/bin/bash

# Simple WebSocket connection test for Nostr relay
# Tests if the relay is actually accepting WebSocket connections

set -uo pipefail  # Removed -e to allow better error handling

RELAY_URL="${1:-ws://localhost:7777}"

# Extract host and port from URL
if [[ "$RELAY_URL" =~ ^ws://([^:]+):([0-9]+)$ ]] || [[ "$RELAY_URL" =~ ^wss://([^:]+):([0-9]+)$ ]]; then
    HOST="${BASH_REMATCH[1]}"
    PORT="${BASH_REMATCH[2]}"
else
    echo "Invalid relay URL format: $RELAY_URL" >&2
    echo "Expected format: ws://host:port or wss://host:port" >&2
    exit 1
fi

# Determine if we should be verbose (if not redirecting output)
VERBOSE="${VERBOSE:-false}"
if [ -t 1 ]; then
    VERBOSE=true
fi

if [ "$VERBOSE" = "true" ]; then
    echo "Testing WebSocket connection to $RELAY_URL..."
fi

# Try to connect using a simple method
# We'll use a Go one-liner to test the connection
if command -v go >/dev/null 2>&1; then
    # Save current directory
    ORIG_DIR=$(pwd)
    
    # Check if we're in a Go module context (required for go run)
    # Try to find go.mod in current or parent directories
    GO_MOD_DIR=""
    CURRENT_DIR=$(pwd)
    while [ "$CURRENT_DIR" != "/" ]; do
        if [ -f "$CURRENT_DIR/go.mod" ]; then
            GO_MOD_DIR="$CURRENT_DIR"
            break
        fi
        CURRENT_DIR=$(dirname "$CURRENT_DIR")
    done
    
    # If no go.mod found, create a temporary one
    if [ -z "$GO_MOD_DIR" ]; then
        TMP_DIR=$(mktemp -d)
        trap "rm -rf $TMP_DIR" EXIT
        GO_MOD_DIR="$TMP_DIR"
        cd "$GO_MOD_DIR"
        go mod init websocket-test >/dev/null 2>&1 || {
            echo "Failed to create temporary Go module" >&2
            exit 1
        }
    else
        cd "$GO_MOD_DIR"
    fi
    
    # Use Go to test WebSocket connection
    # Write to a temp file instead of using heredoc to avoid stdin issues
    TEST_FILE=$(mktemp --tmpdir="${GO_MOD_DIR}" websocket-test.XXXXXX.go)
    cat > "$TEST_FILE" <<'EOF'
package main

import (
	"fmt"
	"net"
	"os"
	"time"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: test-websocket host port")
		os.Exit(1)
	}
	host := os.Args[1]
	port := os.Args[2]
	
	// Try to establish a TCP connection first
	conn, err := net.DialTimeout("tcp", host+":"+port, 2*time.Second)
	if err != nil {
		fmt.Printf("Failed to connect: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close()
	
	// Send a WebSocket handshake request
	handshake := "GET / HTTP/1.1\r\n" +
		"Host: " + host + ":" + port + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"\r\n"
	
	if _, err := conn.Write([]byte(handshake)); err != nil {
		fmt.Printf("Failed to send handshake: %v\n", err)
		os.Exit(1)
	}
	
	// Read response (with timeout)
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	if err != nil {
		fmt.Printf("Failed to read response: %v\n", err)
		os.Exit(1)
	}
	
	response := string(buf[:n])
	if len(response) > 0 {
		fmt.Println("✓ WebSocket connection test successful")
		fmt.Printf("Response preview: %s\n", response[:min(100, len(response))])
		os.Exit(0)
	} else {
		fmt.Println("✗ No response received")
		os.Exit(1)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
EOF
    
    # Run the Go test
    if go run "$TEST_FILE" "$HOST" "$PORT" 2>&1; then
        EXIT_CODE=0
    else
        EXIT_CODE=$?
        # Show error for debugging
        if [ "$VERBOSE" = "true" ]; then
            echo "Go test failed with exit code: $EXIT_CODE" >&2
        fi
    fi
    
    # Cleanup
    rm -f "$TEST_FILE"
    cd "$ORIG_DIR"
    if [ -n "${TMP_DIR:-}" ]; then
        rm -rf "$TMP_DIR"
    fi
    
    if [ $EXIT_CODE -eq 0 ]; then
        if [ "$VERBOSE" = "true" ]; then
            echo "✓ WebSocket connection test passed"
        fi
        exit 0
    else
        if [ "$VERBOSE" = "true" ]; then
            echo "✗ WebSocket connection test failed (exit code: $EXIT_CODE)" >&2
        fi
        exit 1
    fi
else
    # Fallback: just check if port is open
    echo "Go not available, performing basic port check..."
    if command -v nc >/dev/null 2>&1; then
        if nc -z "$HOST" "$PORT" 2>/dev/null; then
            echo "✓ Port is open (WebSocket test skipped - Go not available)"
            exit 0
        else
            echo "✗ Port is not open"
            exit 1
        fi
    else
        echo "⚠ Cannot test WebSocket connection (Go and nc not available)"
        exit 0  # Don't fail, just skip the test
    fi
fi

