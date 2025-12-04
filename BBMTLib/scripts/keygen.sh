#!/bin/bash

set -e  # Exit on error
set -o pipefail  # Catch errors in pipes

BIN_NAME="bbmt"
BUILD_DIR="./bin"

# Ensure build directory exists
mkdir -p "$BUILD_DIR"

# Build the Go binary
echo "Building the Go binary..."
go build -o "$BUILD_DIR/$BIN_NAME" ./scripts/main.go

# Generate key pairs
KEYPAIR1=$("$BUILD_DIR/$BIN_NAME" keypair)
KEYPAIR2=$("$BUILD_DIR/$BIN_NAME" keypair)

PRIVATE_KEY1=$(echo "$KEYPAIR1" | jq -r '.privateKey')
PRIVATE_KEY2=$(echo "$KEYPAIR2" | jq -r '.privateKey')

PUBLIC_KEY1=$(echo "$KEYPAIR1" | jq -r '.publicKey')
PUBLIC_KEY2=$(echo "$KEYPAIR2" | jq -r '.publicKey')

# Generate random session ID and chain code
SESSION_ID=$("$BUILD_DIR/$BIN_NAME" random)
CHAIN_CODE=$("$BUILD_DIR/$BIN_NAME" random)

# Server and party details
PORT=55055
HOST="127.0.0.1"
SERVER="http://$HOST:$PORT"

PARTY1="peer1"
PARTY2="peer2"
PARTIES="$PARTY1,$PARTY2"  # Participants

echo "Generated Parameters:"

echo "PARTY1: $PARTY1"
echo "PARTY2: $PARTY2"

echo "KEYPAIR1: $KEYPAIR1"
echo "KEYPAIR2: $KEYPAIR2"

echo "PRIVATE_KEY1: $PRIVATE_KEY1"
echo "PRIVATE_KEY2: $PRIVATE_KEY2"

echo "PUBLIC_KEY1: $PUBLIC_KEY1"
echo "PUBLIC_KEY2: $PUBLIC_KEY2"

echo "SESSION ID: $SESSION_ID"
echo "CHAIN CODE: $CHAIN_CODE"

# Start Relay in the background and track its PID
echo "Starting Relay..."
"$BUILD_DIR/$BIN_NAME" relay "$PORT" &
PID0=$!

# Start Keygen for both parties
echo "Starting Keygen for PARTY1..."
"$BUILD_DIR/$BIN_NAME" keygen "$SERVER" "$SESSION_ID" "$CHAIN_CODE" "$PARTY1" "$PARTIES" "$PUBLIC_KEY2" "$PRIVATE_KEY1" &
PID1=$!

echo "Starting Keygen for PARTY2..."
"$BUILD_DIR/$BIN_NAME" keygen "$SERVER" "$SESSION_ID" "$CHAIN_CODE" "$PARTY2" "$PARTIES" "$PUBLIC_KEY1" "$PRIVATE_KEY2" &
PID2=$!

# Handle cleanup on exit
trap "echo 'Stopping processes...'; kill $PID0 $PID1 $PID2; exit" SIGINT SIGTERM

echo "Keygen processes running. Press Ctrl+C to stop."

# Keep the script alive
wait