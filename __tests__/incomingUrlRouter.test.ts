import {
  parseBitcoinUri,
  parseBoldwalletUri,
  parseUniversalPayLink,
  parseIncomingUrl,
  extractBitcoinAddressFromPaymentInput,
} from '../services/incomingUrlRouter';

describe('incomingUrlRouter', () => {
  describe('parseBitcoinUri', () => {
    it('parses address-only BIP-21 URI', () => {
      expect(parseBitcoinUri('bitcoin:bc1qexampleaddress')).toEqual({
        kind: 'bitcoin-pay',
        address: 'bc1qexampleaddress',
      });
    });

    it('parses BIP-21 URI with amount', () => {
      expect(
        parseBitcoinUri('bitcoin:bc1qexampleaddress?amount=0.001&label=shop'),
      ).toEqual({
        kind: 'bitcoin-pay',
        address: 'bc1qexampleaddress',
        amountBtc: '0.001',
      });
    });

    it('returns unknown for non-bitcoin input', () => {
      expect(parseBitcoinUri('https://example.com')).toEqual({kind: 'unknown'});
    });
  });

  describe('parseBoldwalletUri', () => {
    it('recognizes import-keyshare handoff', () => {
      expect(parseBoldwalletUri('boldwallet://import-keyshare')).toEqual({
        kind: 'boldwallet-import-keyshare',
      });
    });

    it('parses boldwallet://pay with address and amount', () => {
      expect(
        parseBoldwalletUri(
          'boldwallet://pay?address=bc1qtest&amount=0.25&label=shop',
        ),
      ).toEqual({
        kind: 'boldwallet-pay',
        address: 'bc1qtest',
        amountBtc: '0.25',
      });
    });

    it('returns unknown for pay without address', () => {
      expect(parseBoldwalletUri('boldwallet://pay?amount=1')).toEqual({
        kind: 'unknown',
      });
    });

    it('returns unknown for other boldwallet paths', () => {
      expect(parseBoldwalletUri('boldwallet://other')).toEqual({
        kind: 'unknown',
      });
    });
  });

  describe('parseUniversalPayLink', () => {
    it('parses HTTPS pay link on allowed host', () => {
      expect(
        parseUniversalPayLink(
          'https://boldbitcoinwallet.com/pay?address=bc1qtest&amount=0.5',
        ),
      ).toEqual({
        kind: 'universal-pay',
        address: 'bc1qtest',
        amountBtc: '0.5',
      });
    });

    it('rejects non-pay paths', () => {
      expect(
        parseUniversalPayLink('https://boldbitcoinwallet.com/blog/post'),
      ).toEqual({kind: 'unknown'});
    });

    it('rejects unknown hosts', () => {
      expect(
        parseUniversalPayLink('https://evil.com/pay?address=bc1qtest'),
      ).toEqual({kind: 'unknown'});
    });
  });

  describe('parseIncomingUrl', () => {
    it('dispatches bitcoin scheme', () => {
      const result = parseIncomingUrl('bitcoin:bc1qabc?amount=1');
      expect(result.kind).toBe('bitcoin-pay');
      if (result.kind === 'bitcoin-pay') {
        expect(result.address).toBe('bc1qabc');
        expect(result.amountBtc).toBe('1');
      }
    });

    it('dispatches boldwallet scheme', () => {
      expect(parseIncomingUrl('boldwallet://import-keyshare').kind).toBe(
        'boldwallet-import-keyshare',
      );
    });

    it('dispatches boldwallet pay scheme', () => {
      const result = parseIncomingUrl(
        'boldwallet://pay?address=bc1qcustom&amount=0.01',
      );
      expect(result).toEqual({
        kind: 'boldwallet-pay',
        address: 'bc1qcustom',
        amountBtc: '0.01',
      });
    });

    it('dispatches https pay links', () => {
      const result = parseIncomingUrl(
        'https://www.boldbitcoinwallet.com/pay?address=bc1qxyz',
      );
      expect(result.kind).toBe('universal-pay');
    });
  });

  describe('extractBitcoinAddressFromPaymentInput', () => {
    it('extracts address from BIP-21 URI', () => {
      expect(
        extractBitcoinAddressFromPaymentInput(
          'bitcoin:bc1qfromuri?amount=0.01',
        ),
      ).toBe('bc1qfromuri');
    });

    it('extracts address from universal pay link', () => {
      expect(
        extractBitcoinAddressFromPaymentInput(
          'https://boldbitcoinwallet.com/pay?address=bc1qfromweb',
        ),
      ).toBe('bc1qfromweb');
    });

    it('returns plain address unchanged', () => {
      expect(extractBitcoinAddressFromPaymentInput('bc1qplain')).toBe(
        'bc1qplain',
      );
    });
  });
});
