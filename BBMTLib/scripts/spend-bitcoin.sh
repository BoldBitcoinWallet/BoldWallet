#!/bin/bash

set -e  # Exit on error
set -o pipefail  # Catch errors in pipes

BIN_NAME="bbmt"
BUILD_DIR="./bin"

print_usage() {
  cat <<EOF
Usage:
  $0 \\
    --to-address <address> \\
    --amount-sats <amount> \\
    --fee-sats <fee> \\
    --network <mainnet|testnet3> \\
    --mempool-url <url> \\
    [--derivation-path <path>] \\
    [--address-type <p2pkh|p2wpkh|p2sh-p2wpkh|p2tr>] \\
    [--passphrase1 <passphrase>] \\
    [--passphrase2 <passphrase>] \\
    [--preview]

Examples:
  $0 \\
    --to-address tb1qdest... \\
    --amount-sats 10000 \\
    --fee-sats 300 \\
    --network testnet3 \\
    --mempool-url https://mempool.space/testnet/api \\
    --derivation-path "m/84'/1'/0'/0/0" \\
    --address-type p2wpkh \\
    --passphrase1 "party1 secret" \\
    --passphrase2 "party2 secret" \\
    --preview

Notes:
  - Keyshares must already exist as peer1.ks and peer2.ks by default
    (use --keyshare1 / --keyshare2 to override paths if needed)
  - If --passphrase1/--passphrase2 are provided, the corresponding keyshare files
    are expected to be AES-encrypted (base64) using the same scheme as the mobile app
    (key = sha256(passphrase))
  - Each keyshare can have its own passphrase, or both can be unencrypted
  - You should normally estimate the fee beforehand (e.g. via the wallet UI)
EOF
}

# Defaults
DERIVATION_PATH="m/84'/1'/0'/0/0"
ADDRESS_TYPE="p2wpkh"  # p2pkh | p2wpkh | p2sh-p2wpkh | p2tr
KEYSHARE1_FILE="peer1.ks"
KEYSHARE2_FILE="peer2.ks"
PREVIEW=false

# Parse named arguments (flags)
POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to-address)
      TO_ADDRESS="$2"
      shift 2
      ;;
    --amount-sats)
      AMOUNT_SATOSHIS="$2"
      shift 2
      ;;
    --fee-sats)
      FEE_SATOSHI="$2"
      shift 2
      ;;
    --network)
      NETWORK="$2"   # mainnet | testnet3
      shift 2
      ;;
    --mempool-url)
      MEMPOOL_URL="$2"  # e.g. https://mempool.space/testnet/api
      shift 2
      ;;
    --derivation-path)
      DERIVATION_PATH="$2"
      shift 2
      ;;
    --address-type)
      ADDRESS_TYPE="$2"
      shift 2
      ;;
    --keyshare1)
      KEYSHARE1_FILE="$2"
      shift 2
      ;;
    --keyshare2)
      KEYSHARE2_FILE="$2"
      shift 2
      ;;
    --passphrase1)
      PASSPHRASE1="$2"
      shift 2
      ;;
    --passphrase2)
      PASSPHRASE2="$2"
      shift 2
      ;;
    --preview)
      PREVIEW=true
      shift 1
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1"
      print_usage
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

# Backwards-compatible positional parsing if flags weren't used
if [ -z "${TO_ADDRESS:-}" ] && [ "${#POSITIONAL_ARGS[@]}" -ge 5 ]; then
  TO_ADDRESS="${POSITIONAL_ARGS[0]}"
  AMOUNT_SATOSHIS="${POSITIONAL_ARGS[1]}"
  FEE_SATOSHI="${POSITIONAL_ARGS[2]}"
  NETWORK="${POSITIONAL_ARGS[3]}"
  MEMPOOL_URL="${POSITIONAL_ARGS[4]}"
  if [ "${#POSITIONAL_ARGS[@]}" -ge 6 ]; then
    DERIVATION_PATH="${POSITIONAL_ARGS[5]}"
  fi
  if [ "${#POSITIONAL_ARGS[@]}" -ge 7 ]; then
    ADDRESS_TYPE="${POSITIONAL_ARGS[6]}"
  fi
fi

# Validate required parameters
MISSING_ARGS=()
if [ -z "${TO_ADDRESS:-}" ]; then
  MISSING_ARGS+=("--to-address")
fi
if [ -z "${AMOUNT_SATOSHIS:-}" ]; then
  MISSING_ARGS+=("--amount-sats")
fi
# --fee-sats is only required when NOT in preview mode
if [ "$PREVIEW" != true ] && [ -z "${FEE_SATOSHI:-}" ]; then
  MISSING_ARGS+=("--fee-sats")
fi
if [ -z "${NETWORK:-}" ]; then
  MISSING_ARGS+=("--network")
fi
if [ -z "${MEMPOOL_URL:-}" ]; then
  MISSING_ARGS+=("--mempool-url")
fi

