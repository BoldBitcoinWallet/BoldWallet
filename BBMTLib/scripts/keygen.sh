#!/bin/bash

set -e  # Exit on error
set -o pipefail  # Catch errors in pipes

# FIPS 140-3 by default (override with GOFIPS140=off or GODEBUG= to disable)
export GOFIPS140="${GOFIPS140:-v1.0.0}"
export GODEBUG="${GODEBUG:+$GODEBUG,}fips140=on"

BIN_NAME="bbmt"
BUILD_DIR="./bin"

print_usage() {
  cat <<EOF
Usage:
  $0 [--network <mainnet|testnet3>] [--address-type <p2pkh|p2wpkh|p2sh-p2wpkh|p2tr>]

Options:
  --network        Network to use (default: testnet3)
  --address-type   Address type (default: p2pkh)
                   Options: p2pkh, p2wpkh, p2sh-p2wpkh, p2tr

Examples:
  # Testnet P2PKH (default)
  $0

  # Mainnet SegWit Native
  $0 --network mainnet --address-type p2wpkh

  # Testnet SegWit Compatible
  $0 --network testnet3 --address-type p2sh-p2wpkh
EOF
}

# Defaults
NETWORK="testnet3"
ADDRESS_TYPE="p2pkh"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --address-type)
      ADDRESS_TYPE="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
done

# Determine derivation path based on network and address type
case "$ADDRESS_TYPE" in
  p2pkh|legacy)
    if [ "$NETWORK" = "mainnet" ]; then
      DERIVATION_PATH="m/44'/0'/0'/0/0"
    else
      DERIVATION_PATH="m/44'/1'/0'/0/0"
    fi
    ;;
  p2wpkh|segwit|bech32)
    if [ "$NETWORK" = "mainnet" ]; then
      DERIVATION_PATH="m/84'/0'/0'/0/0"
    else
      DERIVATION_PATH="m/84'/1'/0'/0/0"
    fi
    ;;
  p2sh-p2wpkh|p2sh)
    if [ "$NETWORK" = "mainnet" ]; then
      DERIVATION_PATH="m/49'/0'/0'/0/0"
    else
      DERIVATION_PATH="m/49'/1'/0'/0/0"
    fi
    ;;
  p2tr|taproot)
    if [ "$NETWORK" = "mainnet" ]; then
      DERIVATION_PATH="m/86'/0'/0'/0/0"
    else
      DERIVATION_PATH="m/86'/1'/0'/0/0"
    fi
    ;;
  *)
    echo "Error: Invalid address type: $ADDRESS_TYPE"
    echo "Valid options: p2pkh, p2wpkh, p2sh-p2wpkh, p2tr"
    exit 1
    ;;
esac

# Run from BBMTLib root (script may be invoked from BBMTLib or BBMTLib/scripts)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
echo ""
echo "Configuration:"
echo "  NETWORK        : $NETWORK"
echo "  ADDRESS_TYPE   : $ADDRESS_TYPE"
echo "  DERIVATION_PATH: $DERIVATION_PATH"
echo ""
echo "Note: The keyshare is network-agnostic. Use the derivation path above"
echo "      when spending funds with spend-bitcoin.sh"

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