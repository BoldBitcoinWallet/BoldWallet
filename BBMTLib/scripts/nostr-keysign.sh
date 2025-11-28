#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RELAYS_DEFAULT="ws://localhost:7777"
RELAYS="${RELAYS:-$RELAYS_DEFAULT}"
TIMEOUT="${TIMEOUT:-90}"
OUTPUT_DIR="${OUTPUT_DIR:-./nostr-keygen-output}"
KEYSIGN_OUTPUT_DIR="${KEYSIGN_OUTPUT_DIR:-./nostr-keysign-output}"
mkdir -p "$KEYSIGN_OUTPUT_DIR"

# Check if keyshare files exist
PARTY1_KEYSHARE="$OUTPUT_DIR/party1-keyshare.json"
PARTY2_KEYSHARE="$OUTPUT_DIR/party2-keyshare.json"

if [ ! -f "$PARTY1_KEYSHARE" ] || [ ! -f "$PARTY2_KEYSHARE" ]; then
	echo "Error: Keyshare files not found!"
	echo "Expected:"
	echo "  $PARTY1_KEYSHARE"
	echo "  $PARTY2_KEYSHARE"
	echo ""
	echo "Please run nostr-keygen.sh first to generate keyshares."
	exit 1
fi

# Extract npub, nsec, and committee keys from keyshare files
NPUB1=$(go run ./scripts/main.go extract-npub "$PARTY1_KEYSHARE")
NPUB2=$(go run ./scripts/main.go extract-npub "$PARTY2_KEYSHARE")
NSEC1=$(go run ./scripts/main.go extract-nsec "$PARTY1_KEYSHARE")
NSEC2=$(go run ./scripts/main.go extract-nsec "$PARTY2_KEYSHARE")

# Extract all party npubs from keyshare (keygen_committee_keys)
# Parties to participate in keysign (default: only party1 + party2).
# Allows overriding via KEYSIGN_PARTIES env var if a different subset is desired.
DEFAULT_KEYSIGN_PARTIES="$NPUB1,$NPUB2"
KEYSIGN_PARTIES="${KEYSIGN_PARTIES:-$DEFAULT_KEYSIGN_PARTIES}"

# All parties as defined in keyshare (informational only)
ALL_PARTIES=$(go run ./scripts/main.go extract-committee "$PARTY1_KEYSHARE")

# Generate session ID and key for keysign
random_hex() {
	go run ./scripts/main.go random
}

SESSION_ID="$(random_hex)"
SESSION_KEY="$(random_hex)"

# Generate message to sign (or use provided)
MESSAGE="${MESSAGE:-$(random_hex)}"
if [ -z "${DERIVATION_PATH:-}" ]; then
	DERIVATION_PATH="m/44'/0'/0'/0/0"
fi

echo "=== Keysign Parameters ==="
echo "Relays         : $RELAYS"
echo "Session ID     : $SESSION_ID"
echo "Session Key    : $SESSION_KEY"
echo "Message        : $MESSAGE"
echo "Derivation Path: $DERIVATION_PATH"
echo ""
echo "Party 1 npub: $NPUB1"
echo "Party 2 npub: $NPUB2"
echo "All Parties  : $ALL_PARTIES"
echo "Keysign With : $KEYSIGN_PARTIES"
echo "============================"

run_party() {
	local nsec="$1"
	local npub="$2"
	local keyshare="$3"
	local output="$4"
	local log="$5"

	# Redirect stderr to log file, filter stdout to extract only JSON (remove dots)
	go run ./tss/cmd/nostr-keysign \
		-relays "$RELAYS" \
		-nsec "$nsec" \
		-peers "$KEYSIGN_PARTIES" \
		-session "$SESSION_ID" \
		-session-key "$SESSION_KEY" \
		-keyshare "$keyshare" \
		-path "$DERIVATION_PATH" \
		-message "$MESSAGE" \
		-timeout "$TIMEOUT" 2> "$log" | awk '/^\{/,/^\}/' > "$output" || true
}

