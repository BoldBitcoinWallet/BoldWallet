#!/usr/bin/env bash
# Dual-emulator Maestro E2E: boot two AVDs, install release APK (with uninstall/retry on
# signature mismatch), run Maestro flows, and bridge the system clipboard both ways (device 1 ↔ device 2).
#
# Requirements: adb, emulator (Android SDK), maestro CLI, python3.
#
# Usage:
#   export ANDROID_HOME="$HOME/Android/Sdk"   # real SDK path — NOT /path/to/Android/sdk
#   export AVD1="Pixel_5_API_34" AVD2="Pixel_6_API_34"   # real names from: emulator -list-avds
#   ./scripts/maestro-dual-e2e.sh
#   # Or omit AVD1/AVD2 to use the first two AVDs from emulator -list-avds
#
# Or reuse already-running emulators (skip boot):
#   export SKIP_EMULATOR_BOOT=1 DEVICE1=emulator-5554 DEVICE2=emulator-5556
#   ./scripts/maestro-dual-e2e.sh
#
# If Maestro drives the wrong emulator, unset ANDROID_SERIAL in your shell — it overrides adb’s default
# device and can make --device emulator-5556 appear to “not open the app” on the second AVD.
#
# Opening the app on both emulators at once is done with **adb monkey** (parallel), not Maestro launchApp,
# so both APKs come up in the same step before any flow runs. Maestro YAML omits launchApp.
#
# Clipboard: flow 1 ends with text on device 1's OS clipboard; we sync to device 2 and write
# maestro/flows/_generated_clipboard.yaml (Maestro pasteText needs setClipboard in snippet — see
# sync_clipboard_adb.py). Flow 2 pastes, then ends with text on device 2's clipboard; we sync to
# device 1 and optionally run MAESTRO_FLOW3 to paste on device 1. Set SKIP_CLIPBOARD_ROUND2=1 to skip
# the second sync + flow 3.
#
# Boot wait and APK install run on both emulators in parallel, then adb monkey opens the app on both.
#
# **Maestro defaults to parallel** (MAESTRO_PARALLEL_FLOWS=1): after the clipboard bridge is pre-seeded,
# `maestro test` runs on device 1 and device 2 **at the same time** (two processes). YAML has no launchApp,
# so this avoids the old launchApp races. Use MAESTRO_PARALLEL_STAGGER_SEC to delay the 2nd process if
# TcpForwarder errors (try 5–15). Set MAESTRO_PARALLEL_FLOWS=0 for sequential: flow 1 on D1, sync, flow 2 on D2.
#
# Progress: every phase logs with [maestro-dual-e2e TIMESTAMP]. Boot waits print periodic polls.
# For bash line-by-line trace: MAESTRO_DUAL_TRACE=1 ./scripts/maestro-dual-e2e.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STEP=0

