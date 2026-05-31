/**
 * LAN peer discovery helpers (no AppConfig / native deps).
 * Used by MobilesPairing and unit tests.
 */

/** True when host is a dotted IPv4 quad (LAN discovery uses IPs only). */
export function isIPv4LanHost(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/** Strip scheme/port; map 0.0.0.0 to null (invalid as client target). */
export function normalizeLanHost(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }
  let s = String(raw).trim();
  if (!s) {
    return null;
  }
  s = s.replace(/^https?:\/\//i, '');
  const slash = s.indexOf('/');
  if (slash >= 0) {
    s = s.slice(0, slash);
  }
  const host = (s.split(':')[0] || '').trim();
  if (!host || host === '0.0.0.0' || !isIPv4LanHost(host)) {
    return null;
  }
  return host;
}

/** Native discover/listen may return "error:…" on timeout — not a peer payload. */
export function isNativeDiscoveryError(
  value: string | null | undefined,
): boolean {
  return /^error:/i.test(String(value ?? '').trim());
}

/**
 * Valid payloads look like: "host:port@hex(device@party)@pubkey" (optionally "|" for trio).
 */
export function isLanPeerDiscoveryPayload(
  value: string | null | undefined,
): boolean {
  const raw = String(value ?? '').trim();
  if (!raw || isNativeDiscoveryError(raw)) {
    return false;
  }
  const primary = raw.split('|')[0]?.split(',')[0]?.trim() ?? '';
  if (!primary.includes('@')) {
    return false;
  }
  const hostToken = (primary.split('@')[0] || '').split(':')[0].trim();
  return normalizeLanHost(hostToken) != null;
}

/** Write peerFound cache for any non-empty native line except error:… */
export function shouldWritePeerFoundCache(
  value: string | null | undefined,
): boolean {
  const raw = String(value ?? '').trim();
  return raw.length > 0 && !isNativeDiscoveryError(raw);
}

/**
 * Main-branch timing: first settled listen/discover promise (may be empty).
 * Cache polling picks up a valid payload written by the slower path.
 */
export function raceLanPeerDiscovery(
  promises: Array<Promise<string | null>>,
): Promise<string | null> {
  if (promises.length === 0) {
    return Promise.resolve(null);
  }
  return Promise.race(promises);
}

/**
 * First valid LAN payload from any promise (does not wait for slow discover loop).
 */
export function firstValidLanPeerPayload(
  promises: Array<Promise<string | null>>,
): Promise<string | null> {
  if (promises.length === 0) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    let remaining = promises.length;
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    for (const p of promises) {
      p
        .then(value => {
          remaining -= 1;
          if (isLanPeerDiscoveryPayload(value)) {
            finish(value);
          } else if (remaining === 0) {
            finish(null);
          }
        })
        .catch(() => {
          remaining -= 1;
          if (remaining === 0) {
            finish(null);
          }
        });
    }
  });
}

/** Resolve when cache holds a valid payload or deadline passes. */
export async function pollPeerFoundUntilValid(
  getCached: () => string | null | undefined,
  deadlineMs: number,
  pollIntervalMs = 1000,
): Promise<string | null> {
  while (Date.now() < deadlineMs) {
    const cached = getCached();
    if (cached && !isNativeDiscoveryError(cached)) {
      if (isLanPeerDiscoveryPayload(cached)) {
        return cached;
      }
    }
    await new Promise<void>(r => setTimeout(r, pollIntervalMs));
  }
  return null;
}
