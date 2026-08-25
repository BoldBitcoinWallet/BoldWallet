/**
 * Pure helpers for UTXO tags and Send coin-control (exclusive spend pool).
 * Address shortening matches `shortenAddress` in utils.js (first 4 + ... + last 4).
 */

export const UTXO_TAG_MIN_LEN = 2;
export const UTXO_TAG_MAX_LEN = 64;

/** Allowed tag charset: ASCII letters, digits, underscore, hyphen. */
const UTXO_TAG_ALLOWED_RE = /^[A-Za-z0-9_-]+$/;
const UTXO_TAG_STRIP_RE = /[^A-Za-z0-9_-]/g;

function shortenAddr(addr: string): string {
  return typeof addr === 'string' && addr.length > 8
    ? `${addr.slice(0, 4)}...${addr.slice(-4)}`
    : addr || '';
}

export type CoinControlUtxo = {
  txid: string;
  vout: number;
  valueSats: number;
  address: string;
  derivationPath: string;
  tag: string | null;
  isConfirmed: boolean;
};

export function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

export function parseOutpointKey(
  key: string,
): {txid: string; vout: number} | null {
  const i = key.lastIndexOf(':');
  if (i <= 0 || i === key.length - 1) {
    return null;
  }
  const txid = key.slice(0, i).trim();
  const vout = Number(key.slice(i + 1));
  if (!txid || !Number.isInteger(vout) || vout < 0) {
    return null;
  }
  return {txid, vout};
}

/** `abcd~wxyz@0` — first 4 + last 4 of txid, then vout. */
export function formatUtxoCoinId(txid: string, vout: number): string {
  const id = (txid || '').trim();
  const n = Number.isInteger(vout) ? vout : 0;
  if (id.length >= 8) {
    return `${id.slice(0, 4)}~${id.slice(-4)}@${n}`;
  }
  if (id.length > 0) {
    return `${id}@${n}`;
  }
  return `?@${n}`;
}

export function formatUtxoPickerLabel(params: {
  tag?: string | null;
  txid: string;
  vout: number;
  address: string;
}): string {
  const id = formatUtxoCoinId(params.txid, params.vout);
  const addr = shortenAddr(params.address || '') || '—';
  const tag = (params.tag || '').trim();
  if (tag) {
    return `${tag} ${id} / ${addr}`;
  }
  return `${id} / ${addr}`;
}

/** Filter keystrokes / paste to allowed ASCII characters only (max 64). */
export function sanitizeUtxoTagDraft(raw: string | null | undefined): string {
  if (raw == null) {
    return '';
  }
  return String(raw).replace(UTXO_TAG_STRIP_RE, '').slice(0, UTXO_TAG_MAX_LEN);
}

export function isValidUtxoTag(tag: string): boolean {
  const t = sanitizeUtxoTagDraft(tag);
  return t.length >= UTXO_TAG_MIN_LEN && UTXO_TAG_ALLOWED_RE.test(t);
}

/** Empty clears the tag; otherwise must pass validation. */
export function canPersistUtxoTag(tag: string): boolean {
  const t = sanitizeUtxoTagDraft(tag);
  return t.length === 0 || isValidUtxoTag(t);
}

/**
 * Normalize a stored tag. Empty / invalid (incl. legacy rows) → ''.
 */
export function sanitizeUtxoTag(raw: string | null | undefined): string {
  const draft = sanitizeUtxoTagDraft(raw);
  if (!draft) {
    return '';
  }
  return isValidUtxoTag(draft) ? draft : '';
}

/**
 * `selectedSats === null` means the full wallet (no coin-control subset).
 */
export function spendableSats(
  walletSats: number,
  selectedSats: number | null,
): number {
  if (selectedSats == null) {
    return walletSats;
  }
  return selectedSats;
}

export function sumSelectedSats(
  utxos: Array<{txid: string; vout: number; valueSats: number}>,
  selectedKeys: Set<string> | null,
): number | null {
  if (!selectedKeys) {
    return null;
  }
  let sum = 0;
  for (const u of utxos) {
    if (selectedKeys.has(outpointKey(u.txid, u.vout))) {
      sum += u.valueSats;
    }
  }
  return sum;
}

export function filterUtxosByOutpoints<
  T extends {txid: string; vout: number},
>(utxos: T[], selectedKeys: Set<string> | null): T[] {
  if (!selectedKeys) {
    return utxos;
  }
  return utxos.filter(u => selectedKeys.has(outpointKey(u.txid, u.vout)));
}

export function selectionFeeKey(selectedKeys: Set<string> | null): string {
  if (!selectedKeys) {
    return '*';
  }
  return [...selectedKeys].sort().join(',');
}

/**
 * Autocomplete from existing tags while typing: prefix matches first, then
 * substring matches. Empty draft → no suggestions (avoids noisy empty-focus lists).
 * Excludes an exact (case-insensitive) current draft.
 */
export function filterTagSuggestions(
  draft: string,
  existingTags: string[],
  limit = 5,
): string[] {
  const q = sanitizeUtxoTagDraft(draft).toLowerCase();
  if (!q) {
    return [];
  }
  const exact = new Set<string>();
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const raw of existingTags) {
    const tag = sanitizeUtxoTag(raw);
    if (!tag) {
      continue;
    }
    const lower = tag.toLowerCase();
    if (exact.has(lower)) {
      continue;
    }
    exact.add(lower);
    if (lower === q) {
      continue;
    }
    if (lower.startsWith(q)) {
      prefix.push(tag);
    } else if (lower.includes(q)) {
      contains.push(tag);
    }
  }
  return [...prefix, ...contains].slice(0, limit);
}

/** Send coin-control dropdown: tagged UTXOs first (tag A→Z), then untagged; ties by value desc. */
export function sortCoinControlUtxos(
  utxos: CoinControlUtxo[],
): CoinControlUtxo[] {
  return [...utxos].sort((a, b) => {
    const tagA = (a.tag || '').trim();
    const tagB = (b.tag || '').trim();
    const hasA = tagA.length > 0;
    const hasB = tagB.length > 0;
    if (hasA !== hasB) {
      return hasA ? -1 : 1;
    }
    if (hasA && hasB) {
      const byTag = tagA.localeCompare(tagB, undefined, {sensitivity: 'base'});
      if (byTag !== 0) {
        return byTag;
      }
    }
    if (a.valueSats !== b.valueSats) {
      return b.valueSats - a.valueSats;
    }
    if (a.txid !== b.txid) {
      return a.txid.localeCompare(b.txid);
    }
    return a.vout - b.vout;
  });
}
