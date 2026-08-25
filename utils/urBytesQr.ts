/**
 * BC-UR fountain helpers.
 *
 * Frame helpers (`urPartAt`, `urFragmentCount`) work for any UR type
 * (`bytes`, `crypto-psbt`, …). Send-bitcoin uses `utf8ToUr` → `ur:bytes`.
 * Signed PSBT keeps `CryptoPSBT.toUR()` → `ur:crypto-psbt`.
 * Airgap keyshare uses speed presets in `UR_AIRGAP_SPEEDS` (default / medium / fast).
 */
import {Buffer} from 'buffer';
// Buffer polyfill is loaded in polyfills.js for React Native.
import {UR, UREncoder, URDecoder} from '@ngraveio/bc-ur';

/** Fragment size balances QR density vs frame count. Fountain mixes reconstruct without a full sequential pass. */
export const UR_BYTES_FRAGMENT_SIZE = 200;
export const UR_FRAME_INTERVAL_MS = 250;

/**
 * Airgap export speed presets (fragment size + frame interval).
 * Larger fragments = fewer denser QRs; slower interval = more camera time.
 * Changing speed changes seqLen — encoder and decoder must restart together.
 */
export type AirgapQrSpeed = 'default' | 'medium' | 'fast';

export const UR_AIRGAP_SPEEDS: Record<
  AirgapQrSpeed,
  {fragmentSize: number; frameIntervalMs: number; label: string}
> = {
  default: {fragmentSize: 500, frameIntervalMs: 500, label: 'Default'},
  medium: {fragmentSize: 300, frameIntervalMs: 300, label: 'Medium'},
  fast: {fragmentSize: 150, frameIntervalMs: 150, label: 'Fast'},
};

export const UR_AIRGAP_DEFAULT_SPEED: AirgapQrSpeed = 'default';
export const UR_AIRGAP_SPEED_ORDER: AirgapQrSpeed[] = [
  'default',
  'medium',
  'fast',
];

export function nextAirgapQrSpeed(current: AirgapQrSpeed): AirgapQrSpeed {
  const i = UR_AIRGAP_SPEED_ORDER.indexOf(current);
  return UR_AIRGAP_SPEED_ORDER[(i + 1) % UR_AIRGAP_SPEED_ORDER.length];
}

/**
 * After one sequential pass plus one mix pass, rewind the encoder so missed
 * original fragments get another scan chance. Mix-only forever stalls the HUD
 * at whatever unique originals the camera caught (often ~60%).
 */
export function urFountainWrapAfter(seqLen: number): number {
  return Math.max(2, Math.max(0, seqLen) * 2);
}

/** Default airgap fragment size (500B). */
export const UR_AIRGAP_FRAGMENT_SIZE =
  UR_AIRGAP_SPEEDS.default.fragmentSize;
export const UR_AIRGAP_FRAME_INTERVAL_MS =
  UR_AIRGAP_SPEEDS.default.frameIntervalMs;
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
  | {kind: 'complete'; payload: string; progress: UrBytesProgress}
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
    const cborPayload: unknown = ur.decodeCBOR();
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

/**
 * Multipart UR seqLen from `ur:type/seq-seqLen/…`. Single-part URs have no seq.
 */
export function urSeqLenFromPart(part: string): number | null {
  return urSeqIndexFromPart(part)?.seqLen ?? null;
}

/**
 * Multipart UR `seq` and `seqLen` from `ur:type/seq-seqLen/…`.
 * Same shape the Android ZXing overlay parses for live frame counts.
 */
export function urSeqIndexFromPart(
  part: string,
): {seq: number; seqLen: number} | null {
  const lower = part.trim().toLowerCase();
  const match = lower.match(/^ur:[^/]+\/(\d+)-(\d+)\//);
  if (!match) {
    return null;
  }
  const seq = parseInt(match[1], 10);
  const seqLen = parseInt(match[2], 10);
  if (!Number.isFinite(seq) || !Number.isFinite(seqLen) || seqLen <= 0) {
    return null;
  }
  return {seq, seqLen};
}

export type UrScanFrameTracker = {
  seqLen: number;
  seqs: Set<number>;
};

export function createUrScanFrameTracker(): UrScanFrameTracker {
  return {seqLen: 0, seqs: new Set()};
}

/**
 * Overlay counts original fragment indexes (`seq` in 1..seqLen).
 * Fountain mix frames use seq > seqLen — counting those as well hits N/N
 * while the decoder is still waiting, which looks like a finished scan.
 * Never reports 100% / N of N; `decoder.isComplete()` closes the scanner.
 */
export function urScanHudFromUniqueSimple(
  seqLen: number,
  uniqueSimple: number,
): UrBytesProgress {
  const total = Math.max(seqLen, 1);
  const unique = Math.max(0, uniqueSimple);
  const received = Math.min(unique, Math.max(total - 1, 0));
  const percentage = Math.min(99, Math.round((unique / total) * 100) || 0);
  return {total, received, percentage};
}

/** Unique original-fragment seq indexes vs expected seqLen — matches Android capture HUD. */
export function recordUrScanFrame(
  tracker: UrScanFrameTracker,
  part: string,
): {novel: boolean; progress: UrBytesProgress | null} {
  const parsed = urSeqIndexFromPart(part);
  let novel = false;
  if (parsed) {
    if (tracker.seqLen !== 0 && tracker.seqLen !== parsed.seqLen) {
      tracker.seqs.clear();
    }
    tracker.seqLen = parsed.seqLen;
    const before = tracker.seqs.size;
    // Mix frames are seq > seqLen; they reconstruct data but must not fill N/N.
    if (parsed.seq >= 1 && parsed.seq <= parsed.seqLen) {
      tracker.seqs.add(parsed.seq);
    }
    novel = tracker.seqs.size > before;
  }
  if (tracker.seqLen <= 0) {
    return {novel, progress: null};
  }
  return {
    novel,
    progress: urScanHudFromUniqueSimple(tracker.seqLen, tracker.seqs.size),
  };
}

/** False when this part belongs to a different fragment size / seqLen session. */
export function decoderMatchesPartSeqLen(
  decoder: URDecoder,
  part: string,
): boolean {
  const seqLen = urSeqLenFromPart(part);
  if (!seqLen) {
    return true;
  }
  const expected = decoder.expectedPartCount();
  if (!expected) {
    return true;
  }
  return expected === seqLen;
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

/** Airgap restore: unique fragments vs expected; fountain can finish before N/N. */
export function formatUrRecoveredProgress(progress: UrBytesProgress): string {
  return `Recovered ${progress.received} / ${progress.total} (~${progress.percentage}%)`;
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
      return {kind: 'complete', payload, progress};
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
