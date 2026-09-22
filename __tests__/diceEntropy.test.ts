import {NativeModules} from 'react-native';
import {
  canonicalAllForCommits,
  canonicalDiceString,
  deriveDiceChaincodeHex,
  deriveLocalDiceChaincode,
  diceCommitmentHex,
  diceCommitmentHexSync,
  verifyAndDeriveDiceChaincode,
  bitsForSets,
  MIN_DICE_BITS,
  REQUIRED_ROLLS,
  validateDiceSet,
  shannonBitsPerRoll,
} from '../services/diceEntropy';

// Deterministic PRNG fixtures (non-sequential so bias checks pass).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genRolls(n: number, sides: number, seed: number): number[] {
  const rnd = mulberry32(seed);
  return Array.from({length: n}, () => 1 + Math.floor(rnd() * sides));
}

const D6_100 = genRolls(100, 6, 42);
const D20_60 = genRolls(60, 20, 7);
const COIN_256 = genRolls(256, 2, 99);

describe('diceEntropy (Spec v2.1 dice-only)', () => {
  afterEach(() => {
    delete (NativeModules as any).BBMTLibNativeModule;
  });

  test('canonical per-set encoding', () => {
    expect(canonicalDiceString(6, [1, 2, 3])).toBe('6:1,2,3');
  });

  test('256-bit minimums hold', () => {
    expect(bitsForSets([{kind: 'd6', sides: 6, rolls: D6_100}])).toBeGreaterThanOrEqual(MIN_DICE_BITS);
    expect(bitsForSets([{kind: 'd20', sides: 20, rolls: D20_60}])).toBeGreaterThanOrEqual(MIN_DICE_BITS);
    expect(bitsForSets([{kind: 'coin', sides: 2, rolls: COIN_256}])).toBeGreaterThanOrEqual(MIN_DICE_BITS);
    expect(REQUIRED_ROLLS.d6).toBe(100);
    expect(REQUIRED_ROLLS.d20).toBe(60);
    expect(REQUIRED_ROLLS.coin).toBe(256);
  });

  test('commitment deterministic + 64-hex', async () => {
    const a = await diceCommitmentHex(6, [1, 2, 3]);
    const b = diceCommitmentHexSync(6, [1, 2, 3]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('JS sha256 fallback only when native sha256 is missing', async () => {
    const sync = diceCommitmentHexSync(6, [1, 2, 3]);
    delete (NativeModules as any).BBMTLibNativeModule;
    expect(await diceCommitmentHex(6, [1, 2, 3])).toBe(sync);

    (NativeModules as any).BBMTLibNativeModule = {
      sha256: async () => {
        throw new Error('native sha256 failed');
      },
    };
    await expect(diceCommitmentHex(6, [1, 2, 3])).rejects.toThrow(/native sha256 failed/);
  });

  test('local derivation enforces 256-bit floor', async () => {
    const short = [{kind: 'd6' as const, sides: 6, rolls: [1, 2, 3, 5]}];
    await expect(deriveLocalDiceChaincode(short)).rejects.toThrow(
      'dice: need at least 256 bits of entropy (got 10)',
    );
    const sets = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const r = await deriveLocalDiceChaincode(sets);
    expect(r.chaincodeHex).toMatch(/^[0-9a-f]{64}$/);
    expect(r.localCommits).toHaveLength(1);
    const again = await deriveLocalDiceChaincode(sets);
    expect(again.chaincodeHex).toBe(r.chaincodeHex);
  });

  test('shared vector matches node crypto and Go DeriveDiceChaincodeHex', async () => {
    // Below floor: low-level helpers only (not deriveLocalDiceChaincode).
    const commit = diceCommitmentHexSync(6, [1, 2, 3]);
    expect(commit).toBe('1ff5e30664dacfdf237ba1ddf5ce7e2a2ad3673cb7933e5224e31428abf7a331');
    const canonicalAll = canonicalAllForCommits([commit]);
    expect(canonicalAll).toBe(`BOLD-DICE-v1|${commit}`);
    const chain = await deriveDiceChaincodeHex(canonicalAll);
    expect(chain).toBe('e28343733d5fde91a0697e7a4f1e5a6a135abdf8d21f5fb3db7aa0a9c6aa331a');
  });

  test('alternating faces are rejected', () => {
    const alt = Array.from({length: 12}, (_, i) => (i % 2 === 0 ? 1 : 2));
    expect(validateDiceSet(6, alt).ok).toBe(false);
  });

  test('entropy floor rejects two-face D6 at length 100; fair fixture passes', () => {
    const twoFace = Array.from({length: 100}, (_, i) => (i % 3 === 0 ? 1 : 2));
    expect(new Set(twoFace).size).toBe(2);
    expect(shannonBitsPerRoll(twoFace)).toBeLessThan(1.5);
    expect(validateDiceSet(6, twoFace).ok).toBe(false);
    expect(validateDiceSet(6, D6_100).ok).toBe(true);
    expect(validateDiceSet(20, D20_60).ok).toBe(true);
    expect(validateDiceSet(2, COIN_256).ok).toBe(true);
  });

  test('dice-only derivation ignores base (no RNG input)', async () => {
    const sets = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const commits = [diceCommitmentHexSync(6, D6_100)];
    const r = await verifyAndDeriveDiceChaincode(sets, commits);
    const direct = await deriveDiceChaincodeHex(canonicalAllForCommits(commits));
    expect(r.chaincodeHex).toBe(direct);
  });

  test('empty canonical rejected', async () => {
    await expect(deriveDiceChaincodeHex('')).rejects.toThrow();
    await expect(deriveDiceChaincodeHex('garbage')).rejects.toThrow();
  });
});
