/**
 * @format
 */

import {
  isValidLanPsbtSessionPayload,
  isValidLanSendBtcSessionPayload,
  lanPsbtSessionPayloadMatchesAttempt,
  lanPsbtSessionPayloadMatchesHash,
  lanSendBtcSessionPayloadMatches,
  lanSendBtcSessionPayloadMatchesAttempt,
  parseLanPsbtSessionPayload,
  parseLanSendBtcSessionPayload,
} from '../services/lanSession';

describe('lanSession', () => {
  const attempt = 'e'.repeat(64);
  const seed = 'a'.repeat(64);

  describe('PSBT', () => {
    it('rejects discovery-style payloads', () => {
      expect(
        isValidLanPsbtSessionPayload('192.168.0.1@id@pub,192.168.0.2@id@pub'),
      ).toBe(false);
    });

    it('lanPsbtSessionPayloadMatchesHash requires matching hash', () => {
      const hash = 'b'.repeat(64);
      const payload = `${attempt}:${seed}:${hash}:npub1abc`;
      expect(lanPsbtSessionPayloadMatchesHash(payload, hash)).toBe(true);
      expect(lanPsbtSessionPayloadMatchesHash(payload, 'c'.repeat(64))).toBe(
        false,
      );
    });

    it('lanPsbtSessionPayloadMatchesAttempt requires exact attempt id', () => {
      const hash = 'b'.repeat(64);
      const attemptA = 'a'.repeat(64);
      const attemptB = 'c'.repeat(64);
      const payload = `${attemptA}:${seed}:${hash}:npub1abc`;
      expect(
        lanPsbtSessionPayloadMatchesAttempt(payload, attemptA, hash),
      ).toBe(true);
      expect(
        lanPsbtSessionPayloadMatchesAttempt(payload, attemptB, hash),
      ).toBe(false);
    });

    it('parseLanPsbtSessionPayload supports party keys with colons', () => {
      const hash = 'b'.repeat(64);
      const party = 'npub:extra:segment';
      expect(
        parseLanPsbtSessionPayload(`${attempt}:${seed}:${hash}:${party}`),
      ).toEqual({
        attemptId: attempt,
        psbtHash: hash,
        peerShare: party,
      });
    });
  });

  describe('send BTC', () => {
    it('isValidLanSendBtcSessionPayload rejects PSBT-shaped payloads', () => {
      const psbtHash = 'b'.repeat(64);
      expect(
        isValidLanSendBtcSessionPayload(`${attempt}:${seed}:${psbtHash}:npub1`),
      ).toBe(false);
    });

    it('lanSendBtcSessionPayloadMatches requires amount and fees', () => {
      const payload = `${attempt}:${seed}:50000:1200:npub1abc`;
      expect(lanSendBtcSessionPayloadMatches(payload, '50000', '1200')).toBe(
        true,
      );
      expect(lanSendBtcSessionPayloadMatches(payload, '50001', '1200')).toBe(
        false,
      );
      expect(lanSendBtcSessionPayloadMatches(payload, '50000', '1201')).toBe(
        false,
      );
      expect(lanSendBtcSessionPayloadMatches(seed, '50000', '1200')).toBe(
        false,
      );
    });

    it('lanSendBtcSessionPayloadMatchesAttempt requires exact attempt id', () => {
      const attemptA = 'a'.repeat(64);
      const attemptB = 'c'.repeat(64);
      const payload = `${attemptA}:${seed}:50000:1200:npub1abc`;
      expect(
        lanSendBtcSessionPayloadMatchesAttempt(payload, attemptA, '50000', '1200'),
      ).toBe(true);
      expect(
        lanSendBtcSessionPayloadMatchesAttempt(payload, attemptB, '50000', '1200'),
      ).toBe(false);
    });

    it('parseLanSendBtcSessionPayload supports party keys with colons', () => {
      const party = 'party:key:segment';
      expect(
        parseLanSendBtcSessionPayload(`${attempt}:${seed}:1000:500:${party}`),
      ).toEqual({
        attemptId: attempt,
        satoshiAmount: '1000',
        satoshiFees: '500',
        peerShare: party,
      });
    });
  });
});
