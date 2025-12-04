#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RELAYS_DEFAULT="wss://nostr.hifish.org,wss://nostr.xxi.quest,wss://bbw-nostr.xyz"
RELAYS="${RELAYS:-$RELAYS_DEFAULT}"
TIMEOUT="${TIMEOUT:-90}"
OUTPUT_DIR="${OUTPUT_DIR:-./nostr-keygen-output}"
mkdir -p "$OUTPUT_DIR"

random_hex() {
	go run ./scripts/main.go random
}

generate_keypair() {
	go run ./scripts/main.go nostr-keypair
}

read -r NSEC1 NPUB1 <<<"$(generate_keypair | awk -F',' '{print $1" "$2}')"
read -r NSEC2 NPUB2 <<<"$(generate_keypair | awk -F',' '{print $1" "$2}')"

SESSION_ID="$(random_hex)"
SESSION_KEY="$(random_hex)"
CHAINCODE="$(random_hex)"

echo "=== Generated Parameters ==="
echo "Relays      : $RELAYS"
echo "Session ID  : $SESSION_ID"
echo "Session Key : $SESSION_KEY"
echo "Chaincode   : $CHAINCODE"
echo ""
echo "Party 1 npub: $NPUB1"
echo "Party 1 nsec: $NSEC1"
echo ""
echo "Party 2 npub: $NPUB2"
echo "Party 2 nsec: $NSEC2"
echo "============================"

run_party() {
	local nsec="$1"
	local npub="$2"
	local peers="$3"
	local output="$4"

	NOSTR_NSEC="$nsec" go run ./tss/cmd/nostr-keygen \
		-relays "$RELAYS" \
		-npub "$npub" \
		-peers "$peers" \
		-session "$SESSION_ID" \
		-session-key "$SESSION_KEY" \
		-chaincode "$CHAINCODE" \
		-timeout "$TIMEOUT" \
		-output "$output"
}

PARTY1_OUTPUT="$OUTPUT_DIR/party1-keyshare.json"
PARTY2_OUTPUT="$OUTPUT_DIR/party2-keyshare.json"

echo ""
echo "Starting Nostr keygen for both parties in parallel..."

# Record start time
START_TIME=$(date +%s)

# Run both parties in background
run_party "$NSEC1" "$NPUB1" "$NPUB2" "$PARTY1_OUTPUT" > "$OUTPUT_DIR/party1.log" 2>&1 &
PID1=$!

run_party "$NSEC2" "$NPUB2" "$NPUB1" "$PARTY2_OUTPUT" > "$OUTPUT_DIR/party2.log" 2>&1 &
PID2=$!

# Handle cleanup on exit
trap "echo 'Stopping processes...'; kill $PID1 $PID2 2>/dev/null; exit" SIGINT SIGTERM

echo "Party 1 PID: $PID1"
echo "Party 2 PID: $PID2"
echo "Logs: $OUTPUT_DIR/party1.log and $OUTPUT_DIR/party2.log"
echo ""
echo "Waiting for keygen to complete..."

# Wait for both processes
wait $PID1
EXIT1=$?

wait $PID2
EXIT2=$?

# Calculate elapsed time
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))

echo ""
if [ $EXIT1 -eq 0 ] && [ $EXIT2 -eq 0 ]; then
	echo "✓ Keygen completed successfully!"
	echo "Time elapsed: ${MINUTES}m ${SECONDS}s"
	echo ""
	
	# Extract and display public keys and BTC addresses
	if [ -f "$PARTY1_OUTPUT" ] && [ -f "$PARTY2_OUTPUT" ]; then
		go run ./scripts/main.go show-keyshare "$PARTY1_OUTPUT" "party1" 2>/dev/null
		go run ./scripts/main.go show-keyshare "$PARTY2_OUTPUT" "party2" 2>/dev/null
	fi
	
	echo ""
	echo "Outputs saved to:"
	echo "  $PARTY1_OUTPUT"
	echo "  $PARTY2_OUTPUT"
else
	echo "✗ Keygen failed!"
	echo "Time elapsed: ${MINUTES}m ${SECONDS}s"
	echo "Party 1 exit code: $EXIT1"
	echo "Party 2 exit code: $EXIT2"
	echo "Check logs: $OUTPUT_DIR/party1.log and $OUTPUT_DIR/party2.log"
	exit 1
fi

