/**
 * BC-UR fountain helpers.
 *
 * Frame helpers (`urPartAt`, `urFragmentCount`) work for any UR type
 * (`bytes`, `crypto-psbt`, …). Send-bitcoin uses `utf8ToUr` → `ur:bytes`.
 * Signed PSBT keeps `CryptoPSBT.toUR()` → `ur:crypto-psbt`.
 */
import {Buffer} from 'buffer';
// Buffer polyfill is loaded in polyfills.js for React Native.
import {UR, UREncoder, URDecoder} from '@ngraveio/bc-ur';

export const UR_BYTES_FRAGMENT_SIZE = 200;
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

export function urFragmentCount(ur: UR): number {
  try {
    const encoder = new UREncoder(ur, UR_BYTES_FRAGMENT_SIZE) as UREncoder & {
      fragmentsLength?: number;
    };
    return encoder.fragmentsLength || 1;
  } catch {
    return 1;
  }
}

export function urPartAt(ur: UR, partIndex: number): string | null {
  try {
    const encoder = new UREncoder(ur, UR_BYTES_FRAGMENT_SIZE);
    for (let i = 0; i < partIndex; i++) {
      encoder.nextPart();
    }
    return encoder.nextPart();
  } catch {
    return null;
  }
}

export function urAllSequentialParts(ur: UR): string[] {
  const n = urFragmentCount(ur);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const part = urPartAt(ur, i);
    if (part) {
      parts.push(part);
    }
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
  try {
    if (!ur || ur.type !== UR_BYTES_TYPE) {
      return null;
    }
    const cborPayload = ur.decodeCBOR();
    if (Buffer.isBuffer(cborPayload)) {
      return cborPayload.toString('utf8');
    }
    if (cborPayload instanceof Uint8Array) {
      return Buffer.from(cborPayload).toString('utf8');
    }
    if (
      cborPayload &&
      typeof cborPayload === 'object' &&
      Array.isArray((cborPayload as {data?: number[]}).data)
    ) {
      return Buffer.from((cborPayload as {data: number[]}).data).toString(
        'utf8',
      );
    }
    return null;
  } catch {
    return null;
  }
}

export function receiveUrBytesPart(
  decoder: URDecoder,
  part: string,
  acceptedTypes: string[] = [UR_BYTES_TYPE],
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
    const percentage = Math.round(decoder.estimatedPercentComplete() * 100);
    const progress: UrBytesProgress = {
      total: 100,
      received: percentage,
      percentage,
    };
    if (decoder.isComplete()) {
      if (!decoder.isSuccess()) {
        return {kind: 'error'};
      }
      const payload = urToUtf8(decoder.resultUR());
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

export function createUrDecoder(): URDecoder {
  return new URDecoder();
}
