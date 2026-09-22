/**
 * Local dice helpers. Setup does not put rolls or commitments on LAN or Nostr.
 * The encode/parse helpers below remain so a stray legacy field can be
 * recognized; wallet setup must not call the append helpers.
 */
import {
  DiceSet,
  buildDiceCommitBundle,
  compareCommitSets,
  diceMismatchMessage,
  encodeLanDiceField,
  encodeNostrDiceField,
  parseLanDiceCommits,
  parseNostrDiceCommits,
  verifyAndDeriveDiceChaincode,
} from './diceEntropy';
import {commitmentPrefixForDisplay} from './logRedact';

export type DiceMode = 'off' | 'on';

export function resolveDiceMode(localSets: DiceSet[] | null | undefined): DiceMode {
  return localSets && localSets.length > 0 ? 'on' : 'off';
}

/** Append local commitments to an outgoing LAN handshake (backward-compat). */
export function appendLanDiceCommits(
  handshake: string,
  commits: string[],
): string {
  if (!commits.length) return handshake;
  return handshake + encodeLanDiceField(commits);
}

/** Extract peer commitments from an incoming LAN handshake. */
export function extractLanPeerCommits(handshake: string): string[] {
  return parseLanDiceCommits(handshake);
}

/** Append local commitments to an outgoing Nostr fullNonce set. */
export function appendNostrDiceCommits(
  fullNonce: string,
  commits: string[],
): string {
  if (!commits.length) return fullNonce;
  const sep = fullNonce.endsWith('|') || fullNonce.length === 0 ? '' : '|';
  return fullNonce + sep + encodeNostrDiceField(commits);
}

/** Extract peer commitments from a Nostr fullNonce set. */
export function extractNostrPeerCommits(fullNonce: string): string[] {
  return parseNostrDiceCommits(fullNonce);
}

/**
 * Trio collect: gather commitments from all peers before sessionID is fixed.
 * Returns the sorted union of unique commitments.
 */
export function collectTrioCommits(peerCommitLists: string[][]): string[] {
  const set = new Set<string>();
  for (const list of peerCommitLists) {
    for (const c of list) set.add(c.trim().toLowerCase());
  }
  return [...set].sort();
}

/**
 * Verify local dice against the union of peer commitments, then derive the
 * dice-only chaincode locally. Throws with a display-safe message on mismatch.
 * No silent downgrade: caller must abort setup on throw.
 */
export async function verifyPeerCommitsAndDerive(
  localSets: DiceSet[],
  peerCommits: string[],
): Promise<{chaincodeHex: string; canonicalAll: string; localCommits: string[]}> {
  try {
    return await verifyAndDeriveDiceChaincode(localSets, peerCommits);
  } catch {
    const localCommits = await buildDiceCommitBundle(localSets).catch(() => [] as string[]);
    const msg = diceMismatchMessage(localCommits, peerCommits);
    throw new Error(msg);
  }
}

export type DiceCommitBundle = string[];

export function appendDiceCommitsToLanPayload(
  payload: string,
  commits: string[],
): string {
  if (!commits.length) return payload;
  return payload + encodeLanDiceField(commits);
}

export function noncesWithDiceCommits(
  nonces: string[],
  commits: string[],
): string[] {
  if (!commits.length) return nonces;
  return [...nonces, encodeNostrDiceField(commits)];
}

export {verifyAndDeriveDiceChaincode} from './diceEntropy';
export {buildDiceCommitBundle, parseLanDiceCommits, stripLanDiceField} from './diceEntropy';

export function peerCommitPrefixes(commits: string[]): string[] {
  return commits.map(commitmentPrefixForDisplay);
}

/** True when local commitments match peer commitments (sorted-union). */
export async function localMatchesPeers(
  localSets: DiceSet[],
  peerCommits: string[],
): Promise<boolean> {
  const local = await buildDiceCommitBundle(localSets);
  return compareCommitSets(local, peerCommits);
}
