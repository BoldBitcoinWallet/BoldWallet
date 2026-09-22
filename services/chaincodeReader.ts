/**
 * chaincodeReader — Spec v2.1 leak hardening.
 * Chaincode comes from the encrypted keyshare blob ONLY.
 * SQLite/DB metadata chain_code_hex is blanked ('') and must never be used.
 */
import {getKeyshareMetadata, KEYSHARE_STORAGE_KEY} from '../utils';
import EncryptedStorage from 'react-native-encrypted-storage';

async function readKeyshareBlob(): Promise<any> {
  try {
    const raw = await EncryptedStorage.getItem(KEYSHARE_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export async function resolveChaincodeForDerivation(): Promise<{
  pubKey: string;
  chainCode: string;
  keyshare: any;
}> {
  const blob: any = await readKeyshareBlob().catch(() => null);
  const meta: any = await getKeyshareMetadata().catch(() => null);
  const ks = blob ?? meta;
  if (!ks) return {pubKey: '', chainCode: '', keyshare: null};
  // pubKey may come from blob or metadata (non-secret); chaincode blob-only.
  const pubKey = String((blob as any)?.pub_key || ks.pub_key || '').trim();
  // Blob-only: metadata chain_code_hex is blanked by design.
  const chainCode = chaincodeHexFromBlob(blob);
  return {pubKey, chainCode, keyshare: ks};
}

/** Sync read from a keyshare blob already in hand. Metadata is ignored. */
export function chaincodeHexFromBlob(blob: any): string {
  if (!blob || typeof blob !== 'object') return '';
  return String(blob.chain_code_hex || blob.chaincode || '')
    .trim()
    .toLowerCase();
}

/** Direct blob-only chaincode read for address/derivation screens. */
export async function getChaincodeFromBlob(): Promise<string> {
  const blob: any = await readKeyshareBlob().catch(() => null);
  return chaincodeHexFromBlob(blob);
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