PARTY1_OUTPUT="$KEYSIGN_OUTPUT_DIR/party1-signature.json"
PARTY2_OUTPUT="$KEYSIGN_OUTPUT_DIR/party2-signature.json"
PARTY1_LOG="$KEYSIGN_OUTPUT_DIR/party1.log"
PARTY2_LOG="$KEYSIGN_OUTPUT_DIR/party2.log"

echo ""
echo "Starting Nostr keysign for both parties in parallel..."

# Record start time
START_TIME=$(date +%s)
echo "$(pwd)/nostr-keysign-output/party1.log"

# Run both parties in background
rm "$(pwd)/nostr-keysign-output/party1.log"
	run_party "$NSEC1" "$NPUB1" "$PARTY1_KEYSHARE" "$PARTY1_OUTPUT" "$PARTY1_LOG" &
PID1=$!

rm "$(pwd)/nostr-keysign-output/party2.log"
	run_party "$NSEC2" "$NPUB2" "$PARTY2_KEYSHARE" "$PARTY2_OUTPUT" "$PARTY2_LOG" &
PID2=$!

# Handle cleanup on exit
trap "echo 'Stopping processes...'; kill \$PID1 \$PID2 2>/dev/null; exit" SIGINT SIGTERM

echo "Party 1 PID: $PID1"
echo "Party 2 PID: $PID2"
echo "Signatures: $PARTY1_OUTPUT and $PARTY2_OUTPUT"
echo "Logs: $PARTY1_LOG and $PARTY2_LOG"
echo ""
echo "Waiting for keysign to complete..."

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
	echo "✓ Keysign completed successfully!"
	echo "Time elapsed: ${MINUTES}m ${SECONDS}s"
	echo ""
	
	# Display signatures
	if [ -f "$PARTY1_OUTPUT" ] && [ -f "$PARTY2_OUTPUT" ]; then
		echo "=== Party 1 Signature ==="
		if command -v jq >/dev/null 2>&1; then
			jq . "$PARTY1_OUTPUT" 2>/dev/null || cat "$PARTY1_OUTPUT"
		else
			cat "$PARTY1_OUTPUT"
		fi
		echo ""
		echo "=== Party 2 Signature ==="
		if command -v jq >/dev/null 2>&1; then
			jq . "$PARTY2_OUTPUT" 2>/dev/null || cat "$PARTY2_OUTPUT"
		else
			cat "$PARTY2_OUTPUT"
		fi
		echo ""
		
		# Verify signatures match (compare JSON files)
		if command -v jq >/dev/null 2>&1; then
			# Normalize and compare JSON
			PARTY1_NORM=$(jq -c . "$PARTY1_OUTPUT" 2>/dev/null)
			PARTY2_NORM=$(jq -c . "$PARTY2_OUTPUT" 2>/dev/null)
			if [ "$PARTY1_NORM" = "$PARTY2_NORM" ] && [ -n "$PARTY1_NORM" ]; then
				echo "✓ Signatures match!"
			else
				echo "⚠ Warning: Signatures differ (this should not happen)"
			fi
		else
			# Fallback: simple file comparison
			if cmp -s "$PARTY1_OUTPUT" "$PARTY2_OUTPUT"; then
				echo "✓ Signatures match!"
			else
				echo "⚠ Warning: Signatures differ (this should not happen)"
			fi
		fi
	fi
	
	echo ""
	echo "Signatures saved to:"
	echo "  $PARTY1_OUTPUT"
	echo "  $PARTY2_OUTPUT"
else
	echo "✗ Keysign failed!"
	echo "Time elapsed: ${MINUTES}m ${SECONDS}s"
	echo "Party 1 exit code: $EXIT1"
	echo "Party 2 exit code: $EXIT2"
	echo "Check logs: $PARTY1_LOG and $PARTY2_LOG"
	exit 1
fi

