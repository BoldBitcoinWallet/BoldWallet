/**
 * Unit tests for extension binding: mobile encode + extension-side decode/validate.
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
  const validChainCode = 'b'.repeat(64);
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
    it('deciphers response, extracts pubKey and chainCode, and validates checksum', async () => {
      const responseBase64 = await computeExtensionBindResponseQr(
        pairingCode,
        validPubKey,
        validChainCode,
      );
      expect(typeof responseBase64).toBe('string');
      expect(responseBase64.length).toBeGreaterThan(0);

      const result = await parseExtensionResponse(responseBase64, pairingCode);
      expect(result.pubKey).toBe(validPubKey);
      expect(result.chainCode).toBe(validChainCode);
      expect(result.valid).toBe(true);
    });

    it('returns valid: false when checksum is tampered', async () => {
      const responseBase64 = await computeExtensionBindResponseQr(
        pairingCode,
        validPubKey,
        validChainCode,
      );
      const buf = Buffer.from(responseBase64, 'base64');
      // eslint-disable-next-line no-bitwise
      buf[66] ^= 0xff; // flip last checksum byte
      const tamperedBase64 = buf.toString('base64');

      const result = await parseExtensionResponse(tamperedBase64, pairingCode);
      expect(result.valid).toBe(false);
      expect(result.pubKey).toBe(validPubKey);
      expect(result.chainCode).toBe(validChainCode);
    });

    it('deciphers to different payload and valid: false when pairing code is wrong', async () => {
      const responseBase64 = await computeExtensionBindResponseQr(
        pairingCode,
        validPubKey,
        validChainCode,
      );
      const wrongPairingCode = '99999';
      const result = await parseExtensionResponse(
        responseBase64,
        wrongPairingCode,
      );
      expect(result.valid).toBe(false);
      expect(result.pubKey).not.toBe(validPubKey);
      expect(result.chainCode).not.toBe(validChainCode);
    });
  });

  describe('parseExtensionResponse with custom sha256 (extension side)', () => {
    it('works when caller provides sha256Fn (e.g. extension uses Web Crypto)', async () => {
      const responseBase64 = await computeExtensionBindResponseQr(
        pairingCode,
        validPubKey,
        validChainCode,
      );
      const result = await parseExtensionResponse(
        responseBase64,
        pairingCode,
        nodeSha256,
      );
      expect(result.pubKey).toBe(validPubKey);
      expect(result.chainCode).toBe(validChainCode);
      expect(result.valid).toBe(true);
    });

    it('throws on invalid response length', async () => {
      const shortBase64 = Buffer.alloc(10).toString('base64');
      await expect(
        parseExtensionResponse(shortBase64, pairingCode, nodeSha256),
      ).rejects.toThrow(/expected 67 bytes/);
    });
  });
});
