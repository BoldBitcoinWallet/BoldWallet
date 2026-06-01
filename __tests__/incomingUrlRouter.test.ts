import {
  parseBitcoinUri,
  parseBoldwalletUri,
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

    it('returns unknown for boldwallet pay paths', () => {
      expect(
        parseBoldwalletUri(
          'boldwallet://pay?address=bc1qtest&amount=0.25&label=shop',
        ),
      ).toEqual({kind: 'unknown'});
    });

    it('returns unknown for other boldwallet paths', () => {
      expect(parseBoldwalletUri('boldwallet://other')).toEqual({
        kind: 'unknown',
      });
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

    it('dispatches boldwallet import-keyshare', () => {
      expect(parseIncomingUrl('boldwallet://import-keyshare').kind).toBe(
        'boldwallet-import-keyshare',
      );
    });

    it('does not dispatch https pay links', () => {
      expect(
        parseIncomingUrl(
          'https://www.boldbitcoinwallet.com/pay?address=bc1qxyz',
        ).kind,
      ).toBe('unknown');
    });

    it('does not dispatch boldwallet pay links', () => {
      expect(
        parseIncomingUrl('boldwallet://pay?address=bc1qcustom&amount=0.01')
          .kind,
      ).toBe('unknown');
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

    it('does not extract from https pay link', () => {
      expect(
        extractBitcoinAddressFromPaymentInput(
          'https://boldbitcoinwallet.com/pay?address=bc1qfromweb',
        ),
      ).toBe('https://boldbitcoinwallet.com/pay?address=bc1qfromweb');
    });

    it('returns plain address unchanged', () => {
      expect(extractBitcoinAddressFromPaymentInput('bc1qplain')).toBe(
        'bc1qplain',
      );
    });
  });
});
