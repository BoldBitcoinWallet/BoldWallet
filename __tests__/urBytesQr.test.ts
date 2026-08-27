import {Buffer} from 'buffer';
(global as any).Buffer = (global as any).Buffer || Buffer;

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {clear: jest.fn()},
}));
jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));
jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {},
}));
jest.mock('../services/tssBackend', () => ({
  detectKeyshareTssBackend: jest.fn(),
}));

import {encodeSendBitcoinQR, decodeSendBitcoinQR} from '../utils';
import {
  createUrDecoder,
  decoderMatchesPartSeqLen,
  nextAirgapQrSpeed,
  receiveUrBytesPart,
  receiveUrBytesPartAsBase64,
  urAllSequentialParts,
  urFountainParts,
  urFragmentCount,
  urPartAt,
  urSeqLenFromPart,
  urSeqIndexFromPart,
  createUrScanFrameTracker,
  recordUrScanFrame,
  urScanHudFromUniqueSimple,
  urFountainWrapAfter,
  urTypeFromPart,
  utf8ToUr,
  bufferToUr,
  UR_AIRGAP_DEFAULT_SPEED,
  UR_AIRGAP_FRAGMENT_SIZE,
  UR_AIRGAP_SPEEDS,
  UR_BYTES_FRAGMENT_SIZE,
} from '../utils/urBytesQr';

const MAX_STATIC_QR_CHARS = 1800;

function makeUtxosJson(count: number): string {
  const utxos = Array.from({length: count}, (_, i) => ({
    txid: `${i.toString(16).padStart(64, 'a')}`,
    vout: i,
    value: 10000 + i,
    derivation_path: `m/84'/0'/0'/0/${i}`,
    address: `bc1q${i.toString(16).padStart(38, '0')}`,
  }));
  return JSON.stringify(utxos);
}

