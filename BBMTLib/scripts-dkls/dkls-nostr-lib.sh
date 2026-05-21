# Shared Nostr DKLS helpers (source from scripts; do not execute directly).
# Usage: source "$(dirname "$0")/dkls-nostr-lib.sh"

dkls_nostr_root() {
  if [ -z "${DKLS_NOSTR_ROOT:-}" ]; then
    DKLS_NOSTR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  echo "$DKLS_NOSTR_ROOT"
}

dkls_nostr_setup() {
  DKLS_NOSTR_ROOT="$(dkls_nostr_root)"
  cd "$DKLS_NOSTR_ROOT"

  RELAYS_DEFAULT="wss://nostr.hifish.org,wss://nostr.xxi.quest,wss://bbw-nostr.xyz"
  export RELAYS="${RELAYS:-$RELAYS_DEFAULT}"

  LIBTSS_RELEASE="${DKLS_NOSTR_ROOT}/../../libtss/target/release"
  if [ ! -f "${LIBTSS_RELEASE}/liblibtss_ffi.a" ] && [ ! -f "${LIBTSS_RELEASE}/liblibtss_ffi.dylib" ]; then
    echo "Building libtss-ffi..."
    (cd "${DKLS_NOSTR_ROOT}/../../libtss" && cargo build --release -p libtss-ffi)
  fi

  export CGO_ENABLED=1
  export CGO_LDFLAGS="-L${LIBTSS_RELEASE} -llibtss_ffi -lm -framework Security -framework CoreFoundation"
}

dkls_nostr_check_relay() {
  local relay="${RELAYS%%,*}"
  relay="${relay#ws://}"
  relay="${relay#wss://}"
  local host port
  if [[ "$relay" == *:* ]]; then
    host="${relay%%:*}"
    port="${relay##*:}"
    port="${port%%/*}"
  else
    host="$relay"
    port="7777"
  fi
  host="${host:-127.0.0.1}"
  if [ "$host" = "0.0.0.0" ]; then
    host="127.0.0.1"
  fi
  if ! (echo >/dev/tcp/"$host"/"$port") 2>/dev/null; then
    echo "Nostr relay not reachable at ${host}:${port} (RELAYS=${RELAYS})"
    echo "Start one with: BBMTLib/scripts/start-local-relay.sh"
    return 1
  fi
  return 0
}

dkls_nostr_build_scripts() {
  local bin="${DKLS_NOSTR_SCRIPTS_BIN:-/tmp/dkls-scripts}"
  if [ ! -x "$bin" ] || [ "${DKLS_NOSTR_FORCE_BUILD:-0}" = "1" ]; then
    go build -o "$bin" ./scripts-dkls/main.go
  fi
  export DKLS_NOSTR_SCRIPTS_BIN="$bin"
}

dkls_nostr_log() {
  if [ "${DKLS_NOSTR_VERBOSE:-0}" = "1" ]; then
    "$@"
  else
    "$@" >/dev/null 2>/dev/null
  fi
}

dkls_nostr_assert_matching_pubkeys() {
  local label="$1"
  shift
  local first="" pub
  for f in "$@"; do
    pub=$(jq -r '.pub_key' "$f")
    if [ -z "$pub" ] || [ "$pub" = "null" ]; then
      echo "${label}: missing pub_key in $f"
      return 1
    fi
    if [ -z "$first" ]; then
      first="$pub"
    elif [ "$pub" != "$first" ]; then
      echo "${label}: pub_key mismatch ($f)"
      return 1
    fi
    "${DKLS_NOSTR_SCRIPTS_BIN:-/tmp/dkls-scripts}" validate-ks "$f" >/dev/null
  done
  echo "${label}: pub_key ${first}"
  return 0
}

dkls_nostr_run_duo() {
  local out="${OUTPUT_DIR:-./scripts-dkls/nostr-keygen-output}"
  mkdir -p "$out"

  local bin="${DKLS_NOSTR_SCRIPTS_BIN:-/tmp/dkls-scripts}"
  read -r NSEC1 NPUB1 <<<"$("$bin" nostr-keypair | awk -F',' '{print $1" "$2}')"
  read -r NSEC2 NPUB2 <<<"$("$bin" nostr-keypair | awk -F',' '{print $1" "$2}')"

  local session_id session_key chaincode all_parties
  session_id="$("$bin" random)"
  session_key="$("$bin" random)"
  chaincode="$("$bin" random)"
  all_parties="$(printf '%s\n%s\n' "$NPUB1" "$NPUB2" | sort | paste -sd, - -)"

  run_party() {
    local nsec="$1" file="$2"
    NOSTR_NSEC="$nsec" PEERS="$all_parties" RELAYS="$RELAYS" \
      SESSION_ID="$session_id" SESSION_KEY="$session_key" CHAINCODE="$chaincode" \
      OUTPUT="$file" dkls_nostr_log "$bin" nostr-keygen
  }

  run_party "$NSEC1" "$out/nostr-party1.json" &
  local pid1=$!
  sleep 2
  run_party "$NSEC2" "$out/nostr-party2.json" &
  local pid2=$!
  wait "$pid1" "$pid2"

  dkls_nostr_assert_matching_pubkeys "duo shell e2e" \
    "$out/nostr-party1.json" "$out/nostr-party2.json"
}

dkls_nostr_run_trio() {
  local out="${OUTPUT_DIR:-./scripts-dkls/nostr-keygen-trio-output}"
  mkdir -p "$out"

  local bin="${DKLS_NOSTR_SCRIPTS_BIN:-/tmp/dkls-scripts}"
  read -r NSEC1 NPUB1 <<<"$("$bin" nostr-keypair | awk -F',' '{print $1" "$2}')"
  read -r NSEC2 NPUB2 <<<"$("$bin" nostr-keypair | awk -F',' '{print $1" "$2}')"
  read -r NSEC3 NPUB3 <<<"$("$bin" nostr-keypair | awk -F',' '{print $1" "$2}')"

  local session_id session_key chaincode all_parties
  session_id="$("$bin" random)"
  session_key="$("$bin" random)"
  chaincode="$("$bin" random)"
  all_parties="$(printf '%s\n%s\n%s\n' "$NPUB1" "$NPUB2" "$NPUB3" | sort | paste -sd, - -)"

  run_party() {
    local nsec="$1" file="$2"
    NOSTR_NSEC="$nsec" PEERS="$all_parties" RELAYS="$RELAYS" \
      SESSION_ID="$session_id" SESSION_KEY="$session_key" CHAINCODE="$chaincode" \
      OUTPUT="$file" dkls_nostr_log "$bin" nostr-keygen
  }

  run_party "$NSEC1" "$out/nostr-party1.json" &
  local pid1=$!
  sleep 2
  run_party "$NSEC2" "$out/nostr-party2.json" &
  local pid2=$!
  sleep 2
  run_party "$NSEC3" "$out/nostr-party3.json" &
  local pid3=$!
  wait "$pid1" "$pid2" "$pid3"

  dkls_nostr_assert_matching_pubkeys "trio shell e2e" \
    "$out/nostr-party1.json" "$out/nostr-party2.json" "$out/nostr-party3.json"
}
