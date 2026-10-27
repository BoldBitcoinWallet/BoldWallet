/**
 * Detect + repair GG18 `*big.Int` JSON corruption from JS round-trips.
 *
 * Issues:
 * - `quoted_oversized_ints` — fixable: exact digits survive as JSON strings;
 *   re-emit bare numbers for Go math/big.
 * - `scientific_float` — NOT fixable: IEEE destroyed precision (`e+308` /
 *   Infinity). Requires re-setup.
 * - `envelope` — JS cannot inspect ciphertext; native heal handles it.
 */

import EncryptedStorage from 'react-native-encrypted-storage';
import {BBMTLibNativeModule} from '../native_modules';
import {KEYSHARE_STORAGE_KEY, dbg} from '../utils';
import {emitBareOversizedJsonIntegers} from '../utils/keyshareDevView';

export type Gg18BigIntIssue =
  | 'none'
  | 'quoted_oversized_ints'
  | 'scientific_float'
  | 'envelope'
  | 'not_gg18'
  | 'empty';

const QUOTED_OVERSIZED_RE = /([:[,]\s*)"(-?\d{17,})"(?=\s*[,}\]\]])/;
const SCIENTIFIC_FLOAT_RE = /\d+\.\d+[eE][+-]?\d+/;

function looksLikeEnvelope(raw: string): boolean {
  if (!raw.startsWith('v1:')) {
    return false;
  }
  return raw.split(':').length === 3;
}

/** Pure detect — no mutation. Safe on any string (including envelopes). */
export function detectGg18BigIntJsonIssue(
  raw: string | null | undefined,
): Gg18BigIntIssue {
  if (raw == null || String(raw).trim() === '') {
    return 'empty';
  }
  const s = String(raw);
  if (looksLikeEnvelope(s)) {
    return 'envelope';
  }
  if (!s.includes('ecdsa_local_data')) {
    return 'not_gg18';
  }
  // Unrecoverable first: digits already lost.
  if (SCIENTIFIC_FLOAT_RE.test(s) || s.includes('Infinity')) {
    return 'scientific_float';
  }
  if (QUOTED_OVERSIZED_RE.test(s)) {
    return 'quoted_oversized_ints';
  }
  return 'none';
}

export function isGg18BigIntIssueFixable(issue: Gg18BigIntIssue): boolean {
  return issue === 'quoted_oversized_ints';
}

/**
 * Detect + repair a plaintext GG18 keyshare JSON string.
 * Never touches envelopes (returns issue:'envelope', unchanged).
 */
export function repairGg18QuotedBigIntsInJson(raw: string): {
  issue: Gg18BigIntIssue;
  repaired: string;
  changed: boolean;
  fixable: boolean;
} {
  const issue = detectGg18BigIntJsonIssue(raw);
  if (issue !== 'quoted_oversized_ints') {
    return {
      issue,
      repaired: raw,
      changed: false,
      fixable: isGg18BigIntIssueFixable(issue),
    };
  }
  const repaired = emitBareOversizedJsonIntegers(raw);
  const changed = repaired !== raw;
  const after = detectGg18BigIntJsonIssue(repaired);
  return {
    issue: changed ? issue : after,
    repaired,
    changed,
    fixable: true,
  };
}

/**
 * Plaintext RNES heal (run before envelope migration when possible).
 * Returns detection/repair summary for logging.
 */
export async function repairGg18QuotedBigIntsInStorage(): Promise<{
  issue: Gg18BigIntIssue;
  repaired: boolean;
}> {
  try {
    const raw = await EncryptedStorage.getItem(KEYSHARE_STORAGE_KEY);
    const issue = detectGg18BigIntJsonIssue(raw);
    if (issue === 'empty' || issue === 'not_gg18' || issue === 'none') {
      return {issue, repaired: false};
    }
    if (issue === 'envelope') {
      dbg('gg18BigIntRepair: enveloped, defer to native');
      return {issue, repaired: false};
    }
    if (issue === 'scientific_float') {
      dbg('gg18BigIntRepair: issue=scientific_float action=unrecoverable');
      return {issue, repaired: false};
    }
    const {repaired, changed} = repairGg18QuotedBigIntsInJson(raw as string);
    if (!changed) {
      return {issue: 'none', repaired: false};
    }
    await EncryptedStorage.setItem(KEYSHARE_STORAGE_KEY, repaired);
    dbg('gg18BigIntRepair: issue=quoted_oversized_ints action=persist_ok');
    return {issue: 'quoted_oversized_ints', repaired: true};
  } catch (e) {
    dbg('gg18BigIntRepair: plaintext repair skipped', e);
    return {issue: 'empty', repaired: false};
  }
}

/**
 * Native detect+heal for enveloped (or plaintext) keyshares.
 * Resolves `{detected, repaired, issue}` — never returns share bytes.
 */
export async function repairGg18QuotedBigIntsViaNative(): Promise<{
  detected: boolean;
  repaired: boolean;
  issue: string;
}> {
  const fn = BBMTLibNativeModule?.repairGg18KeyshareBigInts;
  if (typeof fn !== 'function') {
    return {detected: false, repaired: false, issue: 'unsupported'};
  }
  try {
    const out = await fn();
    const issue = String(out?.issue ?? 'none');
    const detected = out?.detected === true;
    const repaired = out?.repaired === true;
    // Native already logs the heal path; JS only records the bridge summary.
    if (detected || repaired) {
      dbg('gg18BigIntRepair: native', {issue, detected, repaired});
    }
    return {detected, repaired, issue};
  } catch (e) {
    dbg('gg18BigIntRepair: native skipped', e);
    return {detected: false, repaired: false, issue: 'error'};
  }
}