describe('urBytesQr send-bitcoin round-trip', () => {
  const smallPayload = encodeSendBitcoinQR(
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    '100000',
    '500',
    'hash',
    'segwit-native',
    "m/84'/0'/0'/0/0",
    'mainnet',
    makeUtxosJson(1),
    'bc1qchange00000000000000000000000000000000',
  );

  const largePayload = encodeSendBitcoinQR(
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    '250000',
    '1800',
    'spendinghash',
    'segwit-native',
    "m/84'/0'/0'/0/12",
    'mainnet',
    makeUtxosJson(40),
    'bc1qchange11111111111111111111111111111111',
  );

  it('keeps small send payloads as a single static string', () => {
    expect(smallPayload.length).toBeLessThanOrEqual(MAX_STATIC_QR_CHARS);
    const decoded = decodeSendBitcoinQR(smallPayload) as {
      utxosJson?: string;
      toAddress: string;
    };
    expect(decoded?.toAddress).toBe(
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    );
    expect(JSON.parse(decoded.utxosJson || '[]')).toHaveLength(1);
  });

  it('round-trips a large utxosJson through UR fountain parts', () => {
    expect(largePayload.length).toBeGreaterThan(MAX_STATIC_QR_CHARS);

    const ur = utf8ToUr(largePayload);
    expect(ur).not.toBeNull();
    expect(urFragmentCount(ur!)).toBeGreaterThan(1);

    const parts = urAllSequentialParts(ur!);
    expect(parts.length).toBeGreaterThan(1);
    expect(urTypeFromPart(parts[0]!)).toBe('bytes');

    const decoder = createUrDecoder();
    let payload: string | null = null;
    for (const part of parts) {
      const result = receiveUrBytesPart(decoder, part);
      if (result.kind === 'complete') {
        payload = result.payload;
        break;
      }
      expect(result.kind).toBe('progress');
    }
    expect(payload).toBe(largePayload);

    const decoded = decodeSendBitcoinQR(payload!) as {
      amountSats: string;
      feeSats: string;
      utxosJson?: string;
      changeAddress?: string;
    };
    expect(decoded?.amountSats).toBe('250000');
    expect(decoded?.feeSats).toBe('1800');
    expect(decoded?.changeAddress).toBe(
      'bc1qchange11111111111111111111111111111111',
    );
    expect(JSON.parse(decoded.utxosJson || '[]')).toHaveLength(40);
  });

  it('exposes frame helpers that do not assume ur:bytes', () => {
    const ur = utf8ToUr('hello-bold-wallet');
    expect(ur).not.toBeNull();
    expect(urFragmentCount(ur!)).toBeGreaterThanOrEqual(1);
    const part = urPartAt(ur!, 0);
    expect(part?.toLowerCase().startsWith('ur:bytes/')).toBe(true);
  });

  it('ignores crypto-psbt UR frames on the send scanner path', () => {
    const decoder = createUrDecoder();
    const result = receiveUrBytesPart(
      decoder,
      'ur:crypto-psbt/1-3/taadecgooyadgdaeaoae',
    );
    expect(result.kind).toBe('ignored');
    if (result.kind === 'ignored') {
      expect(result.type).toBe('crypto-psbt');
    }
  });

  it('reports unique fragment counts instead of fountain 99% estimates', () => {
    const ur = utf8ToUr(largePayload);
    expect(ur).not.toBeNull();
    const parts = urAllSequentialParts(ur!);
    expect(parts.length).toBeGreaterThanOrEqual(10);

    const decoder = createUrDecoder();
    const first = receiveUrBytesPart(decoder, parts[0]!);
    expect(first.kind).toBe('progress');
    if (first.kind !== 'progress') {
      return;
    }
    expect(first.progress.total).toBe(parts.length);
    expect(first.progress.received).toBe(1);
    expect(first.progress.percentage).toBeLessThan(50);

    const afterDupes = receiveUrBytesPart(decoder, parts[0]!);
    expect(afterDupes.kind).toBe('progress');
    if (afterDupes.kind === 'progress') {
      expect(afterDupes.progress.received).toBe(1);
      expect(afterDupes.progress.percentage).toBeLessThan(50);
    }
    for (let i = 0; i < 8; i++) {
      receiveUrBytesPart(decoder, parts[0]!);
    }
    const stillFirst = receiveUrBytesPart(decoder, parts[0]!);
    expect(stillFirst.kind).toBe('progress');
    if (stillFirst.kind === 'progress') {
      expect(stillFirst.progress.received).toBe(1);
      expect(stillFirst.progress.total).toBe(parts.length);
      expect(stillFirst.progress.percentage).toBeLessThan(50);
    }

    const third = receiveUrBytesPart(decoder, parts[2]!);
    const second = receiveUrBytesPart(decoder, parts[1]!);
    expect(second.kind).toBe('progress');
    expect(third.kind).toBe('progress');
    if (second.kind === 'progress') {
      expect(second.progress.received).toBe(3);
      expect(second.progress.total).toBe(parts.length);
      expect(second.progress.percentage).toBeLessThan(50);
      expect(second.progress.received).toBeLessThan(second.progress.total);
    }
  });

  it('does not treat incomplete UR as done until all fragments arrive', () => {
    const ur = utf8ToUr(largePayload);
    const parts = urAllSequentialParts(ur!);
    const decoder = createUrDecoder();
    for (let i = 0; i < parts.length - 1; i++) {
      const result = receiveUrBytesPart(decoder, parts[i]!);
      expect(result.kind).toBe('progress');
      if (result.kind === 'progress') {
        expect(result.progress.received).toBeLessThan(result.progress.total);
        expect(result.progress.percentage).toBeLessThan(100);
      }
    }
    const done = receiveUrBytesPart(decoder, parts[parts.length - 1]!);
    expect(done.kind).toBe('complete');
  });

  it('round-trips through extra fountain mixed parts, not only sequential frames', () => {
    const ur = utf8ToUr(largePayload);
    expect(ur).not.toBeNull();
    const sequential = urAllSequentialParts(ur!);
    const mixed = urFountainParts(ur!, 8);
    expect(mixed.length).toBe(sequential.length + 8);

    const decoder = createUrDecoder();
    let payload: string | null = null;
    // Skip some sequential frames; mixed parts should still reconstruct.
    const subset = [...mixed.slice(2, 6), ...mixed.slice(sequential.length)];
    for (const part of subset) {
      const result = receiveUrBytesPart(decoder, part);
      if (result.kind === 'complete') {
        payload = result.payload;
        break;
      }
    }
    if (!payload) {
      for (const part of mixed) {
        const result = receiveUrBytesPart(decoder, part);
        if (result.kind === 'complete') {
          payload = result.payload;
          break;
        }
      }
    }
    expect(payload).toBe(largePayload);
    const decoded = decodeSendBitcoinQR(payload!) as {utxosJson?: string};
    expect(JSON.parse(decoded.utxosJson || '[]')).toHaveLength(40);
  });
});

