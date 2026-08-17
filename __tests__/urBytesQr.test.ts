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
  urAllSequentialParts,
  urFragmentCount,
  urPartAt,
  urTypeFromPart,
  utf8ToUr,
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
});
