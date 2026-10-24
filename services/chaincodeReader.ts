/**
 * chaincodeReader — F15b-1 (C5/C6) read migration.
 * Chaincode comes from native-projected secure metadata ONLY
 * (getKeyshareSecureMetadata: decrypted + projected in native code,
 * §3 superset INCLUDING chain_code_hex). The raw RNES blob is never
 * read into JS. SQLite/DB metadata chain_code_hex stays blanked ('')
 * and must never be used.
 */
import {getKeyshareMetadata, getKeyshareSecureMetadata} from '../utils';

async function readSecureKeyshareFields(): Promise<any> {
  try {
    return await getKeyshareSecureMetadata();
  } catch {
    return null;
  }
}

export async function resolveChaincodeForDerivation(): Promise<{
  pubKey: string;
  chainCode: string;
  keyshare: any;
}> {
  const secure: any = await readSecureKeyshareFields().catch(() => null);
  const meta: any = await getKeyshareMetadata().catch(() => null);
  const ks = secure ?? meta;
  if (!ks) return {pubKey: '', chainCode: '', keyshare: null};
  // pubKey may come from secure fields or metadata (non-secret);
  // chaincode from secure fields only (metadata blanks it by design).
  const pubKey = String((secure as any)?.pub_key || ks.pub_key || '').trim();
  const chainCode = chaincodeHexFromBlob(secure);
  return {pubKey, chainCode, keyshare: ks};
}

/** Sync read from secure keyshare fields already in hand. Metadata is ignored. */
export function chaincodeHexFromBlob(blob: any): string {
  if (!blob || typeof blob !== 'object') return '';
  return String(blob.chain_code_hex || blob.chaincode || '')
    .trim()
    .toLowerCase();
}

/** Direct secure-fields chaincode read for address/derivation screens. */
export async function getChaincodeFromBlob(): Promise<string> {
  const secure: any = await readSecureKeyshareFields().catch(() => null);
  return chaincodeHexFromBlob(secure);
}

/**
 * Master chaincode for BIP32 derivation.
 * Native-projected secure metadata is the source. DB metadata
 * chain_code_hex is blank by design.
 */
export async function resolveChaincodeHex(): Promise<string> {
  const hex = (await getChaincodeFromBlob()).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('Chain code missing from keyshare');
  }
  return hex;
}

export function getBlankedMetadataChaincode(): string {
  return '';
}

/** Guard: metadata chaincode must stay blanked; returns true when blank. */
export function assertMetadataChaincodeBlanked(meta: any): boolean {
  if (!meta) return true;
  const v = String(meta.chain_code_hex ?? meta.chaincode ?? '').trim();
  return v === '';
}
