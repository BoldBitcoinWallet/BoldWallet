import {secureRandomHex} from './secureRandom';

/** 6-digit airgap QR PIN (000000–999999), generated with CSPRNG. */
export const AIRGAP_PIN_DIGITS = 6;
const PIN_MODULUS = 1_000_000;
/** Largest multiple of 1e6 that fits in uint32 — rejection sampling avoids modulo bias. */
const MAX_ACCEPTABLE = Math.floor(0x100000000 / PIN_MODULUS) * PIN_MODULUS;

export async function generateAirgapPin(): Promise<string> {
  let value = 0;
  do {
    const hex = await secureRandomHex(8);
    value = parseInt(hex, 16);
  } while (!Number.isFinite(value) || value >= MAX_ACCEPTABLE);
  return String(value % PIN_MODULUS).padStart(AIRGAP_PIN_DIGITS, '0');
}

export function isAirgapPin(value: string): boolean {
  return new RegExp(`^\\d{${AIRGAP_PIN_DIGITS}}$`).test(String(value ?? '').trim());
}

export function formatAirgapPinDisplay(pin: string): string {
  const digits = String(pin ?? '').replace(/\D/g, '').slice(0, AIRGAP_PIN_DIGITS);
  if (digits.length <= 3) {
    return digits;
  }
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
