import {Buffer} from 'buffer';
import {NativeModules} from 'react-native';

const {BBMTLibNativeModule} = NativeModules;

export function isPsbtBytes(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x70 &&
    bytes[1] === 0x73 &&
    bytes[2] === 0x62 &&
    bytes[3] === 0x74
  );
}

/** Decode base64 (ignoring whitespace) and re-encode so the same PSBT bytes always match. */
export function canonicalPsbtBase64(input: string): string {
  const trimmed = input.trim().replace(/\s/g, '');
  if (!trimmed) {
    throw new Error('Empty PSBT');
  }
  const bytes = Buffer.from(trimmed, 'base64');
  if (!bytes.length) {
    throw new Error('Invalid PSBT base64');
  }
  if (!isPsbtBytes(bytes)) {
    throw new Error('Invalid PSBT (missing psbt magic bytes)');
  }
  return bytes.toString('base64');
}

/**
 * Identity hash for LAN/Nostr pairing (Go PsbtIdentityHash): SHA-256 of serialized
 * unsigned transaction bytes. Same tx must match across file vs QR and partial sigs.
 */
export async function psbtIdentityHash(psbtBase64: string): Promise<string> {
  const canonical = canonicalPsbtBase64(psbtBase64);
  if (!BBMTLibNativeModule?.psbtIdentityHash) {
    throw new Error('Native psbtIdentityHash is unavailable');
  }
  const hash = await BBMTLibNativeModule.psbtIdentityHash(canonical);
  if (!hash || typeof hash !== 'string') {
    throw new Error('psbtIdentityHash returned empty result');
  }
  if (hash.startsWith('error:') || hash.startsWith('error')) {
    throw new Error(hash);
  }
  return hash;
}

export {
  isValidLanPsbtSessionPayload,
  lanPsbtSessionPayloadMatchesHash,
  parseLanPsbtSessionPayload as parsePsbtSessionPayload,
} from './lanSession';

/** Read a .psbt file whether it is raw binary or ASCII base64 text. */
export async function readPsbtBase64FromFile(
  readFile: (path: string, encoding: 'base64' | 'utf8') => Promise<string>,
  filePath: string,
): Promise<string> {
  const asBase64 = await readFile(filePath, 'base64');
  const fromBinary = Buffer.from(asBase64, 'base64');
  if (isPsbtBytes(fromBinary)) {
    return fromBinary.toString('base64');
  }

  const text = (await readFile(filePath, 'utf8')).trim().replace(/\s/g, '');
  if (text.length > 0) {
    const fromText = Buffer.from(text, 'base64');
    if (isPsbtBytes(fromText)) {
      return fromText.toString('base64');
    }
  }

  return canonicalPsbtBase64(asBase64);
}
