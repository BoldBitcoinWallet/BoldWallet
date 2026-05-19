export type TssBackend = 'gg18' | 'dkls23';

export interface KeyshareMetadata {
  pub_key: string;
  chain_code_hex: string;
  created_at: number | null;
  local_party_key: string;
  keygen_committee_keys: string[];
  nostr_npub: string | null;
  /** MPC stack: `dkls23` (libtss) or `gg18` (BNB). Inferred on save if omitted. */
  tss_backend?: TssBackend;
}
