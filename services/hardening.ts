/**
 * Hardening flags — all ON in production by default (opt-out via HARDENING_OFF=1).
 */

export type HardeningFlags = {
  /** Idempotent cancel wrapper + structured outcomes in mpcCancel.ts */
  safeCancel: boolean;
  /** Console logs for cancel outcomes ([mpcCancel] kind -> outcome) */
  cancelTelemetry: boolean;
  /** Treat "no active nostr mpc" as success (noop) on cancel */
  nostrCancelNoopOk: boolean;
};

function envOn(name: string): boolean {
  const v =
    typeof process !== 'undefined' ? process.env?.[name] : undefined;
  return v === '1' || v === 'true';
}

function envOff(name: string): boolean {
  const v =
    typeof process !== 'undefined' ? process.env?.[name] : undefined;
  return v === '0' || v === 'false';
}

/** Opt-out: HARDENING_OFF=1 or HARDENING=0 disables all hardening. */
export function isHardeningEnabled(): boolean {
  if (envOn('HARDENING_OFF')) {
    return false;
  }
  if (envOff('HARDENING')) {
    return false;
  }
  return true;
}

export function getHardeningFlags(): HardeningFlags {
  const enabled = isHardeningEnabled();
  return {
    safeCancel: enabled && !envOff('HARDENING_SAFE_CANCEL'),
    nostrCancelNoopOk: enabled && !envOff('HARDENING_NOSTR_CANCEL_NOOP_OK'),
    cancelTelemetry: enabled && !envOff('HARDENING_CANCEL_TELEMETRY'),
  };
}