# Timestamped progress (helps when adb/emulator blocks for a long time).
log() {
  printf '[maestro-dual-e2e %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

step() {
  STEP=$((STEP + 1))
  log "Step ${STEP}: $*"
}

APK="${APK_PATH:-$ROOT/android/app/build/outputs/apk/release/app-release.apk}"
APP_ID="${APP_ID:-com.boldwallet}"
SYNC_CLIP="${SYNC_CLIP:-$ROOT/scripts/sync_clipboard_adb.py}"
MAESTRO_FLOW1="${MAESTRO_FLOW1:-$ROOT/maestro/flows/boldwallet_dual_device1.yaml}"
MAESTRO_FLOW2="${MAESTRO_FLOW2:-$ROOT/maestro/flows/boldwallet_dual_device2.yaml}"
MAESTRO_FLOW3="${MAESTRO_FLOW3:-$ROOT/maestro/flows/boldwallet_dual_device1_paste.yaml}"
GEN_CLIP="${GEN_CLIP:-$ROOT/maestro/flows/_generated_clipboard.yaml}"
# Maestro `setClipboard` does not update the OS clipboard that `adb cmd clipboard` reads — push the same
# E2E strings after each flow so sync_clipboard_adb.py sees them. Override with E2E_CLIPBOARD_DEVICE1/2.
E2E_CLIPBOARD_DEVICE1="${E2E_CLIPBOARD_DEVICE1:-e2e-dual-device-1-clipboard}"
E2E_CLIPBOARD_DEVICE2="${E2E_CLIPBOARD_DEVICE2:-e2e-dual-device-2-clipboard}"
# 1 = run Maestro on both devices in parallel (default). 0 = sequential flow1 → sync → flow2 (one process at a time).
MAESTRO_PARALLEL_FLOWS="${MAESTRO_PARALLEL_FLOWS:-1}"
# Delay before starting Maestro on device 2 (0 = simultaneous with device 1). Increase if TcpForwarder times out.
MAESTRO_PARALLEL_STAGGER_SEC="${MAESTRO_PARALLEL_STAGGER_SEC:-0}"

die() {
  echo "Error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

log_maestro_banner() {
  local which="$1" serial="$2" flow="$3"
  log "═══════════════════════════════════════════════════════════════════"
  log "  Maestro $which  |  adb serial: $serial"
  log "  Flow: $flow"
  log "═══════════════════════════════════════════════════════════════════"
}

assert_adb_device() {
  local serial="$1"
  local st
  st="$(adb -s "$serial" get-state 2>/dev/null || true)"
  [[ "$st" == "device" ]] || die "adb device not ready: $serial (state=${st:-missing})"
}

assert_app_installed() {
  local serial="$1"
  local out
  out="$(adb -s "$serial" shell pm path "$APP_ID" 2>/dev/null || true)"
  [[ "$out" =~ ^package: ]] || die "App $APP_ID not installed on $serial (pm path empty). Re-run install step."
}

# Maestro can follow ANDROID_SERIAL and ignore --device; adb picks the "default" device. Always clear it.
maestro_test_on_device() {
  local serial="$1" flow="$2"
  env -u ANDROID_SERIAL maestro --device "$serial" test "$flow"
}

# Equivalent to launchApp clearState — done via adb so Maestro only has to start the activity (more reliable on 2nd device).
reset_app_on_device_for_maestro() {
  local serial="$1"
  log "  → Reset app data for $APP_ID on $serial (pm clear + force-stop) before Maestro launch…"
  adb -s "$serial" shell am force-stop "$APP_ID" 2>/dev/null || true
  adb -s "$serial" shell pm clear --user 0 "$APP_ID" 2>/dev/null || adb -s "$serial" shell pm clear "$APP_ID" 2>/dev/null || true
  sleep 1
}

# Start the app without Maestro so both emulators can open it in the same wall-clock window.
launch_app_monkey() {
  local serial="$1"
  if ! adb -s "$serial" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; then
    log "  → Warning: monkey launch non-zero on $serial (continuing)"
  fi
}

# Open $APP_ID on both devices at once. Flows omit launchApp; this runs after parallel pm clear.
parallel_launch_app_on_both_devices() {
  local p1 p2 settle="${LAUNCH_SETTLE_SEC:-5}"
  log "Parallel adb monkey: $APP_ID on $DEVICE1 + $DEVICE2 (both should show the app before Maestro)"
  ( launch_app_monkey "$DEVICE1" ) & p1=$!
  ( launch_app_monkey "$DEVICE2" ) & p2=$!
  wait_two_jobs "$p1" "$p2"
  log "  → ${settle}s settle before Maestro (LAUNCH_SETTLE_SEC)"
  sleep "$settle"
}

# Mirror text onto the Android OS clipboard (Maestro setClipboard is in-memory only).
push_os_clipboard() {
  local serial="$1" text="$2"
  log "  → adb clipboard set-text on $serial (length ${#text}) for E2E bridge"
  adb -s "$serial" shell cmd clipboard set-text "$text" || die "adb clipboard set-text failed on $serial"
}

# Run two background jobs and wait; fail if either exits non-zero (safe with set -e).
wait_two_jobs() {
  local p1="$1" p2="$2" s1 s2
  set +e
  wait "$p1"
  s1=$?
  wait "$p2"
  s2=$?
  set -e
  [[ "$s1" -eq 0 && "$s2" -eq 0 ]] || die "Parallel step failed (exit codes $s1 / $s2)"
}

# Run two shell commands in parallel (each may be a function name + args via exported helpers — use subshells).
run_boot_wait_parallel() {
  local d1="$1" d2="$2"
  local p1 p2
  log "Waiting for Android boot on $d1 and $d2 in parallel..."
  wait_for_boot "$d1" & p1=$!
  wait_for_boot "$d2" & p2=$!
  wait_two_jobs "$p1" "$p2"
}

run_install_apk_parallel() {
  local d1="$1" d2="$2" apk="$3"
  local p1 p2
  log "Installing APK on $d1 and $d2 in parallel..."
  ( install_apk "$d1" "$apk" ) & p1=$!
  ( install_apk "$d2" "$apk" ) & p2=$!
  wait_two_jobs "$p1" "$p2"
}

# Pre-seed D1 OS clipboard, sync to D2, write Maestro snippet (required before parallel flow2 starts).
prepare_clipboard_bridge_for_parallel_flows() {
  push_os_clipboard "$DEVICE1" "$E2E_CLIPBOARD_DEVICE1"
  log "Command: python3 $SYNC_CLIP $DEVICE1 $DEVICE2 --write-maestro-snippet $GEN_CLIP"
  python3 "$SYNC_CLIP" "$DEVICE1" "$DEVICE2" --write-maestro-snippet "$GEN_CLIP"
}

run_maestro_flows_parallel() {
  local p1 p2 stagger="${MAESTRO_PARALLEL_STAGGER_SEC:-0}"
  log "Maestro on BOTH devices: $DEVICE1 flow1 + $DEVICE2 flow2 (apps already open; stagger=${stagger}s before 2nd start)"
  log_maestro_banner "device 1" "$DEVICE1" "$MAESTRO_FLOW1"
  log_maestro_banner "device 2" "$DEVICE2" "$MAESTRO_FLOW2"
  log "Full command 1: env -u ANDROID_SERIAL maestro --device $DEVICE1 test $MAESTRO_FLOW1"
  log "Full command 2: env -u ANDROID_SERIAL maestro --device $DEVICE2 test $MAESTRO_FLOW2"
  assert_adb_device "$DEVICE1"
  assert_adb_device "$DEVICE2"
  assert_app_installed "$DEVICE1"
  assert_app_installed "$DEVICE2"
  # Do not pm clear / monkey D2 here — both emulators were already launched together; flows start with tapOn.
  ( set -o pipefail; env -u ANDROID_SERIAL maestro --device "$DEVICE1" test "$MAESTRO_FLOW1" 2>&1 | sed -u "s/^/[$DEVICE1] /" ) & p1=$!
  if [[ -n "${stagger// }" && "${stagger}" != "0" ]]; then
    log "…stagger ${stagger}s before Maestro on $DEVICE2 (set MAESTRO_PARALLEL_STAGGER_SEC=0 for simultaneous)…"
    sleep "$stagger"
  fi
  ( set -o pipefail; env -u ANDROID_SERIAL maestro --device "$DEVICE2" test "$MAESTRO_FLOW2" 2>&1 | sed -u "s/^/[$DEVICE2] /" ) & p2=$!
  wait_two_jobs "$p1" "$p2"
}

# True if the directory looks like an Android SDK (not a doc placeholder path).
sdk_root_valid() {
  local root="$1"
  [[ -n "$root" ]] || return 1
  [[ -d "$root" ]] || return 1
  [[ -x "$root/platform-tools/adb" ]] || return 1
  [[ -x "$root/emulator/emulator" ]] || return 1
  return 0
}

find_android_sdk() {
  local c tried=""
  for c in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "${HOME}/Android/Sdk"; do
    [[ -z "$c" ]] && continue
    tried="${tried}  - ${c}"$'\n'
    if sdk_root_valid "$c"; then
      if [[ "$c" != "${ANDROID_HOME:-}" ]] && [[ -n "${ANDROID_HOME:-}" ]]; then
        log "Ignoring invalid ANDROID_HOME='${ANDROID_HOME}' (use a real SDK path, not /path/to/Android/sdk)"
      fi
      echo "$c"
      return
    fi
  done
  die "No valid Android SDK found.${tried:+ Candidates tried:$'\n'}${tried:-}Install the Android SDK (Studio → SDK path) and export ANDROID_HOME to that directory (must contain platform-tools/adb and emulator/emulator). Do not use the documentation placeholder /path/to/Android/sdk."
}

wait_for_boot() {
  local serial="$1"
  log "  → $serial: adb wait-for-device (blocks until the emulator appears; first boot can take many minutes)..."
  adb -s "$serial" wait-for-device
  log "  → $serial: device is visible to adb; waiting for sys.boot_completed=1 (polling every 2s, max ~4min)..."
  local boot="" n=0
  for _ in $(seq 1 120); do
    n=$((n + 1))
    boot="$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if (( n == 1 || n % 5 == 0 )); then
      log "  → $serial: boot poll ${n}/120, sys.boot_completed=${boot:-<empty>}"
    fi
    if [[ "$boot" == "1" ]]; then
      adb -s "$serial" shell getprop dev.bootcomplete 2>/dev/null | grep -q "1" 2>/dev/null || true
      sleep 2
      log "  → $serial: boot complete."
      return 0
    fi
    sleep 2
  done
  die "Timeout waiting for $serial to finish booting."
}

install_apk() {
  local serial="$1"
  local apk="$2"
  local ilog st
  ilog="$(mktemp)"
  log "  → adb install -r -d on $serial (APK size / transfer may take a minute)..."
  adb -s "$serial" install -r -d "$apk" 2>&1 | tee "$ilog"
  st="${PIPESTATUS[0]}"
  if [[ "$st" -eq 0 ]]; then
    log "  → $serial: install succeeded."
    rm -f "$ilog"
    return 0
  fi
  if grep -qiE 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match|signature|VERSION_DOWNGRADE' "$ilog"; then
    log "  → $serial: install failed (signature / incompatible package). Uninstalling $APP_ID and retrying..."
    adb -s "$serial" uninstall "$APP_ID" || true
    adb -s "$serial" install -r -d "$apk" || die "Install after uninstall failed on $serial"
    log "  → $serial: install succeeded after uninstall."
    rm -f "$ilog"
    return 0
  fi
  rm -f "$ilog"
  return 1
}

emulator_bin() {
  local e="$ANDROID_SDK/emulator/emulator"
  if [[ -x "$e" ]]; then
    echo "$e"
  else
    need_cmd emulator
    command -v emulator
  fi
}

resolve_avds() {
  local emu avds
  emu="$(emulator_bin)"
  mapfile -t avds < <("$emu" -list-avds 2>/dev/null | sed '/^[[:space:]]*$/d')
  ((${#avds[@]} >= 2)) || die "Need at least two AVDs. Create them in Android Studio, then check: \"$emu\" -list-avds"

  # Documentation placeholders — ignore so we auto-pick real AVDs
  if [[ "${AVD1:-}" == "Your_First_AVD" || "${AVD1:-}" == "Your_Second_AVD" ]]; then
    log "Ignoring placeholder AVD1='$AVD1' — export real names from emulator -list-avds or leave unset"
    unset AVD1
  fi
  if [[ "${AVD2:-}" == "Your_First_AVD" || "${AVD2:-}" == "Your_Second_AVD" ]]; then
    log "Ignoring placeholder AVD2='$AVD2'"
    unset AVD2
  fi

  if [[ -n "${AVD1:-}" ]] && ! printf '%s\n' "${avds[@]}" | grep -Fxq "$AVD1"; then
    die "AVD1='$AVD1' is not in emulator -list-avds. Available: ${avds[*]}"
  fi
  if [[ -n "${AVD2:-}" ]] && ! printf '%s\n' "${avds[@]}" | grep -Fxq "$AVD2"; then
    die "AVD2='$AVD2' is not in emulator -list-avds. Available: ${avds[*]}"
  fi

  if [[ -n "${AVD1:-}" && -n "${AVD2:-}" ]]; then
    log "Using AVD1=$AVD1 AVD2=$AVD2 (from environment)"
    return
  fi
  AVD1="${AVD1:-${avds[0]}}"
  AVD2="${AVD2:-${avds[1]}}"
  log "Using AVD1=$AVD1 AVD2=$AVD2 (filled from emulator -list-avds)"
}

# Wait until adb lists serial as "device", or the emulator PID exits (then show log and die).
wait_for_adb_serial() {
  local serial="$1" pid="$2" logfile="$3"
  local i
  for i in $(seq 1 90); do
    if adb devices 2>/dev/null | grep -qE "^${serial}[[:space:]]+device$"; then
      log "  → $serial registered with adb (poll ${i}/90)"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      log "Emulator PID $pid exited before $serial appeared. Log file: $logfile"
      tail -n 60 "$logfile" >&2 || true
      die "Emulator process died (bad AVD name, missing system image, or KVM). See log above."
    fi
    if (( i == 1 || i % 10 == 0 )); then
      log "  → Waiting for $serial in adb (${i}/90, emulator PID $pid running)..."
    fi
    sleep 2
  done
  log "Last 60 lines of $logfile:"
  tail -n 60 "$logfile" >&2 || true
  die "Timed out waiting for $serial in adb."
}

start_emulators() {
  local emu pid1 pid2 log1 log2
  emu="$(emulator_bin)"
  resolve_avds
  log1="/tmp/maestro-dual-emulator-5554.log"
  log2="/tmp/maestro-dual-emulator-5556.log"
  log "Starting emulators: AVD '$AVD1' → port 5554 ($log1), AVD '$AVD2' → port 5556 ($log2)"
  nohup "$emu" -avd "$AVD1" -port 5554 -no-snapshot-load >"$log1" 2>&1 &
  pid1=$!
  nohup "$emu" -avd "$AVD2" -port 5556 -no-snapshot-load >"$log2" 2>&1 &
  pid2=$!
  log "Emulator PIDs: $pid1 (5554), $pid2 (5556)"
  sleep 2
  if ! kill -0 "$pid1" 2>/dev/null; then
    tail -n 80 "$log1" >&2 || true
    die "Emulator for AVD '$AVD1' exited immediately (see log above)."
  fi
  if ! kill -0 "$pid2" 2>/dev/null; then
    tail -n 80 "$log2" >&2 || true
    die "Emulator for AVD '$AVD2' exited immediately (see log above)."
  fi
  log "--- tail $log1 ---"
  tail -n 5 "$log1" 2>/dev/null || true
  log "--- tail $log2 ---"
  tail -n 5 "$log2" 2>/dev/null || true
  wait_for_adb_serial emulator-5554 "$pid1" "$log1"
  wait_for_adb_serial emulator-5556 "$pid2" "$log2"
  log "Both emulators are visible to adb; continuing to full Android boot wait..."
}

pick_serials_from_running() {
  mapfile -t _lines < <(adb devices | awk '/emulator-/ {print $1}')
  ((${#_lines[@]} >= 2)) || die "Expected at least two emulator serials in adb devices."
  DEVICE1="${DEVICE1:-${_lines[0]}}"
  DEVICE2="${DEVICE2:-${_lines[1]}}"
  log "Resolved DEVICE1=$DEVICE1 DEVICE2=$DEVICE2 from adb devices"
}

main() {
  step "Verify prerequisites: adb, maestro, python3"
  need_cmd adb
  if ! command -v maestro >/dev/null 2>&1 && [[ -x "${HOME}/.maestro/bin/maestro" ]]; then
    export PATH="${PATH}:${HOME}/.maestro/bin"
    log "Prepended ~/.maestro/bin to PATH (maestro was not on PATH; e.g. non-login npm run)"
  fi
  need_cmd maestro
  need_cmd python3
  log "Starting adb server (prints 'daemon' messages once if adb was not running)..."
  adb start-server

  step "Verify APK and Maestro flows exist"
  [[ -f "$APK" ]] || die "APK not found: $APK (build a release APK first)."
  log "APK: $APK"
  [[ -f "$MAESTRO_FLOW1" && -f "$MAESTRO_FLOW2" ]] || die "Maestro flow files missing."
  log "Flow 1: $MAESTRO_FLOW1"
  log "Flow 2: $MAESTRO_FLOW2"
  [[ -f "$SYNC_CLIP" ]] || die "Clipboard helper missing: $SYNC_CLIP"
  chmod +x "$SYNC_CLIP" 2>/dev/null || true

  step "Resolve Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT)"
  ANDROID_SDK="$(find_android_sdk)"
  export ANDROID_SDK_ROOT="$ANDROID_SDK"
  export ANDROID_HOME="$ANDROID_SDK"
  log "ANDROID_SDK=$ANDROID_SDK"

  if [[ "${SKIP_EMULATOR_BOOT:-0}" == "1" ]]; then
    step "Skip emulator boot (SKIP_EMULATOR_BOOT=1); resolve device serials"
    [[ -n "${DEVICE1:-}" && -n "${DEVICE2:-}" ]] || pick_serials_from_running
  else
    step "Start two emulators (cold boot; next steps wait for adb + Android)"
    start_emulators
    export DEVICE1=emulator-5554
    export DEVICE2=emulator-5556
    log "Expect DEVICE1=$DEVICE1 DEVICE2=$DEVICE2"
  fi

  step "Wait for full boot on both devices (parallel)"
  run_boot_wait_parallel "$DEVICE1" "$DEVICE2"

  step "Install release APK on both devices (parallel)"
  run_install_apk_parallel "$DEVICE1" "$DEVICE2" "$APK"

  step "Clear app data on both emulators, then launch $APP_ID on BOTH in parallel (adb monkey — not Maestro)"
  ( reset_app_on_device_for_maestro "$DEVICE1" ) & _rp1=$!
  ( reset_app_on_device_for_maestro "$DEVICE2" ) & _rp2=$!
  wait_two_jobs "$_rp1" "$_rp2"
  parallel_launch_app_on_both_devices

  if [[ "${MAESTRO_PARALLEL_FLOWS:-0}" == "1" && "${SKIP_E2E_OS_CLIPBOARD_PUSH:-0}" != "1" ]]; then
    step "Prepare clipboard bridge, then run Maestro on BOTH devices in parallel (MAESTRO_PARALLEL_FLOWS=1)"
    log "If TcpForwarder errors, set MAESTRO_PARALLEL_STAGGER_SEC=8. For one Maestro at a time: MAESTRO_PARALLEL_FLOWS=0."
    prepare_clipboard_bridge_for_parallel_flows
    run_maestro_flows_parallel
    push_os_clipboard "$DEVICE1" "$E2E_CLIPBOARD_DEVICE1"
    push_os_clipboard "$DEVICE2" "$E2E_CLIPBOARD_DEVICE2"
  else
    if [[ "${MAESTRO_PARALLEL_FLOWS:-0}" == "1" && "${SKIP_E2E_OS_CLIPBOARD_PUSH:-0}" == "1" ]]; then
      log "MAESTRO_PARALLEL_FLOWS=1 with SKIP_E2E_OS_CLIPBOARD_PUSH=1 is invalid; using sequential Maestro"
    fi
    if [[ "${MAESTRO_PARALLEL_FLOWS:-0}" == "0" ]]; then
      log "Sequential Maestro: flow 1 on $DEVICE1, sync, flow 2 on $DEVICE2 — only one Maestro process runs at a time."
    fi
    step "Maestro flow 1 on $DEVICE1 (both emulators already show the app; $DEVICE2 gets flow 2 next)"
    log_maestro_banner "Maestro device 1" "$DEVICE1" "$MAESTRO_FLOW1"
    log "Command: env -u ANDROID_SERIAL maestro --device $DEVICE1 test $MAESTRO_FLOW1"
    assert_adb_device "$DEVICE1"
    maestro_test_on_device "$DEVICE1" "$MAESTRO_FLOW1"

    if [[ "${SKIP_E2E_OS_CLIPBOARD_PUSH:-0}" != "1" ]]; then
      push_os_clipboard "$DEVICE1" "$E2E_CLIPBOARD_DEVICE1"
    else
      log "Skipping OS clipboard push (SKIP_E2E_OS_CLIPBOARD_PUSH=1); using clipboard from device only"
    fi

    step "Sync clipboard from $DEVICE1 to $DEVICE2 via adb (and write Maestro snippet for pasteText)"
    log "Command: python3 $SYNC_CLIP $DEVICE1 $DEVICE2 --write-maestro-snippet $GEN_CLIP"
    python3 "$SYNC_CLIP" "$DEVICE1" "$DEVICE2" --write-maestro-snippet "$GEN_CLIP"

    step "Run Maestro flow 2 on $DEVICE2 (second emulator — watch this window)"
    log "Flow 1 finished on $DEVICE1; clipboard synced. Starting device 2 Maestro now."
    log "adb devices:"; adb devices -l | sed 's/^/[maestro-dual-e2e] /' || true
    log_maestro_banner "device 2" "$DEVICE2" "$MAESTRO_FLOW2"
    assert_adb_device "$DEVICE1"
    assert_adb_device "$DEVICE2"
    assert_app_installed "$DEVICE2"
    reset_app_on_device_for_maestro "$DEVICE2"
    log "adb monkey: foreground $APP_ID on $DEVICE2 before Maestro flow 2"
    launch_app_monkey "$DEVICE2"
    sleep 2
    log "Command: env -u ANDROID_SERIAL maestro --device $DEVICE2 test $MAESTRO_FLOW2"
    maestro_test_on_device "$DEVICE2" "$MAESTRO_FLOW2"

    if [[ "${SKIP_E2E_OS_CLIPBOARD_PUSH:-0}" != "1" ]]; then
      push_os_clipboard "$DEVICE2" "$E2E_CLIPBOARD_DEVICE2"
    else
      log "Skipping OS clipboard push (SKIP_E2E_OS_CLIPBOARD_PUSH=1); using clipboard from device only"
    fi
  fi

  if [[ "${SKIP_CLIPBOARD_ROUND2:-0}" != "1" ]]; then
    step "Sync clipboard from $DEVICE2 to $DEVICE1 via adb (snippet for paste on device 1)"
    log "Command: python3 $SYNC_CLIP $DEVICE2 $DEVICE1 --write-maestro-snippet $GEN_CLIP"
    python3 "$SYNC_CLIP" "$DEVICE2" "$DEVICE1" --write-maestro-snippet "$GEN_CLIP"

    step "Run Maestro flow 3 on $DEVICE1 (paste device 2's payload)"
    [[ -f "$MAESTRO_FLOW3" ]] || die "Maestro flow 3 missing: $MAESTRO_FLOW3"
    log_maestro_banner "device 1 (flow 3)" "$DEVICE1" "$MAESTRO_FLOW3"
    log "adb monkey: foreground $APP_ID on $DEVICE1 before Maestro flow 3"
    launch_app_monkey "$DEVICE1"
    sleep 2
    log "Command: env -u ANDROID_SERIAL maestro --device $DEVICE1 test $MAESTRO_FLOW3"
    assert_adb_device "$DEVICE1"
    maestro_test_on_device "$DEVICE1" "$MAESTRO_FLOW3"
  else
    log "Skipping D2→D1 sync and flow 3 (SKIP_CLIPBOARD_ROUND2=1)"
  fi

  step "All steps finished successfully."
}

# Optional: export MAESTRO_DUAL_TRACE=1 for bash xtrace on stderr
if [[ "${MAESTRO_DUAL_TRACE:-0}" == "1" ]]; then
  set -x
fi

main "$@"
