/**
 * diceEntropy — local dice-only master chaincode.
 * Opt-in: finalChaincode = SHA256('BOLD-DICE-CHAINCODE-v1' || canonicalAllAscii).
 * canonicalAllAscii = `BOLD-DICE-v1|` + sorted(perSetCommitHex).join(`|`).
 * perSetCommitHex = SHA256Hex('BOLD-DICE-COMMIT-v1||<sides>:<r1>,<r2>,...').
 * Rolls and the master chaincode stay on this phone. They are not sent
 * over LAN or Nostr. Dice mode may send dice_<6 hex>, a prefix of the
 * local commitment, so every phone can stop if the sequence differs.
 * Skip path: no local sets → caller keeps the base chaincode.
 */
import {NativeModules} from 'react-native';

export const DICE_SPEC_PREFIX = 'BOLD-DICE-v1|';
export const DICE_COMMIT_DOMAIN = 'BOLD-DICE-COMMIT-v1';
export const DICE_CHAINCODE_DOMAIN = 'BOLD-DICE-CHAINCODE-v1';
export const MIN_DICE_BITS = 256;

// Exact counts to reach 256 bits: D6 log2(6)=2.585/roll -> 100 rolls ~258.5b.
// D20 log2(20)=4.322/roll -> 60 rolls ~259.3b. Coin 1b/roll -> 256 rolls.
export const REQUIRED_ROLLS = {d6: 100, d20: 60, coin: 256} as const;

/** Min Shannon bits/roll and distinct faces once length floor is met. Floor only — not a proof of 256 bits of entropy. */
export const ENTROPY_FLOOR = {
  coin: {minDistinct: 2, minBitsPerRoll: 0.9},
  d6: {minDistinct: 4, minBitsPerRoll: 1.5},
  d20: {minDistinct: 8, minBitsPerRoll: 2.5},
} as const;

export type DiceKind = 'd6' | 'd20' | 'coin';

export interface DiceSet {
  kind: DiceKind;
  sides: number;
  rolls: number[];
}