describe('urBytesQr binary airgap payload', () => {
  it('round-trips AES ciphertext bytes through UR fountain parts as base64', () => {
    const encryptedBytes = Buffer.alloc(8192);
    for (let i = 0; i < encryptedBytes.length; i++) {
      encryptedBytes[i] = (i * 17 + 43) % 256;
    }
    const originalBase64 = encryptedBytes.toString('base64');
    const ur = bufferToUr(Buffer.from(originalBase64, 'base64'));
    expect(ur).not.toBeNull();
    expect(urFragmentCount(ur!)).toBeGreaterThan(1);

    const parts = urFountainParts(ur!, 4);
    expect(urTypeFromPart(parts[0]!)).toBe('bytes');

    const decoder = createUrDecoder();
    let recovered: string | null = null;
    for (const part of parts) {
      const result = receiveUrBytesPartAsBase64(decoder, part);
      if (result.kind === 'complete') {
        recovered = result.payload;
        break;
      }
      expect(['progress', 'not-ur', 'ignored']).toContain(result.kind);
    }
    expect(recovered).toBe(originalBase64);
    expect(Buffer.from(recovered!, 'base64').equals(encryptedBytes)).toBe(true);
  });

  it('uses fewer frames with larger airgap fragments than the send default', () => {
    const encryptedBytes = Buffer.alloc(140_000);
    for (let i = 0; i < encryptedBytes.length; i++) {
      encryptedBytes[i] = (i * 31 + 7) % 256;
    }
    const ur = bufferToUr(encryptedBytes);
    expect(ur).not.toBeNull();
    const sendFrames = urFragmentCount(ur!);
    const defaultFrames = urFragmentCount(
      ur!,
      UR_AIRGAP_SPEEDS.default.fragmentSize,
    );
    const mediumFrames = urFragmentCount(
      ur!,
      UR_AIRGAP_SPEEDS.medium.fragmentSize,
    );
    const fastFrames = urFragmentCount(
      ur!,
      UR_AIRGAP_SPEEDS.fast.fragmentSize,
    );
    expect(sendFrames).toBeGreaterThan(600);
    expect(defaultFrames).toBeLessThan(sendFrames);
    expect(defaultFrames).toBeLessThan(mediumFrames);
    expect(mediumFrames).toBeLessThan(fastFrames);
    expect(UR_AIRGAP_FRAGMENT_SIZE).toBe(
      UR_AIRGAP_SPEEDS.default.fragmentSize,
    );
    expect(UR_AIRGAP_FRAGMENT_SIZE).toBeGreaterThan(UR_BYTES_FRAGMENT_SIZE);
    expect(UR_AIRGAP_DEFAULT_SPEED).toBe('default');
    expect(nextAirgapQrSpeed('default')).toBe('medium');
    expect(nextAirgapQrSpeed('medium')).toBe('fast');
    expect(nextAirgapQrSpeed('fast')).toBe('default');
    expect(UR_AIRGAP_SPEEDS.default.frameIntervalMs).toBe(330);
    expect(UR_AIRGAP_SPEEDS.medium.frameIntervalMs).toBe(280);
    expect(UR_AIRGAP_SPEEDS.fast.frameIntervalMs).toBe(200);

    const parts = urFountainParts(
      ur!,
      8,
      UR_AIRGAP_SPEEDS.default.fragmentSize,
    );
    const decoder = createUrDecoder();
    let recovered: string | null = null;
    for (const part of parts) {
      const result = receiveUrBytesPartAsBase64(decoder, part);
      if (result.kind === 'complete') {
        recovered = result.payload;
        expect(result.progress.percentage).toBe(100);
        break;
      }
    }
    expect(recovered).toBe(encryptedBytes.toString('base64'));
  });

  it('parses seqLen from multipart UR and detects a speed switch', () => {
    const encryptedBytes = Buffer.alloc(12_000);
    for (let i = 0; i < encryptedBytes.length; i++) {
      encryptedBytes[i] = (i * 11 + 5) % 256;
    }
    const ur = bufferToUr(encryptedBytes);
    expect(ur).not.toBeNull();
    const mediumParts = urAllSequentialParts(
      ur!,
      UR_AIRGAP_SPEEDS.medium.fragmentSize,
    );
    const fastParts = urAllSequentialParts(
      ur!,
      UR_AIRGAP_SPEEDS.fast.fragmentSize,
    );
    const mediumLen = urSeqLenFromPart(mediumParts[0]!);
    const fastLen = urSeqLenFromPart(fastParts[0]!);
    expect(mediumLen).toBeGreaterThan(1);
    expect(fastLen).toBeGreaterThan(1);
    expect(mediumLen).not.toBe(fastLen);

    const decoder = createUrDecoder();
    const first = receiveUrBytesPartAsBase64(decoder, mediumParts[0]!);
    expect(first.kind).toBe('progress');
    expect(decoderMatchesPartSeqLen(decoder, mediumParts[1]!)).toBe(true);
    expect(decoderMatchesPartSeqLen(decoder, fastParts[0]!)).toBe(false);
  });

  it('tracks unique UR seq frames for scanner HUD parity', () => {
    const tracker = createUrScanFrameTracker();
    const first = recordUrScanFrame(tracker, 'ur:bytes/1-10/lpadaaaa');
    expect(first.novel).toBe(true);
    expect(first.progress).toEqual({
      total: 10,
      received: 1,
      percentage: 10,
    });
    const dup = recordUrScanFrame(tracker, 'ur:bytes/1-10/lpadaaaa');
    expect(dup.novel).toBe(false);
    expect(dup.progress?.received).toBe(1);
    const second = recordUrScanFrame(tracker, 'ur:bytes/2-10/lpadbbbb');
    expect(second.novel).toBe(true);
    expect(second.progress?.received).toBe(2);
    expect(urSeqIndexFromPart('ur:bytes/2-10/lpadbbbb')).toEqual({
      seq: 2,
      seqLen: 10,
    });
    const switched = recordUrScanFrame(tracker, 'ur:bytes/1-4/lpadcccc');
    expect(switched.novel).toBe(true);
    expect(switched.progress).toEqual({
      total: 4,
      received: 1,
      percentage: 25,
    });
  });

  it('does not treat fountain mix seq numbers as N/N recovered', () => {
    expect(urScanHudFromUniqueSimple(470, 470)).toEqual({
      total: 470,
      received: 469,
      percentage: 99,
    });
    const tracker = createUrScanFrameTracker();
    for (let seq = 1; seq <= 10; seq++) {
      recordUrScanFrame(tracker, `ur:bytes/${seq}-10/lpadxxxx`);
    }
    expect(tracker.seqs.size).toBe(10);
    expect(recordUrScanFrame(tracker, 'ur:bytes/1-10/lpadxxxx').progress).toEqual(
      {
        total: 10,
        received: 9,
        percentage: 99,
      },
    );
    const mixOnly = createUrScanFrameTracker();
    for (let seq = 11; seq <= 20; seq++) {
      recordUrScanFrame(mixOnly, `ur:bytes/${seq}-10/lpadmixx`);
    }
    expect(mixOnly.seqs.size).toBe(0);
    expect(
      recordUrScanFrame(mixOnly, 'ur:bytes/11-10/lpadmixx').progress,
    ).toEqual({
      total: 10,
      received: 0,
      percentage: 0,
    });
  });

  it('wraps the fountain encoder after one sequential pass plus one mix pass', () => {
    expect(urFountainWrapAfter(470)).toBe(940);
    expect(urFountainWrapAfter(1)).toBe(2);
    expect(urFountainWrapAfter(0)).toBe(2);
  });
});
