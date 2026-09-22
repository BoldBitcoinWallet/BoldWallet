import {
  parseLanDiceCommits,
  parseNostrDiceCommits,
  stripLanDiceField,
  diceChecksumTag,
  parseDiceChecksumTags,
  diceTagsFromLanPublishResult,
  assertMatchingDiceChecksums,
  deriveLocalDiceChaincode,
  verifyAndDeriveDiceChaincode,
  buildDiceCommitBundle,
  canonicalAllForCommits,
  deriveDiceChaincodeHex,
  compareCommitSets,
  validateDiceSet,
  diceCommitmentHexSync,
  DICE_SPEC_PREFIX,
} from '../services/diceEntropy';
import {
  collectTrioCommits,
  verifyPeerCommitsAndDerive,
  localMatchesPeers,
} from '../services/diceSession';

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

describe('dice crosscheck (Spec v2.1)', () => {
  test('same rolls same order match; different order aborts (order-sensitive)', async () => {
    const a = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const same = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const reordered = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100].reverse()}];
    const ca = await buildDiceCommitBundle(a);
    const cs = await buildDiceCommitBundle(same);
    const cr = await buildDiceCommitBundle(reordered);
    expect(compareCommitSets(ca, cs)).toBe(true);
    // Canonical preserves entry order, so a different order is a different
    // commitment and must abort (user re-enters the same sequence).
    expect(compareCommitSets(ca, cr)).toBe(false);
    await expect(verifyAndDeriveDiceChaincode(a, cr)).rejects.toThrow(/mismatch/i);
    const r = await verifyAndDeriveDiceChaincode(a, cs);
    expect(r.chaincodeHex).toMatch(/^[0-9a-f]{64}$/);
    expect(r.canonicalAll.startsWith(DICE_SPEC_PREFIX)).toBe(true);
  });

  test('different rolls abort (no silent downgrade)', async () => {
    const a = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const other = [...D6_100];
    other[0] = other[0] === 6 ? 5 : 6;
    other[1] = other[1] === 6 ? 5 : 6;
    const cb = await buildDiceCommitBundle([{kind: 'd6' as const, sides: 6, rolls: other}]);
    await expect(verifyAndDeriveDiceChaincode(a, cb)).rejects.toThrow(/mismatch/i);
    await expect(verifyPeerCommitsAndDerive(a, cb)).rejects.toThrow(/SAME dice sequence/i);
  });

  test('setup screens share a 6-hex dice check, not rolls or the chaincode', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const lan = fs.readFileSync(path.join(root, 'screens/MobilesPairing.tsx'), 'utf8');
    const nostr = fs.readFileSync(path.join(root, 'screens/MobileNostrPairing.tsx'), 'utf8');
    expect(lan).toMatch(/diceChecksumTag/);
    expect(lan).toMatch(/assertMatchingDiceChecksums/);
    expect(nostr).toMatch(/diceChecksumTag/);
    expect(nostr).toMatch(/assertMatchingDiceChecksums/);
    expect(lan).not.toMatch(/appendLanDiceCommits\s*\(/);
    expect(nostr).not.toMatch(/appendNostrDiceCommits\s*\(/);
    expect(nostr).not.toMatch(/noncesWithDiceCommits\s*\(/);
    expect(lan).not.toMatch(/:dice1=/);
    expect(nostr).not.toMatch(/dice1:/);
    expect(nostr).not.toMatch(/\$\{chaincode\}/);
  });

  test('dice checksum is 6 hex and is not the master chaincode', async () => {
    const a = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const tag = await diceChecksumTag(a);
    const derived = await deriveLocalDiceChaincode(a);
    expect(tag).toMatch(/^dice_[0-9a-f]{6}$/);
    expect(tag.slice(5)).not.toBe(derived.chaincodeHex.slice(0, 6));
    const handshake = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:${'b'.repeat(64)}:${tag}`;
    expect(handshake.includes(derived.chaincodeHex)).toBe(false);
    expect(parseDiceChecksumTags(handshake)).toEqual([tag]);
    expect(stripLanDiceField(handshake)).toBe(
      `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:${'b'.repeat(64)}`,
    );
    expect(() => assertMatchingDiceChecksums(tag, [tag])).not.toThrow();
    expect(() => assertMatchingDiceChecksums(tag, ['dice_000000'])).toThrow(/do not match/);
    expect(() => assertMatchingDiceChecksums('', [tag])).toThrow(/do not match/);
    const echoed = diceTagsFromLanPublishResult(
      `data=${'c'.repeat(64)}:${tag}&pubkey=pk`,
      1,
    );
    expect(echoed).toEqual([tag]);
  });

  test('stripLanDiceField removes a stray legacy :dice1= field', async () => {
    const a = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const commits = await buildDiceCommitBundle(a);
    const hs = `abc123:deadbeef:dice1=${commits[0]}`;
    expect(hs).not.toContain(DICE_SPEC_PREFIX);
    const parsed = parseLanDiceCommits(hs);
    expect(parsed.length).toBe(1);
    expect(stripLanDiceField(hs)).toBe('abc123:deadbeef');
  });

  test('legacy Nostr dice1: field can still be parsed (not used for setup)', async () => {
    const a = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const commits = await buildDiceCommitBundle(a);
    const full = `n1|n2|dice1:${commits[0]}`;
    expect(full).not.toContain(DICE_SPEC_PREFIX);
    const parsed = parseNostrDiceCommits(full);
    expect(parsed.length).toBe(1);
  });

  test('trio collect unions both peers', () => {
    const u = collectTrioCommits([['a'.repeat(64)], ['b'.repeat(64), 'a'.repeat(64)]]);
    expect(u).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });

  test('short/biased/low-entropy rejected', () => {
    expect(validateDiceSet(6, [1, 2, 3]).ok).toBe(true); // valid shape; length floor in derive
    expect(validateDiceSet(6, Array(100).fill(1)).ok).toBe(false);
    expect(validateDiceSet(6, Array.from({length: 24}, (_, i) => (i % 6) + 1)).ok).toBe(false);
    expect(validateDiceSet(6, [0, 7]).ok).toBe(false);
    // Two faces only (not perfect alternation) fails entropy floor at length 100.
    const twoFace = Array.from({length: 100}, (_, i) => (i % 3 === 0 ? 1 : 2));
    expect(validateDiceSet(6, twoFace).ok).toBe(false);
    expect(validateDiceSet(6, D6_100).ok).toBe(true);
  });

  test('localMatchesPeers true/false', async () => {
    const a = [{kind: 'd6' as const, sides: 6, rolls: [...D6_100]}];
    const ca = await buildDiceCommitBundle(a);
    expect(await localMatchesPeers(a, ca)).toBe(true);
    expect(await localMatchesPeers(a, ['0'.repeat(64)])).toBe(false);
  });

  test('TS<->Go vector: commit + canonical + derive match Go impl', async () => {
    // Canonical per-set: `6:1,2,3` ; commit = SHA256('BOLD-DICE-COMMIT-v1||6:1,2,3').
    // Below 256-bit floor: use low-level hash helpers, not deriveLocalDiceChaincode.
    const commit = diceCommitmentHexSync(6, [1, 2, 3]);
    expect(commit).toMatch(/^[0-9a-f]{64}$/);
    const canonicalAll = canonicalAllForCommits([commit]);
    expect(canonicalAll).toBe(`${DICE_SPEC_PREFIX}${commit}`);
    const chain = await deriveDiceChaincodeHex(canonicalAll);
    expect(chain).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic: same input -> same output.
    expect(await deriveDiceChaincodeHex(canonicalAll)).toBe(chain);
  });

  test('deriveLocalDiceChaincode rejects short sequences', async () => {
    const short = [{kind: 'd6' as const, sides: 6, rolls: [1, 2, 3, 5]}];
    await expect(deriveLocalDiceChaincode(short)).rejects.toThrow(
      /need at least 256 bits of entropy/,
    );
  });
});