function sha256HexAsciiSyncFallback(input: string): string {
  // Minimal sync SHA256 (ASCII only) for commitment/canonical hashing when
  // the native bridge is unavailable (tests). Canonical strings are ASCII
  // by construction. Production must use the native module; see sha256HexAscii.
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

/** Native when present; JS fallback only if the native sha256 export is missing (Jest). */
async function sha256HexAscii(s: string): Promise<string> {
  const m: any = (NativeModules as any)?.BBMTLibNativeModule;
  const fn = m?.sha256 || m?.sha256Hex;
  if (typeof fn === 'function') {
    const out = await fn(s);
    if (typeof out === 'string' && /^[0-9a-f]{64}$/i.test(out.trim())) {
      return out.trim().toLowerCase();
    }
    throw new Error('dice: native sha256 returned invalid digest');
  }
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

export function requiredRollsForSides(sides: number): number {
  if (sides === 6) return REQUIRED_ROLLS.d6;
  if (sides === 20) return REQUIRED_ROLLS.d20;
  if (sides === 2) return REQUIRED_ROLLS.coin;
  return Math.ceil(MIN_DICE_BITS / Math.log2(sides));
}

function entropyFloorForSides(sides: number): {minDistinct: number; minBitsPerRoll: number} {
  if (sides <= 2) return ENTROPY_FLOOR.coin;
  if (sides <= 6) return ENTROPY_FLOOR.d6;
  return ENTROPY_FLOOR.d20;
}

/** Shannon entropy in bits per roll. */
export function shannonBitsPerRoll(rolls: number[]): number {
  if (!rolls.length) return 0;
  const freq = new Map<number, number>();
  for (const r of rolls) freq.set(r, (freq.get(r) || 0) + 1);
  const n = rolls.length;
  let h = 0;
  for (const c of freq.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
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
  // Positive entropy floor (not a proof of 256 bits): once length meets the
  // sides floor, require enough distinct faces and min Shannon bits/roll.
  const need = requiredRollsForSides(sides);
  if (rolls.length >= need) {
    const floor = entropyFloorForSides(sides);
    const distinct = new Set(rolls).size;
    if (distinct < floor.minDistinct) {
      return {
        ok: false,
        reason: `Low entropy: only ${distinct} distinct faces (need ≥${floor.minDistinct}). Re-roll with real dice.`,
      };
    }
    const h = shannonBitsPerRoll(rolls);
    if (h < floor.minBitsPerRoll) {
      return {
        ok: false,
        reason: 'Low entropy: rolls are too predictable. Re-roll with real dice.',
      };
    }
  }
  return {ok: true};
}

function assertMinDiceBits(sets: DiceSet[]): void {
  const bits = bitsForSets(sets);
  if (bits < MIN_DICE_BITS) {
    throw new Error(
      `dice: need at least 256 bits of entropy (got ${Math.floor(bits)})`,
    );
  }
}

/**
 * Derive the master chaincode from rolls entered on this phone.
 * Does not look at peers and does not send anything.
 * Enforces MIN_DICE_BITS (256) in the library, not only in the UI.
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
  assertMinDiceBits(localSets);
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
  if (!localSets.length) {
    throw new Error('dice: no rolls');
  }
  for (const s of localSets) {
    const v = validateDiceSet(s.sides, s.rolls);
    if (!v.ok) throw new Error(v.reason || 'dice: invalid rolls');
  }
  assertMinDiceBits(localSets);
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

/** Build commitment bundle (64-hex only) for local verify / display. */
export async function buildDiceCommitBundle(sets: DiceSet[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of sets) out.push(await diceCommitmentHex(s.sides, s.rolls));
  return out;
}

/** Parse a stray legacy `:dice1=` field (64-hex commits). Not used for setup. */
export function parseLanDiceCommits(handshake: string): string[] {
  const m = /:dice1=([0-9a-fA-F,\s]+)/.exec(handshake);
  if (!m) return [];
  return m[1]
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => /^[0-9a-f]{64}$/.test(s));
}

export function stripLanDiceField(handshake: string): string {
  return handshake
    .replace(/:dice1=[0-9a-fA-F,\s]+/g, '')
    .replace(/:dice_[0-9a-f]{6}/gi, '');
}

/**
 * Public dice check. First 6 hex of this phone's commitment.
 * Not the master chaincode (that hash uses a different domain).
 * Wire form: `dice_` + 6 hex. Rolls and the chaincode stay local.
 */
export async function diceChecksumTag(sets: DiceSet[]): Promise<string> {
  if (!sets || sets.length === 0) {
    return '';
  }
  const commits: string[] = [];
  for (const s of sets) {
    commits.push(await diceCommitmentHex(s.sides, s.rolls));
  }
  const basis =
    commits.length === 1
      ? commits[0]
      : await sha256HexAscii(`BOLD-DICE-CHECK-v1||${commits.join('|')}`);
  return `dice_${basis.slice(0, 6)}`;
}

const DICE_TAG_RE = /(?:^|[:|&])(dice_[0-9a-f]{6})(?=$|[:|&])/gi;

/** Short `dice_` tags only. Ignores the 64-hex session seed. */
export function parseDiceChecksumTags(payload: string): string[] {
  if (!payload) {
    return [];
  }
  const out: string[] = [];
  const re = new RegExp(DICE_TAG_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(payload)) !== null) {
    const tag = m[1].toLowerCase();
    if (!out.includes(tag)) {
      out.push(tag);
    }
  }
  return out;
}

/** One tag per peer from PublishData's raw query (`data=…&pubkey=…`). */
export function diceTagsFromLanPublishResult(
  published: string,
  expectedPeers: number,
): string[] {
  const queries = String(published || '')
    .split('|')
    .filter(q => q.trim() !== '');
  const tags = queries.map(q => {
    const part = q.split('&').find(p => p.startsWith('data=')) || '';
    let data = part.slice('data='.length);
    try {
      data = decodeURIComponent(data);
    } catch {
      // keep raw
    }
    return parseDiceChecksumTags(data)[0] || '';
  });
  while (tags.length < expectedPeers) {
    tags.push('');
  }
  return tags.slice(0, expectedPeers);
}

export function diceChecksumMismatchMessage(): string {
  return 'Dice rolls do not match. Every phone must enter the same sequence with dice on, then try again. Setup stopped.';
}

/**
 * localTag is '' when dice is off. peerTags has one slot per other phone
 * ('' when that phone sent no tag). All slots must equal localTag.
 */
export function assertMatchingDiceChecksums(
  localTag: string,
  peerTags: string[],
): void {
  const local = (localTag || '').trim().toLowerCase();
  const peers = peerTags.map(t => (t || '').trim().toLowerCase());
  if (peers.every(t => t === local)) {
    return;
  }
  throw new Error(diceChecksumMismatchMessage());
}

/** Parse a stray legacy `dice1:` fullNonce field. Not used for setup. */
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
