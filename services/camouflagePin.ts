/**
 * 4-digit camouflage PIN — stored as salt+SHA-256 in SQLite `app_config`.
 * Default off on the Bold icon. Forced on while a camouflage launcher icon is active.
 * Fail count + lockout-until also live in `app_config` (3 failures → 30s retry).
 */
import {sha256} from '@noble/hashes/sha2';
import {bytesToHex, hexToBytes, randomBytes} from '@noble/hashes/utils';
import appConfigRepository, {
  CONFIG_KEYS,
} from './repositories/AppConfigRepository';

export const CAMOUFLAGE_PIN_LENGTH = 4;
export const CAMOUFLAGE_PIN_HASH_KEY = CONFIG_KEYS.CAMOUFLAGE_PIN_HASH;
export const CAMOUFLAGE_PIN_ENABLED_KEY = CONFIG_KEYS.CAMOUFLAGE_PIN_ENABLED;
export const CAMOUFLAGE_PIN_MAX_FAILURES = 3;
export const CAMOUFLAGE_PIN_LOCKOUT_MS = 30_000;

export type CamouflagePinLockSnapshot = {
  failures: number;
  lockedUntil: number;
};

export type CamouflagePinLockState = CamouflagePinLockSnapshot & {
  remainingMs: number;
  locked: boolean;
};

export function isValidCamouflagePin(pin: string): boolean {
  return new RegExp(`^\\d{${CAMOUFLAGE_PIN_LENGTH}}$`).test(pin);
}

function pinToBytes(pin: string): Uint8Array {
  const out = new Uint8Array(pin.length);
  for (let i = 0; i < pin.length; i++) {
    out[i] = pin.charCodeAt(i);
  }
  return out;
}

function digestPin(pin: string, salt: Uint8Array): string {
  const pinBytes = pinToBytes(pin);
  const msg = new Uint8Array(salt.length + pinBytes.length);
  msg.set(salt, 0);
  msg.set(pinBytes, salt.length);
  return bytesToHex(sha256(msg));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function isCamouflagePinEnabled(): Promise<boolean> {
  return appConfigRepository.getBool(CONFIG_KEYS.CAMOUFLAGE_PIN_ENABLED, false);
}

export async function setCamouflagePinEnabled(enabled: boolean): Promise<void> {
  appConfigRepository.setBool(CONFIG_KEYS.CAMOUFLAGE_PIN_ENABLED, enabled);
}

export async function hasCamouflagePin(): Promise<boolean> {
  const stored = appConfigRepository.get(CONFIG_KEYS.CAMOUFLAGE_PIN_HASH);
  return !!stored && stored.includes(':');
}

export async function setCamouflagePin(pin: string): Promise<void> {
  if (!isValidCamouflagePin(pin)) {
    throw new Error('PIN must be 4 digits');
  }
  const salt = randomBytes(16);
  const hash = digestPin(pin, salt);
  appConfigRepository.set(
    CONFIG_KEYS.CAMOUFLAGE_PIN_HASH,
    `${bytesToHex(salt)}:${hash}`,
  );
  await setCamouflagePinEnabled(true);
}

export async function verifyCamouflagePin(pin: string): Promise<boolean> {
  if (!isValidCamouflagePin(pin)) {
    return false;
  }
  const stored = appConfigRepository.get(CONFIG_KEYS.CAMOUFLAGE_PIN_HASH);
  if (!stored) {
    return false;
  }
  const sep = stored.indexOf(':');
  if (sep <= 0) {
    return false;
  }
  const salt = hexToBytes(stored.slice(0, sep));
  const expected = stored.slice(sep + 1);
  return timingSafeEqual(digestPin(pin, salt), expected);
}

export async function clearCamouflagePin(): Promise<void> {
  appConfigRepository.remove(CONFIG_KEYS.CAMOUFLAGE_PIN_HASH);
  appConfigRepository.remove(CONFIG_KEYS.CAMOUFLAGE_PIN_ENABLED);
  clearCamouflagePinLockout();
}

function parseConfigInt(raw: string | null): number {
  if (raw == null || raw === '') {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readLockSnapshot(): CamouflagePinLockSnapshot {
  return {
    failures: parseConfigInt(
      appConfigRepository.get(CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT),
    ),
    lockedUntil: parseConfigInt(
      appConfigRepository.get(CONFIG_KEYS.CAMOUFLAGE_PIN_LOCKED_UNTIL),
    ),
  };
}

function writeLockSnapshot(snapshot: CamouflagePinLockSnapshot): void {
  if (snapshot.failures <= 0 && snapshot.lockedUntil <= 0) {
    appConfigRepository.remove(CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT);
    appConfigRepository.remove(CONFIG_KEYS.CAMOUFLAGE_PIN_LOCKED_UNTIL);
    return;
  }
  appConfigRepository.setMany({
    [CONFIG_KEYS.CAMOUFLAGE_PIN_FAIL_COUNT]: String(snapshot.failures),
    [CONFIG_KEYS.CAMOUFLAGE_PIN_LOCKED_UNTIL]: String(snapshot.lockedUntil),
  });
}

export function resolveCamouflagePinLock(
  snapshot: CamouflagePinLockSnapshot,
  now: number,
): CamouflagePinLockState {
  const remainingMs = Math.max(0, snapshot.lockedUntil - now);
  if (remainingMs > 0) {
    return {
      failures: snapshot.failures,
      lockedUntil: snapshot.lockedUntil,
      remainingMs,
      locked: true,
    };
  }
  return {
    failures: snapshot.lockedUntil > 0 ? 0 : snapshot.failures,
    lockedUntil: 0,
    remainingMs: 0,
    locked: false,
  };
}

export function applyCamouflagePinFailure(
  snapshot: CamouflagePinLockSnapshot,
  now: number,
): CamouflagePinLockState {
  const current = resolveCamouflagePinLock(snapshot, now);
  if (current.locked) {
    return current;
  }
  const failures = current.failures + 1;
  if (failures >= CAMOUFLAGE_PIN_MAX_FAILURES) {
    return {
      failures: 0,
      lockedUntil: now + CAMOUFLAGE_PIN_LOCKOUT_MS,
      remainingMs: CAMOUFLAGE_PIN_LOCKOUT_MS,
      locked: true,
    };
  }
  return {
    failures,
    lockedUntil: 0,
    remainingMs: 0,
    locked: false,
  };
}

export function camouflagePinRetryHint(remainingMs: number): string {
  const sec = Math.max(1, Math.ceil(remainingMs / 1000));
  return `Retry in ${sec}s`;
}

export function getCamouflagePinLockState(
  now = Date.now(),
): CamouflagePinLockState {
  const raw = readLockSnapshot();
  const resolved = resolveCamouflagePinLock(raw, now);
  if (raw.lockedUntil > 0 && resolved.lockedUntil === 0) {
    writeLockSnapshot({failures: resolved.failures, lockedUntil: 0});
  }
  return resolved;
}

export function recordCamouflagePinFailure(
  now = Date.now(),
): CamouflagePinLockState {
  const next = applyCamouflagePinFailure(readLockSnapshot(), now);
  writeLockSnapshot(next);
  return next;
}

export function clearCamouflagePinLockout(): void {
  writeLockSnapshot({failures: 0, lockedUntil: 0});
}

/** PIN pad before biometrics: always for camouflage if a PIN exists; also when the toggle is on. */
export async function shouldPromptCamouflagePin(
  camouflageOn: boolean,
): Promise<boolean> {
  if (!(await hasCamouflagePin())) {
    return false;
  }
  if (camouflageOn) {
    return true;
  }
  return isCamouflagePinEnabled();
}