if [ ${#MISSING_ARGS[@]} -gt 0 ]; then
  echo "Error: missing required arguments:"
  for arg in "${MISSING_ARGS[@]}"; do
    echo "  - $arg"
  done
  echo ""
  print_usage
  exit 1
fi

# Ensure build directory exists
mkdir -p "$BUILD_DIR"

# Build the Go binary
echo "Building the Go binary..."
go build -o "$BUILD_DIR/$BIN_NAME" ./scripts/main.go

# Generate ephemeral transport key pairs (for MPC transport encryption)
KEYPAIR1=$("$BUILD_DIR/$BIN_NAME" keypair)
KEYPAIR2=$("$BUILD_DIR/$BIN_NAME" keypair)

PRIVATE_KEY1=$(echo "$KEYPAIR1" | jq -r '.privateKey')
PRIVATE_KEY2=$(echo "$KEYPAIR2" | jq -r '.privateKey')

PUBLIC_KEY1=$(echo "$KEYPAIR1" | jq -r '.publicKey')
PUBLIC_KEY2=$(echo "$KEYPAIR2" | jq -r '.publicKey')

# Session ID for this MPC spend
SESSION_ID=$("$BUILD_DIR/$BIN_NAME" random)

# Server and party details
PORT=55055
HOST="127.0.0.1"
SERVER="http://$HOST:$PORT"

PARTY1="peer1"
PARTY2="peer2"
PARTIES="$PARTY1,$PARTY2"  # Participants

echo "Spend Parameters:"
echo "  TO_ADDRESS      : $TO_ADDRESS"
echo "  AMOUNT_SATOSHIS: $AMOUNT_SATOSHIS"
echo "  FEE_SATOSHI    : $FEE_SATOSHI"
echo "  NETWORK        : $NETWORK"
echo "  MEMPOOL_URL    : $MEMPOOL_URL"
echo "  DERIVATION_PATH: $DERIVATION_PATH"
echo "  ADDRESS_TYPE   : $ADDRESS_TYPE"
echo ""
echo "MPC Session:"
echo "  SERVER   : $SERVER"
echo "  SESSION_ID: $SESSION_ID"
echo "  PARTIES  : $PARTIES"

# Load keyshares (must have been generated by keygen.sh or imported already)
RAW_KEYSHARE1=$(cat "$KEYSHARE1_FILE")
RAW_KEYSHARE2=$(cat "$KEYSHARE2_FILE")

if [ -z "$RAW_KEYSHARE1" ] || [ -z "$RAW_KEYSHARE2" ]; then
  echo "Error: Failed to read keyshare files"
  echo "Expected keyshare files:"
  echo "  KEYSHARE1: $KEYSHARE1_FILE"
  echo "  KEYSHARE2: $KEYSHARE2_FILE"
  echo "Run keygen.sh or provide correct --keyshare1/--keyshare2 paths before running spend-bitcoin.sh"
  exit 1
fi

# Decrypt keyshares if passphrases are provided (each keyshare can have its own passphrase)
#   key = sha256(passphrase), then AES-CBC decrypt (base64 input) via bbmt aes-decrypt
if [ -n "${PASSPHRASE1:-}" ]; then
  echo "Decrypting keyshare1 ($KEYSHARE1_FILE) with provided passphrase1..."
  KEY1_HEX=$("$BUILD_DIR/$BIN_NAME" sha256 "$PASSPHRASE1")
  KEYSHARE1=$("$BUILD_DIR/$BIN_NAME" aes-decrypt "$RAW_KEYSHARE1" "$KEY1_HEX")
else
  KEYSHARE1="$RAW_KEYSHARE1"
fi

if [ -n "${PASSPHRASE2:-}" ]; then
  echo "Decrypting keyshare2 ($KEYSHARE2_FILE) with provided passphrase2..."
  KEY2_HEX=$("$BUILD_DIR/$BIN_NAME" sha256 "$PASSPHRASE2")
  KEYSHARE2=$("$BUILD_DIR/$BIN_NAME" aes-decrypt "$RAW_KEYSHARE2" "$KEY2_HEX")
else
  KEYSHARE2="$RAW_KEYSHARE2"
fi

if [ "$PREVIEW" = true ]; then
  echo "Preview mode enabled - estimating fee only (HalfHourFee / 30m policy)..."
  EST_FEE=$("$BUILD_DIR/$BIN_NAME" estimate-fees-spend \
    "$KEYSHARE1" \
    "$DERIVATION_PATH" \
    "$ADDRESS_TYPE" \
    "$TO_ADDRESS" \
    "$AMOUNT_SATOSHIS" \
    "$NETWORK" \
    "$MEMPOOL_URL")
  echo "Estimated fee (satoshis): $EST_FEE"
  exit 0
fi

# Start Relay in the background and track its PID
echo "Starting Relay..."
"$BUILD_DIR/$BIN_NAME" relay "$PORT" &
PID0=$!

sleep 1

echo "Starting MPC spend for PARTY1 and PARTY2..."

# PARTY1 runs with PARTY2's public key as encKey and its own private key as decKey
"$BUILD_DIR/$BIN_NAME" spend \
  "$SERVER" \
  "$SESSION_ID" \
  "$PARTY1" \
  "$PARTIES" \
  "$PUBLIC_KEY2" \
  "$PRIVATE_KEY1" \
  "$KEYSHARE1" \
  "$DERIVATION_PATH" \
  "$ADDRESS_TYPE" \
  "$TO_ADDRESS" \
  "$AMOUNT_SATOSHIS" \
  "$FEE_SATOSHI" \
  "$NETWORK" \
  "$MEMPOOL_URL" &
PID1=$!

# PARTY2 runs with PARTY1's public key as encKey and its own private key as decKey
"$BUILD_DIR/$BIN_NAME" spend \
  "$SERVER" \
  "$SESSION_ID" \
  "$PARTY2" \
  "$PARTIES" \
  "$PUBLIC_KEY1" \
  "$PRIVATE_KEY2" \
  "$KEYSHARE2" \
  "$DERIVATION_PATH" \
  "$ADDRESS_TYPE" \
  "$TO_ADDRESS" \
  "$AMOUNT_SATOSHIS" \
  "$FEE_SATOSHI" \
  "$NETWORK" \
  "$MEMPOOL_URL" &
PID2=$!

# Handle cleanup on exit
trap "echo 'Stopping processes...'; kill $PID0 $PID1 $PID2 2>/dev/null; exit" SIGINT SIGTERM

echo "MPC spend processes running. Press Ctrl+C to stop."

wait

