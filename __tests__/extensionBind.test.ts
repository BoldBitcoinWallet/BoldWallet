/**
 * Unit tests for extension binding: mobile encode + extension-side decode/validate.
 * Spec v2: payload = pub_key ONLY (33 bytes). Master chaincode never leaves the device.
 */
const crypto = require('crypto');

function nodeSha256(data: string): Promise<string> {
  return Promise.resolve(
    crypto.createHash('sha256').update(data, 'utf8').digest('hex'),
  );
}

jest.mock('../native_modules', () => {
  const mockCrypto = require('crypto');
  return {
    BBMTLibNativeModule: {
      sha256: (data: string) =>
        Promise.resolve(
          mockCrypto.createHash('sha256').update(data, 'utf8').digest('hex'),
        ),
    },
  };
});

import {
  computeExtensionBindResponseQr,
  parseExtensionResponse,
  parsePairingCodeFromScannedData,
} from '../utils/extensionBind';

describe('extensionBind', () => {
  const validPubKey = '02'.padEnd(66, 'a'); // 66 hex chars (02 + 64 more)
  const pairingCode = '12345';

  describe('parsePairingCodeFromScannedData', () => {
    it('extracts pairing_code from query string', () => {
      expect(parsePairingCodeFromScannedData('pairing_code=12345')).toBe(
        '12345',
      );
      expect(parsePairingCodeFromScannedData('data: pairing_code=abc')).toBe(
        'abc',
      );
      expect(
        parsePairingCodeFromScannedData('  pairing_code=xyz&other=1  '),
      ).toBe('xyz');
    });
    it('returns null when no pairing_code', () => {
      expect(parsePairingCodeFromScannedData('foo=bar')).toBeNull();
      expect(parsePairingCodeFromScannedData('')).toBeNull();
    });
  });

  describe('round-trip: computeExtensionBindResponseQr + parseExtensionResponse', () => {
    it('deciphers response, extracts pubKey only, and validates checksum', async () => {
      const responseBase64 = await computeExtensionBindResponseQr(
        pairingCode,
        validPubKey,
      );
      expect(typeof responseBase64).toBe('string');
      expect(responseBase64.length).toBeGreaterThan(0);
      expect(Buffer.from(responseBase64, 'base64').length).toBe(35);

      const result = await parseExtensionResponse(responseBase64, pairingCode);
      expect(result.pubKey).toBe(validPubKey);
      expect(result.chainCode).toBe('');
      expect(result.valid).toBe(true);
    });

    it('rejects chaincode export attempts', async () => {
      await expect(
        computeExtensionBindResponseQr(pairingCode, validPubKey, 'b'.repeat(64)),
      ).rejects.toThrow(/chaincode export removed/);
    });

    it('rejects legacy 67-byte responses carrying chaincode', async () => {
      const legacy = Buffer.alloc(67).toString('base64');
      await expect(
        parseExtensionResponse(legacy, pairingCode, nodeSha256),
      ).rejects.toThrow(/Legacy extension response/);
    });

    it('returns valid: false when checksum is tampered', async () => {
      const responseBase64 = await computeExtensionBindResponseQr(
        pairingCode,
        validPubKey,
      );
      const buf = Buffer.from(responseBase64, 'base64');
      // eslint-disable-next-line no-bitwise
      buf[34] ^= 0xff; // flip last checksum byte
      const tamperedBase64 = buf.toString('base64');

      const result = await parseExtensionResponse(tamperedBase64, pairingCode);
      expect(result.valid).toBe(false);
      expect(result.pubKey).toBe(validPubKey);
      expect(result.chainCode).toBe('');
    });

    it('deciphers to different payload and valid: false when pairing code is wrong', async () => {
      const responseBase64 = await computeExtensionBindResponseQr(
        pairingCode,
        validPubKey,
      );
      const wrongPairingCode = '99999';
      const result = await parseExtensionResponse(
        responseBase64,
        wrongPairingCode,
      );
      expect(result.valid).toBe(false);
      expect(result.pubKey).not.toBe(validPubKey);
    });
  });

  describe('parseExtensionResponse with custom sha256 (extension side)', () => {
    it('works when caller provides sha256Fn (e.g. extension uses Web Crypto)', async () => {
      const responseBase64 = await computeExtensionBindResponseQr(
        pairingCode,
        validPubKey,
      );
      const result = await parseExtensionResponse(
        responseBase64,
        pairingCode,
        nodeSha256,
      );
      expect(result.pubKey).toBe(validPubKey);
      expect(result.chainCode).toBe('');
      expect(result.valid).toBe(true);
    });

    it('throws on invalid response length', async () => {
      const shortBase64 = Buffer.alloc(10).toString('base64');
      await expect(
        parseExtensionResponse(shortBase64, pairingCode, nodeSha256),
      ).rejects.toThrow(/expected 35 bytes/);
    });
  });
});
