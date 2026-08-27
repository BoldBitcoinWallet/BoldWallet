import LocalCache from './LocalCache';
import appConfigRepository from './repositories/AppConfigRepository';
import {getNostrRelays, NOSTR_RELAY_DENYLIST} from '../utils';

export type NostrRelayEntry = {
  url: string;
  enabled: boolean;
};

const CSV_KEY = 'nostr_relays';
const ENTRIES_KEY = 'nostr_relays_entries';

export const RELAY_SCHEME_ERROR =
  'Relay URLs must start with wss:// or ws://';

export function isUnreliableNostrRelay(url: string): boolean {
  return NOSTR_RELAY_DENYLIST.includes(url.trim());
}

export function normalizeRelayUrl(raw: string): string {
  return raw.trim();
}

export function isValidRelayUrl(url: string): boolean {
  const u = normalizeRelayUrl(url);
  return u.startsWith('wss://') || u.startsWith('ws://');
}

export function parseRelayUrls(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/[,\n]/)) {
    const url = normalizeRelayUrl(part);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function urlsToEntries(
  urls: string[],
  enabled = true,
): NostrRelayEntry[] {
  const seen = new Set<string>();
  const out: NostrRelayEntry[] = [];
  for (const raw of urls) {
    const url = normalizeRelayUrl(raw);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push({url, enabled});
  }
  return out;
}

export function activeRelayUrls(list: NostrRelayEntry[]): string[] {
  return list.filter(e => e.enabled && e.url).map(e => e.url);
}

export function activeRelaysCSV(list: NostrRelayEntry[]): string {
  return activeRelayUrls(list).join(',');
}

export function allRelaysCSV(list: NostrRelayEntry[]): string {
  return list.map(e => e.url).filter(Boolean).join(',');
}

export function relayListSummary(list: NostrRelayEntry[]): string {
  const active = list.filter(e => e.enabled).length;
  const off = list.length - active;
  if (off > 0) {
    return `${active} active · ${off} off`;
  }
  return `${active} active`;
}

export function firstInvalidRelayUrl(urls: string[]): string | null {
  return urls.find(u => !isValidRelayUrl(u)) ?? null;
}

export function parseStoredRelayEntries(raw: string | null): NostrRelayEntry[] | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const out: NostrRelayEntry[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const url = normalizeRelayUrl(String((item as {url?: unknown}).url ?? ''));
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      out.push({
        url,
        enabled: (item as {enabled?: unknown}).enabled !== false,
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function loadNostrRelayEntries(): Promise<NostrRelayEntry[]> {
  try {
    const stored = await LocalCache.getItem(ENTRIES_KEY);
    const fromJson = parseStoredRelayEntries(stored);
    if (fromJson) {
      return fromJson;
    }
  } catch {
    // fall through to CSV
  }
  const urls = await getNostrRelays(false);
  return urlsToEntries(urls, true);
}

export async function saveNostrRelayEntries(
  list: NostrRelayEntry[],
): Promise<void> {
  const csvAll = allRelaysCSV(list);
  try {
    await LocalCache.setItem(ENTRIES_KEY, JSON.stringify(list));
    await LocalCache.setItem(CSV_KEY, csvAll);
  } catch {
    // LocalCache already logs
  }
  try {
    appConfigRepository.set(CSV_KEY, csvAll);
  } catch {
    // ignore
  }
}

export async function loadDefaultNostrRelayEntries(): Promise<NostrRelayEntry[]> {
  const urls = await getNostrRelays(true);
  return urlsToEntries(urls, true);
}
