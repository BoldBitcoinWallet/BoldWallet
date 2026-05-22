import {Buffer} from 'buffer';

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
 * Identity hash for LAN/Nostr pairing: same unsigned PSBT must match even when
 * file vs QR encodings differ (padding, proprietary fields, partial sigs).
 */
export async function psbtIdentityHash(
  psbtBase64: string,
  sha256: (message: string) => Promise<string>,
  parsePSBTDetails?: (psbtBase64: string) => Promise<string>,
): Promise<string> {
  const canonical = canonicalPsbtBase64(psbtBase64);
  if (parsePSBTDetails) {
    try {
      const detailsJson = await parsePSBTDetails(canonical);
      if (
        detailsJson &&
        !detailsJson.startsWith('error') &&
        !detailsJson.includes('failed')
      ) {
        return sha256(detailsJson);
      }
    } catch {
      // Fall back to canonical raw bytes hash.
    }
  }
  return sha256(canonical);
}

/** Parse master session payload: `{seed64}:{psbtHash}:{partyKey}`. */
export function parsePsbtSessionPayload(data: string): {
  psbtHash: string;
  peerShare: string;
} {
  const parts = data.split(':');
  if (parts.length < 3) {
    throw new Error('Invalid PSBT session payload');
  }
  return {
    psbtHash: parts[1],
    peerShare: parts.slice(2).join(':'),
  };
}

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
