/**
 * Parse full keyshare JSON for dev-only inspection UI.
 */

/** JSON numbers with more than 16 decimal digits do not fit IEEE doubles. */
const MAX_JSON_NUMBER_DIGITS = 16;

/**
 * Go `json.Marshal` writes `*big.Int` (GG18 `ecdsa_local_data.Alpha`, `NTildei`, etc.)
 * as bare JSON numbers. `JSON.parse` turns values above ~1e308 into `Infinity`.
 * Quote oversized integer literals so they survive as decimal strings in JS.
 *
 * Go `*big.Int` UnmarshalJSON does NOT accept JSON strings — only bare number
 * tokens (or null). After a JS round-trip, re-emit quoted digit strings as
 * bare numbers via {@link emitBareOversizedJsonIntegers}.
 */
export function quoteOversizedJsonIntegers(raw: string): string {
  const minDigits = MAX_JSON_NUMBER_DIGITS + 1;
  const re = new RegExp(
    `([:\\[,]\\s*)(-?\\d{${minDigits},})(?=\\s*[,\\}\\]\\]])`,
    'g',
  );
  return raw.replace(re, '$1"$2"');
}

/**
 * Inverse of {@link quoteOversizedJsonIntegers} for persist output:
 * `"Alpha":"123…"` → `"Alpha":123…` so Go math/big can unmarshal.
 */
export function emitBareOversizedJsonIntegers(raw: string): string {
  const minDigits = MAX_JSON_NUMBER_DIGITS + 1;
  const re = new RegExp(
    `([:\\[,]\\s*)"(-?\\d{${minDigits},})"(?=\\s*[,\\}\\]\\]])`,
    'g',
  );
  return raw.replace(re, '$1$2');
}

export function parseKeyshareJsonForDevView(
  raw: string | null | undefined,
): {data: Record<string, unknown>} | {error: string} {
  if (raw == null || String(raw).trim() === '') {
    return {error: 'No keyshare in secure storage'};
  }
  try {
    const safeRaw = quoteOversizedJsonIntegers(raw);
    const parsed = JSON.parse(safeRaw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {error: 'Keyshare JSON must be an object'};
    }
    return {data: parsed as Record<string, unknown>};
  } catch {
    return {error: 'Invalid keyshare JSON'};
  }
}

/**
 * F10-clipboard: metadata-only payload for the dev-view Copy button.
 * Only npub / pub_key / suite (or tss_backend for GG18) — NEVER add
 * share_b64, ecdsa_local_data, nsec, or chaincode here.
 */
export function formatKeyshareMetadataForCopy(
  data: Record<string, unknown>,
): string {
  const out: Record<string, unknown> = {};
  const npub = data.nostr_npub ?? data.npub;
  if (typeof npub === 'string' && npub) {
    out.npub = npub;
  }
  if (typeof data.pub_key === 'string' && data.pub_key) {
    out.pub_key = data.pub_key;
  }
  if (typeof data.suite === 'number') {
    out.suite = data.suite;
  } else if (
    typeof data.tss_backend === 'string' &&
    data.tss_backend
  ) {
    out.tss_backend = data.tss_backend;
  }
  return JSON.stringify(out, null, 2);
}

export function prettyPrintKeyshareJson(data: Record<string, unknown>): string {
  // Spec v2: dev full-JSON copy strips chain_code_hex. The master chaincode
  // must not leave the phone via copy-paste; derive from the encrypted blob.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-pattern omit
  const {chain_code_hex: _stripped, ...rest} = data;
  // JSON doesn't support Infinity/NaN/BigInt. If they exist in-memory (or come
  // from native decoding), default JSON.stringify either turns them into null
  // (Infinity/NaN) or throws (BigInt). For dev inspection/copy we preserve them
  // as readable strings.
  return JSON.stringify(
    rest,
    (_key, value: unknown) => {
      if (_key === 'chain_code_hex') {
        return '[redacted:chaincode]';
      }
      if (typeof value === 'number') {
        if (Number.isNaN(value)) return 'NaN';
        if (value === Infinity) return 'Infinity';
        if (value === -Infinity) return '-Infinity';
        return value;
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    },
    2,
  );
}
