/**
 * Parse full keyshare JSON for dev-only inspection UI.
 */

/** JSON numbers with more than 16 decimal digits do not fit IEEE doubles. */
const MAX_JSON_NUMBER_DIGITS = 16;

/**
 * Go `json.Marshal` writes `*big.Int` (GG18 `ecdsa_local_data.Alpha`, `NTildei`, etc.)
 * as bare JSON numbers. `JSON.parse` turns values above ~1e308 into `Infinity`.
 * Quote oversized integer literals so they survive as decimal strings.
 */
export function quoteOversizedJsonIntegers(raw: string): string {
  const minDigits = MAX_JSON_NUMBER_DIGITS + 1;
  const re = new RegExp(
    `([:\\[,]\\s*)(-?\\d{${minDigits},})(?=\\s*[,\\}\\]\\]])`,
    'g',
  );
  return raw.replace(re, '$1"$2"');
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

export function prettyPrintKeyshareJson(data: Record<string, unknown>): string {
  // JSON doesn't support Infinity/NaN/BigInt. If they exist in-memory (or come
  // from native decoding), default JSON.stringify either turns them into null
  // (Infinity/NaN) or throws (BigInt). For dev inspection/copy we preserve them
  // as readable strings.
  return JSON.stringify(
    data,
    (_key, value: unknown) => {
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
