/**
 * Realistic MPC keyshare fixtures for JS-side persist / dispatch tests.
 *
 * GG18: mirrors Go `json.Marshal` of `tss.LocalState` / `LocalPartySaveData`
 * where `*big.Int` fields are bare JSON numbers (often >> IEEE double range).
 * Naïve `JSON.parse`+`stringify` turns those into scientific floats that Go
 * rejects: `math/big: cannot unmarshal "1.43…e+308" into a *big.Int`.
 *
 * DKLs: F15b staged handle + metadata only — share bytes never enter JS.
 */

/** ~308-digit magnitude that collapses to ~1.43e+307/308 under IEEE parse. */
export const GG18_HUGE_PAILLIER_D =
  '143042430941967' + '0'.repeat(293);

/** >16 digits: silent precision loss if parsed as a JS number. */
export const GG18_HUGE_ALPHA = '9'.repeat(77);

export const GG18_HUGE_NTILDE = '8'.repeat(200);

export const GG18_PUB_KEY = `03${'ab'.repeat(32)}`;
export const GG18_CHAIN_CODE = 'cc'.repeat(32);

/**
 * Raw JSON string as returned by native GG18 keygen (LAN or Nostr).
 * Integers are unquoted literals — do not build this via JSON.stringify.
 */
export function buildGoShapedGg18KeyshareJson(opts?: {
  /** When false, omit tss_backend (pre-tagging legacy wallets). Default true. */
  withTssBackend?: boolean;
  localPartyKey?: string;
  committee?: [string, string];
}): string {
  const withBackend = opts?.withTssBackend !== false;
  const local = opts?.localPartyKey ?? 'npub1qcujl24je9hw0wqd6skelcv4z2ga6mk8hktdz9vrdrjns6yd6q8syxycaf';
  const peer =
    opts?.committee?.[1] ??
    'npub1dvda64gdhl09r0m8eq0f4fnga5g27h38eu8xtrflzjxqu2kjj9gq3ntfpd';
  const a = opts?.committee?.[0] ?? local;
  const backend = withBackend ? `"tss_backend":"gg18",` : '';
  // Field names follow tss-lib LocalPartySaveData / LocalPreParams JSON tags.
  return (
    `{${backend}` +
    `"pub_key":"${GG18_PUB_KEY}",` +
    `"ecdsa_local_data":{` +
    `"LocalPreParams":{` +
    `"PaillierSK":{"L":${GG18_HUGE_PAILLIER_D},"N":${GG18_HUGE_NTILDE},"P":${GG18_HUGE_NTILDE},"Q":${GG18_HUGE_NTILDE}},` +
    `"NTildei":${GG18_HUGE_NTILDE},` +
    `"H1i":${GG18_HUGE_ALPHA},` +
    `"H2i":${GG18_HUGE_ALPHA},` +
    `"Alpha":${GG18_HUGE_ALPHA},` +
    `"Beta":${GG18_HUGE_ALPHA},` +
    `"P":${GG18_HUGE_NTILDE},` +
    `"Q":${GG18_HUGE_NTILDE}` +
    `},` +
    `"Xi":${GG18_HUGE_ALPHA},` +
    `"ShareID":1,` +
    `"Ks":[1,2],` +
    `"BigXj":[{"X":${GG18_HUGE_ALPHA},"Y":${GG18_HUGE_ALPHA}}],` +
    `"ECDSAPub":{"X":${GG18_HUGE_ALPHA},"Y":${GG18_HUGE_ALPHA}}` +
    `},` +
    `"keygen_committee_keys":["${a}","${peer}"],` +
    `"local_party_key":"${local}",` +
    `"chain_code_hex":"${GG18_CHAIN_CODE}",` +
    `"created_at":1710000000` +
    `}`
  );
}

export const DKLS_STAGED_HANDLE = 'staged-dkls-matrix-handle';

export const DKLS_STAGED_METADATA = {
  pub_key: `02${'cd'.repeat(32)}`,
  tss_backend: 'dkls23',
  suite: 'dkls23',
  local_party_key:
    'npub1qcujl24je9hw0wqd6skelcv4z2ga6mk8hktdz9vrdrjns6yd6q8syxycaf',
  keygen_committee_keys: [
    'npub1qcujl24je9hw0wqd6skelcv4z2ga6mk8hktdz9vrdrjns6yd6q8syxycaf',
    'npub1dvda64gdhl09r0m8eq0f4fnga5g27h38eu8xtrflzjxqu2kjj9gq3ntfpd',
  ],
  chain_code_hex: '',
  created_at: 1710000000,
};

export function buildDklsStagedSetupRaw(): string {
  return JSON.stringify({
    handle: DKLS_STAGED_HANDLE,
    metadata: DKLS_STAGED_METADATA,
  });
}

/**
 * Go `*big.Int` UnmarshalJSON accepts bare number tokens only (not JSON
 * strings, not scientific floats). Persist output must match Go marshal shape.
 */
export function assertJsonSafeForGoBigIntUnmarshal(raw: string): void {
  expect(raw).not.toMatch(/\d+\.\d+[eE][+-]?\d+/);
  expect(raw).not.toContain('Infinity');
  expect(raw).not.toContain('-Infinity');
  // Exact decimals present as bare JSON numbers, not quoted strings.
  expect(raw).toContain(GG18_HUGE_PAILLIER_D);
  expect(raw).toContain(GG18_HUGE_ALPHA);
  expect(raw).toContain(GG18_HUGE_NTILDE);
  expect(raw).not.toContain(`"${GG18_HUGE_PAILLIER_D}"`);
  expect(raw).not.toContain(`"${GG18_HUGE_ALPHA}"`);
  expect(raw).not.toContain(`"${GG18_HUGE_NTILDE}"`);
  expect(raw).toMatch(
    new RegExp(`"Alpha":${GG18_HUGE_ALPHA}[,}\\]]`),
  );
}

/**
 * Naïve JS round-trip — documents the production bug mode.
 * Returns true when the blob was destroyed for Go unmarshal.
 */
export function naiveJsRoundTripCorruptsGg18BigInts(raw: string): boolean {
  try {
    const destroyed = JSON.stringify(JSON.parse(raw));
    return (
      /\d+\.\d+[eE][+-]?\d+/.test(destroyed) ||
      destroyed.includes('Infinity') ||
      !destroyed.includes(GG18_HUGE_PAILLIER_D)
    );
  } catch {
    return true;
  }
}
