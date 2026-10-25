jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    // Injective stand-in: distinct preimages stay distinct.
    sha256: jest.fn(async (s: string) => `sha256(${s})`),
  },
}));

jest.mock('../services/secureRandom', () => {
  let counter = 0;
  return {
    // Deterministic distinct outputs: proves each mint consumes fresh
    // randomness per call (call-count asserted below). CSPRNG quality
    // itself is the native layer's tested domain, not the mint's.
    secureRandomHex: jest.fn(async (length: number) => {
      counter += 1;
      return counter.toString(16).padStart(length, '0').slice(-length);
    }),
  };
});

// ceremonyAuth -> utils (op-sqlite); stub the logger like sibling suites.
jest.mock('../utils', () => ({dbg: jest.fn()}));

import {BBMTLibNativeModule} from '../native_modules';
import {newCeremonySessionID} from '../services/ceremonyAuth';
import {
  MPC_ATTEMPT_ID_HEX64,
  generateMpcAttemptId,
} from '../services/mpcAttemptId';
import {secureRandomHex} from '../services/secureRandom';

// F13: retry-after-restart must mint provably fresh session parameters —
// this is the "fresh session IDs after process death" property. Every mint
// below draws per-call randomness (Date.now/Math.random or CSPRNG), so a
// post-restart retry cannot reuse a pre-kill session string.

describe('F13 session freshness', () => {
  test('newCeremonySessionID mints distinct IDs per call', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) {
      ids.add(await newCeremonySessionID('f13'));
    }
    expect(ids.size).toBe(30);
    expect(BBMTLibNativeModule.sha256).toHaveBeenCalledTimes(30);
  });

  test('generateMpcAttemptId draws fresh randomness per call', async () => {
    const mocked = secureRandomHex as jest.Mock;
    mocked.mockClear();
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const id = await generateMpcAttemptId();
      expect(id).toMatch(MPC_ATTEMPT_ID_HEX64);
      ids.add(id);
    }
    expect(ids.size).toBe(30);
    expect(mocked).toHaveBeenCalledTimes(30);
    expect(mocked).toHaveBeenCalledWith(64);
  });
});
