/**
 * @format
 */

import {
  generateMpcAttemptId,
  isValidMpcAttemptId,
} from '../services/mpcAttemptId';
import {
  isValidLanPsbtSessionPayload,
  isValidLanSendBtcSessionPayload,
  lanPsbtSessionPayloadMatchesAttempt,
  lanSendBtcSessionPayloadMatchesAttempt,
  parseLanPsbtSessionPayload,
  parseLanSendBtcSessionPayload,
} from '../services/lanSession';

describe('mpcAttemptId', () => {
  it('generateMpcAttemptId returns 64 hex chars', () => {
    const id = generateMpcAttemptId();
    expect(isValidMpcAttemptId(id)).toBe(true);
  });
});

describe('lanSession attempt_id', () => {
  const attemptA = 'a'.repeat(64);
  const attemptB = 'b'.repeat(64);
  const seed = 'c'.repeat(64);
  const hash = 'd'.repeat(64);

  it('send payload includes attempt id', () => {
    const payload = `${attemptA}:${seed}:50000:1200:npub1abc`;
    expect(isValidLanSendBtcSessionPayload(payload)).toBe(true);
    expect(parseLanSendBtcSessionPayload(payload)).toEqual({
      attemptId: attemptA,
      satoshiAmount: '50000',
      satoshiFees: '1200',
      peerShare: 'npub1abc',
    });
    expect(
      lanSendBtcSessionPayloadMatchesAttempt(payload, attemptA, '50000', '1200'),
    ).toBe(true);
    expect(
      lanSendBtcSessionPayloadMatchesAttempt(payload, attemptB, '50000', '1200'),
    ).toBe(false);
  });

  it('psbt payload includes attempt id', () => {
    const payload = `${attemptA}:${seed}:${hash}:npub1abc`;
    expect(isValidLanPsbtSessionPayload(payload)).toBe(true);
    expect(parseLanPsbtSessionPayload(payload)).toEqual({
      attemptId: attemptA,
      psbtHash: hash,
      peerShare: 'npub1abc',
    });
    expect(
      lanPsbtSessionPayloadMatchesAttempt(payload, attemptA, hash),
    ).toBe(true);
    expect(
      lanPsbtSessionPayloadMatchesAttempt(payload, attemptB, hash),
    ).toBe(false);
  });

  it('rejects legacy payloads without attempt id', () => {
    expect(isValidLanSendBtcSessionPayload(`${seed}:50000:1200:npub1`)).toBe(
      false,
    );
    expect(isValidLanPsbtSessionPayload(`${seed}:${hash}:npub1`)).toBe(false);
  });
});
