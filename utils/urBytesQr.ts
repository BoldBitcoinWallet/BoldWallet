/**
 * BC-UR fountain helpers.
 *
 * Frame helpers (`urPartAt`, `urFragmentCount`) work for any UR type
 * (`bytes`, `crypto-psbt`, …). Send-bitcoin uses `utf8ToUr` → `ur:bytes`.
 * Signed PSBT keeps `CryptoPSBT.toUR()` → `ur:crypto-psbt`.
 * Airgap keyshare uses larger fragments + faster cadence (see `UR_AIRGAP_*`).
 */
import {Buffer} from 'buffer';
// Buffer polyfill is loaded in polyfills.js for React Native.
import {UR, UREncoder, URDecoder} from '@ngraveio/bc-ur';

/** Fragment size balances QR density vs frame count. Fountain mixes reconstruct without a full sequential pass. */
export const UR_BYTES_FRAGMENT_SIZE = 200;
export const UR_FRAME_INTERVAL_MS = 250;

/**
 * Airgap keyshare ciphertext is large (~100KB+). Larger fragments cut frame count;
 * faster cadence still works phone-to-phone with fountain recovery if a frame is missed.
 * ~500B / 125ms ≈ 5× wall-clock vs default 200B / 250ms for the same payload.
 */
export const UR_AIRGAP_FRAGMENT_SIZE = 500;
export const UR_AIRGAP_FRAME_INTERVAL_MS = 125;
export const UR_BYTES_TYPE = 'bytes';

export type UrBytesProgress = {
  total: number;
  received: number;
  percentage: number;
};

export type UrBytesReceiveResult =
  | {kind: 'not-ur'}
  | {kind: 'ignored'; type: string}
  | {kind: 'progress'; progress: UrBytesProgress}
  | {kind: 'complete'; payload: string}
  | {kind: 'error'};

export function utf8ToUr(payload: string): UR | null {
  try {
    if (!payload) {
      return null;
    }
    return UR.fromBuffer(Buffer.from(payload, 'utf8'));
  } catch {
    return null;
  }
}

/** Encode raw bytes (e.g. AES ciphertext) as `ur:bytes`. */
export function bufferToUr(buf: Buffer): UR | null {
  try {
    if (!buf || buf.length === 0) {
      return null;
    }
    return UR.fromBuffer(buf);
  } catch {
    return null;
  }
}

function decodeCborBuffer(ur: UR): Buffer | null {
  try {
    if (!ur || ur.type !== UR_BYTES_TYPE) {
      return null;
    }
    const cborPayload = ur.decodeCBOR();
    if (Buffer.isBuffer(cborPayload)) {
      return cborPayload;
    }
    if (cborPayload instanceof Uint8Array) {
      return Buffer.from(cborPayload);
    }
    if (
      cborPayload &&
      typeof cborPayload === 'object' &&
      Array.isArray((cborPayload as {data?: number[]}).data)
    ) {
      return Buffer.from((cborPayload as {data: number[]}).data);
    }
    return null;
  } catch {
    return null;
  }
}

export function urFragmentCount(
  ur: UR,
  maxFragmentLen: number = UR_BYTES_FRAGMENT_SIZE,
): number {
  try {
    const encoder = new UREncoder(ur, maxFragmentLen) as UREncoder & {
      fragmentsLength?: number;
    };
    return encoder.fragmentsLength || 1;
  } catch {
    return 1;
  }
}

export function urPartAt(
  ur: UR,
  partIndex: number,
  maxFragmentLen: number = UR_BYTES_FRAGMENT_SIZE,
): string | null {
  try {
    const encoder = new UREncoder(ur, maxFragmentLen);
    for (let i = 0; i < partIndex; i++) {
      encoder.nextPart();
    }
    return encoder.nextPart();
  } catch {
    return null;
  }
}

export function createUrEncoder(
  ur: UR,
  maxFragmentLen: number = UR_BYTES_FRAGMENT_SIZE,
): UREncoder {
  return new UREncoder(ur, maxFragmentLen);
}

