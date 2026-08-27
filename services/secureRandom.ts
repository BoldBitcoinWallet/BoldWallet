import {BBMTLibNativeModule} from '../native_modules';

const HEX_RE = /^[0-9a-f]+$/i;

function fallbackSecureRandomHex(length: number): string {
  const byteLen = Math.ceil(length / 2);
  const array = new Uint8Array(byteLen);
  crypto.getRandomValues(array);
  let hex = '';
  const alphabet = '0123456789abcdef';
  for (let i = 0; i < array.length; i++) {
    hex += alphabet.charAt(array[i] >> 4);
    hex += alphabet.charAt(array[i] & 0xf);
  }
  return hex.slice(0, length);
}

/** Hex string of `length` chars from native `tss.SecureRandom`, with JS CSPRNG fallback. */
export async function secureRandomHex(length: number): Promise<string> {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('secureRandom: length must be a positive integer');
  }
  const nativeFn = BBMTLibNativeModule?.secureRandom as
    | ((n: number) => Promise<string>)
    | undefined;
  if (typeof nativeFn === 'function') {
    try {
      const out = await nativeFn(length);
      if (typeof out === 'string' && out.length === length && HEX_RE.test(out)) {
        return out.toLowerCase();
      }
    } catch {
      // Native missing or failed — use WebCrypto / JS CSPRNG.
    }
  }
  return fallbackSecureRandomHex(length);
}
