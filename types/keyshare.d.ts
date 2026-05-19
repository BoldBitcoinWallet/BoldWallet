export type TssBackend = 'gg18' | 'dkls23';

export interface KeyshareMetadata {
  pub_key: string;
  chain_code_hex: string;
  /**
   * Wallet creation time in milliseconds since Unix epoch (normalized on save/read).
   * For GG18 only: values at or before `1765894825732` mean legacy BIP44-only paths.
   */
  created_at: number | null;
  local_party_key: string;
  keygen_committee_keys: string[];
  nostr_npub: string | null;
  /**
   * MPC stack. Persisted in metadata so stripped caches still route correctly:
   * GG18 uses timestamp path rules; DKLs23 always uses standard BIP84/BIP49 paths.
   */
  tss_backend?: TssBackend;
}