export function urAllSequentialParts(
  ur: UR,
  maxFragmentLen: number = UR_BYTES_FRAGMENT_SIZE,
): string[] {
  const n = urFragmentCount(ur, maxFragmentLen);
  const encoder = createUrEncoder(ur, maxFragmentLen);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(encoder.nextPart());
  }
  return parts;
}

/** Sequential fragments plus extra fountain mixes (what the animated sender emits). */
export function urFountainParts(
  ur: UR,
  extraMixed = 0,
  maxFragmentLen: number = UR_BYTES_FRAGMENT_SIZE,
): string[] {
  const n = urFragmentCount(ur, maxFragmentLen);
  const encoder = createUrEncoder(ur, maxFragmentLen);
  const parts: string[] = [];
  const total = n + Math.max(0, extraMixed);
  for (let i = 0; i < total; i++) {
    parts.push(encoder.nextPart());
  }
  return parts;
}

export function urTypeFromPart(part: string): string | null {
  const lower = part.trim().toLowerCase();
  if (!lower.startsWith('ur:')) {
    return null;
  }
  return lower.split('/')[0].substring(3);
}

export function urToUtf8(ur: UR): string | null {
  const buf = decodeCborBuffer(ur);
  return buf ? buf.toString('utf8') : null;
}

/** Decode `ur:bytes` CBOR payload as base64 (airgap keyshare ciphertext). */
export function urToBase64(ur: UR): string | null {
  const buf = decodeCborBuffer(ur);
  return buf ? buf.toString('base64') : null;
}

/** Unique fragments received vs expected. Never 100% until `decoder.isComplete()`. */
export function urUniqueFragmentProgress(decoder: URDecoder): UrBytesProgress {
  const expected = decoder.expectedPartCount();
  const unique = decoder.receivedPartIndexes().length;
  if (decoder.isComplete()) {
    const total = Math.max(expected, unique, 1);
    return {total, received: total, percentage: 100};
  }
  const total = Math.max(expected, 1);
  const received = Math.min(unique, Math.max(total - 1, 0));
  const percentage = Math.min(99, Math.round((unique / total) * 100) || 0);
  return {total, received, percentage};
}

export function formatUrFragmentProgress(progress: UrBytesProgress): string {
  return `${progress.received} of ${progress.total}`;
}

function receiveUrBytesPartWith(
  decoder: URDecoder,
  part: string,
  acceptedTypes: string[],
  completePayload: (ur: UR) => string | null,
): UrBytesReceiveResult {
  const lower = part.trim().toLowerCase();
  if (!lower.startsWith('ur:')) {
    return {kind: 'not-ur'};
  }
  const type = urTypeFromPart(lower);
  if (!type || !acceptedTypes.includes(type)) {
    return {kind: 'ignored', type: type || ''};
  }
  try {
    decoder.receivePart(lower);
    const progress = urUniqueFragmentProgress(decoder);
    if (decoder.isComplete()) {
      if (!decoder.isSuccess()) {
        return {kind: 'error'};
      }
      const payload = completePayload(decoder.resultUR());
      if (!payload) {
        return {kind: 'error'};
      }
      return {kind: 'complete', payload};
    }
    return {kind: 'progress', progress};
  } catch {
    return {kind: 'error'};
  }
}

export function receiveUrBytesPart(
  decoder: URDecoder,
  part: string,
  acceptedTypes: string[] = [UR_BYTES_TYPE],
): UrBytesReceiveResult {
  return receiveUrBytesPartWith(decoder, part, acceptedTypes, urToUtf8);
}

/** Same fountain receive path, but complete payload is base64 of the raw bytes. */
export function receiveUrBytesPartAsBase64(
  decoder: URDecoder,
  part: string,
  acceptedTypes: string[] = [UR_BYTES_TYPE],
): UrBytesReceiveResult {
  return receiveUrBytesPartWith(decoder, part, acceptedTypes, urToBase64);
}

export function createUrDecoder(): URDecoder {
  return new URDecoder();
}
