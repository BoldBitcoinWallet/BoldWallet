/**
 * diceEntropy — local dice-only master chaincode.
 * Opt-in: finalChaincode = SHA256('BOLD-DICE-CHAINCODE-v1' || canonicalAllAscii).
 * canonicalAllAscii = `BOLD-DICE-v1|` + sorted(perSetCommitHex).join(`|`).
 * perSetCommitHex = SHA256Hex('BOLD-DICE-COMMIT-v1||<sides>:<r1>,<r2>,...').
 * Rolls, commitments, and the chaincode stay on this phone. They are not
 * sent over LAN or Nostr. Skip path: no local sets → caller keeps the base
 * chaincode (byte-identical to today).
 */
import {NativeModules} from 'react-native';

export const DICE_SPEC_PREFIX = 'BOLD-DICE-v1|';
export const DICE_COMMIT_DOMAIN = 'BOLD-DICE-COMMIT-v1';
export const DICE_CHAINCODE_DOMAIN = 'BOLD-DICE-CHAINCODE-v1';
export const MIN_DICE_BITS = 256;

// Exact counts to reach 256 bits: D6 log2(6)=2.585/roll -> 100 rolls ~258.5b.
// D20 log2(20)=4.322/roll -> 60 rolls ~259.3b. Coin 1b/roll -> 256 rolls.
export const REQUIRED_ROLLS = {d6: 100, d20: 60, coin: 256} as const;

export type DiceKind = 'd6' | 'd20' | 'coin';

export interface DiceSet {
  kind: DiceKind;
  sides: number;
  rolls: number[];
}

function sha256HexAsciiSyncFallback(input: string): string {
  // Minimal sync SHA256 (ASCII only) for commitment/canonical hashing when
  // the native bridge is unavailable (tests, fallback). Canonical strings
  // are ASCII by construction.
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) bytes.push(input.charCodeAt(i) & 0xff);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit length: high 32 zero (ASCII inputs are short), low 32 bitLen.
  bytes.push(0, 0, 0, 0);
  bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    const w = new Array(64).fill(0);
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[off + i * 4] << 24) |
          (bytes[off + i * 4 + 1] << 16) |
          ((bytes[off + i * 4 + 2] << 8) |
            bytes[off + i * 4 + 3])) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const hex = (x: number) => ('00000000' + (x >>> 0).toString(16)).slice(-8);
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

async function sha256HexAscii(s: string): Promise<string> {
  try {
    const m: any = (NativeModules as any)?.BBMTLibNativeModule;
    const fn = m?.sha256 || m?.sha256Hex;
    if (typeof fn === 'function') {
      const out = await fn(s);
      if (typeof out === 'string' && /^[0-9a-f]{64}$/i.test(out.trim())) {
        return out.trim().toLowerCase();
      }
    }
  } catch {}
  return sha256HexAsciiSyncFallback(s);
}

export function sha256HexAsciiSync(s: string): string {
  return sha256HexAsciiSyncFallback(s);
}

export function sidesForKind(kind: DiceKind): number {
  return kind === 'd6' ? 6 : kind === 'd20' ? 20 : 2;
}

export function bitsForRolls(count: number, sides: number): number {
  return count * Math.log2(sides);
}

export function bitsForSets(sets: DiceSet[]): number {
  return sets.reduce((acc, s) => acc + bitsForRolls(s.rolls.length, s.sides), 0);
}

/** Canonical per-set string: `<sides>:<r1>,<r2>,...` (order preserved). */
export function canonicalDiceString(sides: number, rolls: number[]): string {
  return `${sides}:${rolls.join(',')}`;
}

/** Full canonical-all for local derivation: prefix + sorted commits. */
export function canonicalAllForCommits(perSetCommits: string[]): string {
  const cp = perSetCommits.map(c => c.trim().toLowerCase()).sort();
  return DICE_SPEC_PREFIX + cp.join('|');
}

export async function diceCommitmentHex(sides: number, rolls: number[]): Promise<string> {
  return sha256HexAscii(`${DICE_COMMIT_DOMAIN}||${canonicalDiceString(sides, rolls)}`);
}

export function diceCommitmentHexSync(sides: number, rolls: number[]): string {
  return sha256HexAsciiSyncFallback(`${DICE_COMMIT_DOMAIN}||${canonicalDiceString(sides, rolls)}`);
}

export async function deriveDiceChaincodeHex(canonicalAll: string): Promise<string> {
  const t = canonicalAll.trim();
  if (!t.startsWith(DICE_SPEC_PREFIX) || t.length <= DICE_SPEC_PREFIX.length) {
    throw new Error('dice: bad canonical prefix');
  }
  return sha256HexAscii(`${DICE_CHAINCODE_DOMAIN}||${t}`);
}

export function deriveDiceChaincodeHexSync(canonicalAll: string): string {
  const t = canonicalAll.trim();
  if (!t.startsWith(DICE_SPEC_PREFIX) || t.length <= DICE_SPEC_PREFIX.length) {
    throw new Error('dice: bad canonical prefix');
  }
  return sha256HexAsciiSyncFallback(`${DICE_CHAINCODE_DOMAIN}||${t}`);
}

/** Sorted compare of commitment lists. Roll order is already inside each commit. */
export function compareCommitSets(a: string[], b: string[]): boolean {
  const na = a.map(s => s.trim().toLowerCase()).sort();
  const nb = b.map(s => s.trim().toLowerCase()).sort();
  if (na.length !== nb.length) return false;
  return na.every((v, i) => v === nb[i]);
}

