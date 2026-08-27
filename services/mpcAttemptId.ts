import {secureRandomHex} from './secureRandom';

/** 64-char hex attempt id (master/initiator generates per co-sign round). */
export const MPC_ATTEMPT_ID_HEX64 = /^[0-9a-f]{64}$/i;

export function isValidMpcAttemptId(value: string): boolean {
  return MPC_ATTEMPT_ID_HEX64.test(String(value ?? '').trim());
}

/** Cryptographically random 64-char hex (32 bytes / 256 bits of entropy). */
export async function generateSecureHex64(): Promise<string> {
  return secureRandomHex(64);
}

/** Cryptographically random attempt id for one co-sign attempt. */
export async function generateMpcAttemptId(): Promise<string> {
  return generateSecureHex64();
}
