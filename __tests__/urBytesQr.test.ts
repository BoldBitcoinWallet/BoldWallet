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
  receiveUrBytesPart,
  receiveUrBytesPartAsBase64,
  urAllSequentialParts,
  urFountainParts,
  urFragmentCount,
  urPartAt,
  urTypeFromPart,
  utf8ToUr,
  bufferToUr,
  UR_AIRGAP_FRAGMENT_SIZE,
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

  it('uses fewer frames with airgap fragment size than the send default', () => {
    const encryptedBytes = Buffer.alloc(140_000);
    for (let i = 0; i < encryptedBytes.length; i++) {
      encryptedBytes[i] = (i * 31 + 7) % 256;
    }
    const ur = bufferToUr(encryptedBytes);
    expect(ur).not.toBeNull();
    const defaultFrames = urFragmentCount(ur!);
    const airgapFrames = urFragmentCount(ur!, UR_AIRGAP_FRAGMENT_SIZE);
    expect(defaultFrames).toBeGreaterThan(600);
    expect(airgapFrames).toBeLessThan(defaultFrames);
    expect(airgapFrames).toBeLessThanOrEqual(
      Math.ceil(encryptedBytes.length / UR_AIRGAP_FRAGMENT_SIZE) + 2,
    );
    expect(UR_AIRGAP_FRAGMENT_SIZE).toBeGreaterThan(UR_BYTES_FRAGMENT_SIZE);

    const parts = urFountainParts(ur!, 8, UR_AIRGAP_FRAGMENT_SIZE);
    const decoder = createUrDecoder();
    let recovered: string | null = null;
    for (const part of parts) {
      const result = receiveUrBytesPartAsBase64(decoder, part);
      if (result.kind === 'complete') {
        recovered = result.payload;
        break;
      }
    }
    expect(recovered).toBe(encryptedBytes.toString('base64'));
  });
});
