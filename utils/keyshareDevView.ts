/**
 * Parse full keyshare JSON for dev-only inspection UI.
 */

export function parseKeyshareJsonForDevView(
  raw: string | null | undefined,
): {data: Record<string, unknown>} | {error: string} {
  if (raw == null || String(raw).trim() === '') {
    return {error: 'No keyshare in secure storage'};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {error: 'Keyshare JSON must be an object'};
    }
    return {data: parsed as Record<string, unknown>};
  } catch {
    return {error: 'Invalid keyshare JSON'};
  }
}

export function prettyPrintKeyshareJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}