export function validateDiceSet(sides: number, rolls: number[]): {ok: boolean; reason?: string} {
  if (!rolls.length) return {ok: false, reason: 'No rolls entered.'};
  if (rolls.some(r => !Number.isInteger(r) || r < 1 || r > sides)) {
    return {ok: false, reason: `Rolls must be 1–${sides}.`};
  }
  // Biased-input rejection: all-same, strict 1..N repeat, alternating two-face.
  const allSame = rolls.every(r => r === rolls[0]);
  if (allSame && rolls.length >= 6) return {ok: false, reason: 'Biased input: all rolls identical. Re-roll with real dice.'};
  if (rolls.length >= 12) {
    let seq = true;
    for (let i = 0; i < rolls.length; i++) {
      if (rolls[i] !== (i % sides) + 1) { seq = false; break; }
    }
    if (seq) return {ok: false, reason: 'Biased input: sequential pattern. Re-roll with real dice.'};
    const a = rolls[0];
    const b = rolls[1];
    if (a !== b) {
      let alt = true;
      for (let i = 0; i < rolls.length; i++) {
        if (rolls[i] !== (i % 2 === 0 ? a : b)) { alt = false; break; }
      }
      if (alt) return {ok: false, reason: 'Biased input: alternating pattern. Re-roll with real dice.'};
    }
  }
  return {ok: true};
}

/**
 * Derive the master chaincode from rolls entered on this phone.
 * Does not look at peers and does not send anything.
 */
export async function deriveLocalDiceChaincode(
  localSets: DiceSet[],
): Promise<{chaincodeHex: string; canonicalAll: string; localCommits: string[]}> {
  if (!localSets.length) {
    throw new Error('dice: no rolls');
  }
  for (const s of localSets) {
    const v = validateDiceSet(s.sides, s.rolls);
    if (!v.ok) throw new Error(v.reason || 'dice: invalid rolls');
  }
  const localCommits: string[] = [];
  for (const s of localSets) {
    localCommits.push(await diceCommitmentHex(s.sides, s.rolls));
  }
  const canonicalAll = canonicalAllForCommits(localCommits);
  const chaincodeHex = await deriveDiceChaincodeHex(canonicalAll);
  return {chaincodeHex, canonicalAll, localCommits};
}

/** Verify local sets against peer commitments (sorted-union), then derive. */
export async function verifyAndDeriveDiceChaincode(
  localSets: DiceSet[],
  peerCommits: string[],
): Promise<{chaincodeHex: string; canonicalAll: string; localCommits: string[]}> {
  for (const s of localSets) {
    const v = validateDiceSet(s.sides, s.rolls);
    if (!v.ok) throw new Error(v.reason || 'dice: invalid rolls');
  }
  const localCommits: string[] = [];
  for (const s of localSets) {
    localCommits.push(await diceCommitmentHex(s.sides, s.rolls));
  }
  if (!compareCommitSets(localCommits, peerCommits)) {
    throw new Error(
      'dice: commitment mismatch — same dice on every phone, then retry. No silent downgrade.',
    );
  }
  const canonicalAll = canonicalAllForCommits(localCommits);
  const chaincodeHex = await deriveDiceChaincodeHex(canonicalAll);
  return {chaincodeHex, canonicalAll, localCommits};
}

/** Build commitment bundle (64-hex only) for LAN/Nostr transport. */
export async function buildDiceCommitBundle(sets: DiceSet[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of sets) out.push(await diceCommitmentHex(s.sides, s.rolls));
  return out;
}

// ---- LAN / Nostr transport helpers (commitments only, never canonical) ----

export function encodeLanDiceField(commits: string[]): string {
  return `:dice1=${commits.map(c => c.trim().toLowerCase()).join(',')}`;
}

export function parseLanDiceCommits(handshake: string): string[] {
  const m = /:dice1=([0-9a-fA-F,\s]+)/.exec(handshake);
  if (!m) return [];
  return m[1]
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => /^[0-9a-f]{64}$/.test(s));
}

export function stripLanDiceField(handshake: string): string {
  return handshake.replace(/:dice1=[0-9a-fA-F,\s]+/, '');
}

export function encodeNostrDiceField(commits: string[]): string {
  return `dice1:${commits.map(c => c.trim().toLowerCase()).join(',')}`;
}

export function parseNostrDiceCommits(fullNonce: string): string[] {
  const parts = fullNonce.split('|').map(s => s.trim());
  const out: string[] = [];
  for (const p of parts) {
    if (!p.startsWith('dice1:')) continue;
    for (const c of p.slice('dice1:'.length).split(',')) {
      const t = c.trim().toLowerCase();
      if (/^[0-9a-f]{64}$/.test(t)) out.push(t);
    }
  }
  return out;
}

/** Mismatch message with commitment prefixes (safe to display). */
export function diceMismatchMessage(local: string[], peer: string[]): string {
  const px = (arr: string[]) => arr.map(c => c.slice(0, 8)).join(',') || '<none>';
  return (
    `Dice commitments do not match (local ${px(local)} vs peer ${px(peer)}). ` +
    'Enter the SAME dice sequence on every phone, then retry. Setup aborted — no fallback.'
  );
}
