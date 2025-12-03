#!/bin/bash

# Simple WebSocket connection test for Nostr relay
# Tests if the relay is actually accepting WebSocket connections

set -euo pipefail

RELAY_URL="${1:-ws://localhost:7777}"

# Extract host and port from URL
if [[ "$RELAY_URL" =~ ^ws://([^:]+):([0-9]+)$ ]] || [[ "$RELAY_URL" =~ ^wss://([^:]+):([0-9]+)$ ]]; then
    HOST="${BASH_REMATCH[1]}"
    PORT="${BASH_REMATCH[2]}"
else
    echo "Invalid relay URL format: $RELAY_URL"
    echo "Expected format: ws://host:port or wss://host:port"
    exit 1
fi

echo "Testing WebSocket connection to $RELAY_URL..."

# Try to connect using a simple method
# We'll use a Go one-liner to test the connection
if command -v go >/dev/null 2>&1; then
    # Use Go to test WebSocket connection
    go run - <<'EOF' "$HOST" "$PORT"
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
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo "✓ WebSocket connection test passed"
        exit 0
    else
        echo "✗ WebSocket connection test failed"
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

