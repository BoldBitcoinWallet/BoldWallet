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
MESSAGE=$("$BUILD_DIR/$BIN_NAME" random)

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
echo "MESSAGE: $MESSAGE"

# load keyshares
KEYSHARE1=$(cat "$PARTY1".ks)
KEYSHARE2=$(cat "$PARTY2".ks)

# Optional: Add error checking
if [ -z "$KEYSHARE1" ] || [ -z "$KEYSHARE2" ]; then
    echo "Error: Failed to read keyshare files"
    echo "Run Keygen before..."
    exit 1
fi

# Start Relay in the background and track its PID
echo "Starting Relay..."
"$BUILD_DIR/$BIN_NAME" relay "$PORT" &
PID0=$!

DERIVATION_PATH="m/44'/0'/0'/0/0"

sleep 1

# Start keysign for both parties
echo "Starting keysign for PARTY1..."
"$BUILD_DIR/$BIN_NAME" keysign "$SERVER" "$SESSION_ID" "$PARTY1" "$PARTIES" "$PUBLIC_KEY2" "$PRIVATE_KEY1" "$KEYSHARE1" "$DERIVATION_PATH" "$MESSAGE" &
PID1=$!

echo "Starting keysign for PARTY2..."
"$BUILD_DIR/$BIN_NAME" keysign "$SERVER" "$SESSION_ID" "$PARTY2" "$PARTIES" "$PUBLIC_KEY1" "$PRIVATE_KEY2" "$KEYSHARE2" "$DERIVATION_PATH" "$MESSAGE" &
PID2=$!

# Handle cleanup on exit
trap "echo 'Stopping processes...'; kill $PID0 $PID1 $PID2; exit" SIGINT SIGTERM

echo "keysign processes running. Press Ctrl+C to stop."

# Keep the script alive
wait