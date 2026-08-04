/** 64-char hex attempt id (master/initiator generates per co-sign round). */
export const MPC_ATTEMPT_ID_HEX64 = /^[0-9a-f]{64}$/i;

export function isValidMpcAttemptId(value: string): boolean {
  return MPC_ATTEMPT_ID_HEX64.test(String(value ?? '').trim());
}

/** Cryptographically random 64-char hex (32 bytes / 256 bits of entropy). */
export function generateSecureHex64(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  let result = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < array.length; i++) {
    result += hex.charAt(array[i] >> 4);
    result += hex.charAt(array[i] & 0xf);
  }
  return result;
}

/** Cryptographically random attempt id for one co-sign attempt. */
export function generateMpcAttemptId(): string {
  return generateSecureHex64();
}
