export interface KeyshareMetadata {
  pub_key: string;
  chain_code_hex: string;
  created_at: number | null;
  local_party_key: string;
  keygen_committee_keys: string[];
  nostr_npub: string | null;
}
