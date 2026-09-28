/**
 * Unified Bold extension binding logic (swimlanes.io spec).
 * Used by: Devices tab (KeyshareInfoContent "Bind Extension") and WalletHome (scan auto-detect).
 *
 * Spec v2 leak hardening: master chaincode MUST NOT leave the device via the
 * extension-bind QR. This module no longer accepts or transmits chain_code.
 * Binding proves possession of the account pubkey only.
 */
import {BBMTLibNativeModule} from '../native_modules';

const Buffer = (global as any).Buffer;

/** Parse pairing_code from extension QR data (e.g. "data: pairing_code=abc" or "pairing_code=abc") */
export function parsePairingCodeFromScannedData(raw: string): string | null {
  const s = raw.trim();
  const prefix = 'pairing_code=';
  const i = s.indexOf(prefix);
  if (i === -1) return null;
  const after = s.slice(i + prefix.length);
  const end = after.indexOf('&');
  const code = end === -1 ? after.trim() : after.slice(0, end).trim();
  return code || null;
}

/** XOR two buffers (key repeated if shorter). */
function xorBytes(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    // eslint-disable-next-line no-bitwise -- required for cipher (payload XOR pairing_key)
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

/**
 * Compute the response QR payload (base64) for Bold extension binding.
 * Pairing code is not shared back; payload is XOR'd with sha256(pairing_code).
 * Extension validates integrity with checksum = sha256(pub_key+pairing_code)[0:4].
 *
 * Spec v2: payload = pub_key ONLY (66 hex = 33 bytes). Master chaincode is
 * never exported here. Legacy 65-byte payloads are rejected on parse.
 */
export async function computeExtensionBindResponseQr(
  pairingCode: string,
  pubKey: string,
  _chainCode?: string,
): Promise<string> {
  if (_chainCode !== undefined) {
    throw new Error(
      'computeExtensionBindResponseQr: chaincode export removed (Spec v2 leak hardening)',
    );
  }
  const payloadHex = `${pubKey}`;
  if (payloadHex.length !== 66) {
    throw new Error('pub_key (66 hex) must be 66 chars');
  }

  // Integrity checksum (extension validates: sha256(pub_key+pairing_code), sig = hash[0:4])
  const integrityHash = await BBMTLibNativeModule.sha256(
    `${pubKey}${pairingCode}`,
  );
  const checksumHex = integrityHash.substring(0, 4);
  const checksumBytes = Buffer.from(checksumHex, 'hex');

  // pairing_key = sha256(pairing_code), cipher = payload XOR pairing_key
  const pairingKeyHex = await BBMTLibNativeModule.sha256(pairingCode);
  const pairingKeyBytes = Buffer.from(pairingKeyHex, 'hex');
  const payloadBytes = Buffer.from(payloadHex, 'hex');
  const cipherBytes = xorBytes(payloadBytes, pairingKeyBytes);

  const response = Buffer.concat([cipherBytes, checksumBytes]);
  return response.toString('base64');
}

export type ParseExtensionResponseResult = {
  pubKey: string;
  chainCode: string;
  valid: boolean;
};

/**
 * Extension-side: decipher response QR, extract pub_key, validate checksum.
 * Spec v2: payload = pub_key only (33 bytes). chainCode is always '' —
 * master chaincode never crosses the extension bind. Legacy 67-byte
 * (pub+chain) responses are rejected.
 *
 * Steps:
 * - cipher = response[0:33], checksum = response[33:35]
 * - pairing_key = sha256(pairing_code)
 * - payload = cipher XOR pairing_key
 * - pub_key = payload_hex[0:66]
 * - valid = (sha256(pub_key+pairing_code)[0:4] === checksum)
 */
export async function parseExtensionResponse(
  responseBase64: string,
  pairingCode: string,
  sha256Fn?: (data: string) => Promise<string>,
): Promise<ParseExtensionResponseResult> {
  const sha256Async =
    sha256Fn ?? ((data: string) => BBMTLibNativeModule.sha256(data) as Promise<string>);

  const responseBytes = Buffer.from(responseBase64, 'base64');
  if (responseBytes.length === 67) {
    throw new Error(
      'Legacy extension response (pub+chaincode) rejected: chaincode export removed (Spec v2)',
    );
  }
  if (responseBytes.length !== 35) {
    throw new Error(`Invalid response length: expected 35 bytes, got ${responseBytes.length}`);
  }
  const cipherBytes = responseBytes.subarray(0, 33);
  const checksumBytes = responseBytes.subarray(33, 35);

  const pairingKeyHex = await sha256Async(pairingCode);
  const pairingKeyBytes = Buffer.from(pairingKeyHex, 'hex');
  const payloadBytes = xorBytes(cipherBytes, pairingKeyBytes);
  const payloadHex = payloadBytes.toString('hex');
  if (payloadHex.length !== 66) {
    throw new Error(`Invalid payload hex length: expected 66, got ${payloadHex.length}`);
  }
  const pubKey = payloadHex.slice(0, 66);
  const chainCode = '';

  const integrityHash = await sha256Async(`${pubKey}${pairingCode}`);
  const expectedChecksumHex = integrityHash.slice(0, 4);
  const expectedChecksumBytes = Buffer.from(expectedChecksumHex, 'hex');
  const valid =
    expectedChecksumBytes.length === checksumBytes.length &&
    expectedChecksumBytes.equals(checksumBytes);

  return { pubKey, chainCode, valid };
}
