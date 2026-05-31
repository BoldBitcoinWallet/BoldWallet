# Shared Nostr DKLS helpers (source from scripts; do not execute directly).
# Usage: source "$(dirname "$0")/dkls-nostr-lib.sh"

dkls_nostr_root() {
  if [ -z "${DKLS_NOSTR_ROOT:-}" ]; then
    DKLS_NOSTR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  echo "$DKLS_NOSTR_ROOT"
}

# Client URL for the local nostr-rs-relay (Docker -p 7777:8080 listens on 0.0.0.0:7777).
dkls_nostr_local_relay_url() {
  echo "ws://127.0.0.1:${DKLS_NOSTR_RELAY_PORT:-7777}"
}

# Map bind addresses to a URL Nostr clients can dial (same as Go requireNostrRelay).
dkls_nostr_normalize_relay_host() {
  local host="$1"
  case "$host" in
    0.0.0.0|"") echo "127.0.0.1" ;;
    *) echo "$host" ;;
  esac
}

dkls_nostr_relay_tcp_reachable() {
  local relay_url="$1"
  local relay="${relay_url%%,*}"
  relay="${relay#ws://}"
  relay="${relay#wss://}"
  local host port
  if [[ "$relay" == *:* ]]; then
    host="${relay%%:*}"
    port="${relay##*:}"
    port="${port%%/*}"
  else
    host="$relay"
    port="${DKLS_NOSTR_RELAY_PORT:-7777}"
  fi
  host="$(dkls_nostr_normalize_relay_host "$host")"
  (echo >/dev/tcp/"$host"/"$port") 2>/dev/null
}

# Normalize RELAYS for Nostr WebSocket clients (never ws://0.0.0.0 — that is a bind addr only).
dkls_nostr_normalize_relays_csv() {
  local csv="$1"
  local out="" part scheme rest host port norm
  IFS=',' read -ra parts <<<"$csv"
  for part in "${parts[@]}"; do
    part="$(echo "$part" | xargs)"
    [ -z "$part" ] && continue
    if [[ "$part" == ws://* ]]; then
      scheme="ws://"
      rest="${part#ws://}"
    elif [[ "$part" == wss://* ]]; then
      scheme="wss://"
      rest="${part#wss://}"
    else
      scheme="ws://"
      rest="$part"
    fi
    if [[ "$rest" == *:* ]]; then
      host="${rest%%:*}"
      port="${rest##*:}"
      port="${port%%/*}"
    else
      host="$rest"
      port="${DKLS_NOSTR_RELAY_PORT:-7777}"
    fi
    norm="${scheme}$(dkls_nostr_normalize_relay_host "$host"):${port}"
    if [ -z "$out" ]; then
      out="$norm"
    else
      out="${out},${norm}"
    fi
  done
  echo "$out"
}

# Prefer local relay when reachable (matches Go defaultNostrTestRelay + mobile path).
# Set RELAYS explicitly to override. Production relays only when DKLS_NOSTR_ALLOW_PUBLIC=1
# and local relay is down.
dkls_nostr_resolve_relays() {
  if [ -n "${RELAYS:-}" ]; then
    export RELAYS="$(dkls_nostr_normalize_relays_csv "$RELAYS")"
    return 0
  fi
  local local_url
  local_url="$(dkls_nostr_local_relay_url)"
  if dkls_nostr_relay_tcp_reachable "$local_url"; then
    export RELAYS="$local_url"
    return 0
  fi
  if [ "${DKLS_NOSTR_ALLOW_PUBLIC:-0}" = "1" ]; then
    export RELAYS="wss://nostr.hifish.org,wss://nostr.xxi.quest,wss://bbw-nostr.xyz"
    return 0
  fi
  echo "No local Nostr relay at ${local_url} (bind is often 0.0.0.0:7777; clients use ws://127.0.0.1:7777)."
  echo "Start: BBMTLib/scripts/start-local-relay.sh"
  echo "Or: RELAYS=ws://127.0.0.1:7777 DKLS_NOSTR_ALLOW_PUBLIC=1 (public relays — not the mobile preflight gate)"
  return 1
}

dkls_nostr_setup() {
  DKLS_NOSTR_ROOT="$(dkls_nostr_root)"
  cd "$DKLS_NOSTR_ROOT"

  dkls_nostr_resolve_relays || return 1

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
  if ! dkls_nostr_relay_tcp_reachable "$relay"; then
    echo "Nostr relay not reachable (${RELAYS})"
    echo "Start: BBMTLib/scripts/start-local-relay.sh  (Docker maps 0.0.0.0:${DKLS_NOSTR_RELAY_PORT:-7777})"
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
