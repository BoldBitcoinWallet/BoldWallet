/**
 * Local dice helpers. Setup must not send rolls, full commitments, or the
 * master chaincode. The live check is dice_<6 hex> from diceEntropy.
 * Parse helpers remain so a stray legacy field can be recognized.
 */
import {
  DiceSet,
  buildDiceCommitBundle,
  compareCommitSets,
  diceMismatchMessage,
  parseLanDiceCommits,
  parseNostrDiceCommits,
  verifyAndDeriveDiceChaincode,
} from './diceEntropy';
import {commitmentPrefixForDisplay} from './logRedact';

export type DiceMode = 'off' | 'on';

export function resolveDiceMode(localSets: DiceSet[] | null | undefined): DiceMode {
  return localSets && localSets.length > 0 ? 'on' : 'off';
}

/** Extract peer commitments from a stray legacy LAN handshake field. */
export function extractLanPeerCommits(handshake: string): string[] {
  return parseLanDiceCommits(handshake);
}

/** Extract peer commitments from a stray legacy Nostr fullNonce field. */
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
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/need at least 256 bits|no rolls|invalid rolls|Biased|Low entropy/i.test(msg)) {
      throw e instanceof Error ? e : new Error(msg);
    }
    const localCommits = await buildDiceCommitBundle(localSets).catch(() => [] as string[]);
    throw new Error(diceMismatchMessage(localCommits, peerCommits));
  }
}

export type DiceCommitBundle = string[];

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
