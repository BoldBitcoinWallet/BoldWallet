/** 64-char hex attempt id (master/initiator generates per co-sign round). */
export const MPC_ATTEMPT_ID_HEX64 = /^[0-9a-f]{64}$/i;

export function isValidMpcAttemptId(value: string): boolean {
  return MPC_ATTEMPT_ID_HEX64.test(String(value ?? '').trim());
}

/** Cryptographically random attempt id for one co-sign attempt. */
export function generateMpcAttemptId(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  let result = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < array.length; i++) {
    result += hex.charAt(array[i] % 16);
  }
  return result + result; // 64 hex chars
}
