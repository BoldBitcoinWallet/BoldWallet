/**
 * Mainnet mempool provider list — same shape as Nostr relays (url + enabled).
 * Enabled URLs are the only failover / fee / sync pool. Testnet is not stored here.
 */
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';
import {
  normalizeMempoolApiRoot,
  normalizeUserMempoolApiInput,
} from './mempoolApiBase';
import {getMainnetAPIList} from '../utils';

export type MempoolProviderEntry = {
  url: string;
  enabled: boolean;
};

export const PROVIDER_SCHEME_ERROR =
  'Provider URLs must start with https:// or http://';

const FALLBACK_MAINNET = 'https://mempool.space/api';

type ProviderListListener = () => void;
const providerListListeners = new Set<ProviderListListener>();

function notifyMempoolProvidersChanged(): void {
  providerListListeners.forEach(fn => {
    try {
      fn();
    } catch {
      // ignore subscriber errors
    }
  });
}

/** Subscribe to provider list saves (header +N refresh). */
export function subscribeMempoolProviders(
  fn: ProviderListListener,
): () => void {
  providerListListeners.add(fn);
  return () => {
    providerListListeners.delete(fn);
  };
}

export function normalizeProviderUrl(raw: string): string {
  return normalizeUserMempoolApiInput(raw.trim());
}

export function isValidProviderUrl(url: string): boolean {
  const u = normalizeProviderUrl(url);
  return u.startsWith('https://') || u.startsWith('http://');
}

export function parseProviderUrls(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/[,\n]/)) {
    const url = normalizeProviderUrl(part);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function urlsToProviderEntries(
  urls: string[],
  enabled = true,
): MempoolProviderEntry[] {
  const seen = new Set<string>();
  const out: MempoolProviderEntry[] = [];
  for (const raw of urls) {
    const url = normalizeProviderUrl(raw);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push({url, enabled});
  }
  return out;
}

export function activeProviderUrls(list: MempoolProviderEntry[]): string[] {
  return list.filter(e => e.enabled && e.url).map(e => e.url);
}

export function activeProvidersCSV(list: MempoolProviderEntry[]): string {
  return activeProviderUrls(list).join(',');
}

export function providerListSummary(list: MempoolProviderEntry[]): string {
  const active = list.filter(e => e.enabled).length;
  const off = list.length - active;
  if (off > 0) {
    return `${active} active · ${off} off`;
  }
  return `${active} active`;
}

export function firstInvalidProviderUrl(urls: string[]): string | null {
  return urls.find(u => !isValidProviderUrl(u)) ?? null;
}

export function primaryProviderUrl(list: MempoolProviderEntry[]): string {
  const active = activeProviderUrls(list);
  return active[0] || FALLBACK_MAINNET;
}

/**
 * Compact host for the header pill.
 * Mainnet: `mempool.space`. Testnet: `mempool.space/testnet` (path kept so it
 * does not look like the mainnet mirror of the same host).
 */
export function hostnameFromMempoolApiBase(apiBase: string): string {
  const cleaned = (apiBase || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/?$/i, '')
    .replace(/\/+$/, '');
  if (!cleaned) {
    return '';
  }
  const slash = cleaned.indexOf('/');
  if (slash < 0) {
    return cleaned;
  }
  const host = cleaned.slice(0, slash);
  const path = cleaned.slice(slash + 1).toLowerCase();
  if (path === 'testnet' || path.startsWith('testnet/')) {
    return `${host}/testnet`;
  }
  if (path === 'signet' || path.startsWith('signet/')) {
    return `${host}/signet`;
  }
  return host;
}

export type HeaderProviderDisplay = {
  /** Primary hostname shown in the header pill. */
  host: string;
  /** Extra enabled providers beyond the primary (for `+N`). */
  extraCount: number;
  /** `host` or `host +N`. */
  label: string;
};

function isTestnetMempoolApiBase(apiBase: string): boolean {
  return /\/testnet(\/|$)/i.test(apiBase || '');
}

/**
 * Sync label for HeaderProvider: primary enabled host + `+N` when the mainnet
 * pool has more than one enabled provider. Testnet ignores the mainnet list
 * and shows only the resolved testnet base (no `+N`).
 */
export function getHeaderProviderDisplay(
  apiBase?: string | null,
): HeaderProviderDisplay {
  const fallbackBase = (apiBase || '').trim();

  // Testnet is a single canonical host — never overlay the mainnet checklist.
  if (isTestnetMempoolApiBase(fallbackBase)) {
    const host = hostnameFromMempoolApiBase(fallbackBase);
    return {host, extraCount: 0, label: host};
  }

  const stored = appConfigRepository.get(CONFIG_KEYS.MEMPOOL_PROVIDERS_ENTRIES);
  const parsed = parseStoredProviderEntries(stored);
  const active = parsed ? activeProviderUrls(parsed) : [];
  const primaryUrl = active[0] || fallbackBase || FALLBACK_MAINNET;
  const host = hostnameFromMempoolApiBase(primaryUrl);
  const enabledCount = active.length > 0 ? active.length : host ? 1 : 0;
  const extraCount = Math.max(0, enabledCount - 1);
  const label =
    host && extraCount > 0 ? `${host} +${extraCount}` : host;
  return {host, extraCount, label};
}

/**
 * Keep only `url` enabled (add it if missing). Other entries stay but are off.
 */
export function exclusiveEnable(
  url: string,
  list: MempoolProviderEntry[],
): MempoolProviderEntry[] {
  const target = normalizeProviderUrl(url);
  if (!target) {
    return list;
  }
  const root = normalizeMempoolApiRoot(target);
  let found = false;
  const next = list.map(e => {
    const match = normalizeMempoolApiRoot(e.url) === root;
    if (match) {
      found = true;
      return {url: target, enabled: true};
    }
    return {...e, enabled: false};
  });
  if (!found) {
    next.unshift({url: target, enabled: true});
  }
  return next;
}

export function parseStoredProviderEntries(
  raw: string | null,
): MempoolProviderEntry[] | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const out: MempoolProviderEntry[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const url = normalizeProviderUrl(
        String((item as {url?: unknown}).url ?? ''),
      );
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

export async function loadDefaultMempoolProviderEntries(): Promise<
  MempoolProviderEntry[]
> {
  const urls = await getMainnetAPIList();
  const list = urlsToProviderEntries(
    urls.length > 0 ? urls : [FALLBACK_MAINNET],
    true,
  );
  return list.length > 0 ? list : urlsToProviderEntries([FALLBACK_MAINNET], true);
}

/**
 * Persist entries and sync `api` / `api_mainnet` to the first enabled URL.
 * If every entry is disabled, force-enable the first so we never invent a host
 * the user did not list (and never leave primary pointing at a disabled URL).
 */
export function saveMempoolProviderEntries(list: MempoolProviderEntry[]): void {
  const normalized = ensureAtLeastOneEnabled(list);
  const primary = primaryProviderUrl(normalized);
  try {
    appConfigRepository.set(
      CONFIG_KEYS.MEMPOOL_PROVIDERS_ENTRIES,
      JSON.stringify(normalized),
    );
    appConfigRepository.set('api', primary);
    appConfigRepository.set('api_mainnet', primary);
    notifyMempoolProvidersChanged();
  } catch {
    // ignore
  }
}

/** If all disabled, enable the first entry. Otherwise return list unchanged. */
export function ensureAtLeastOneEnabled(
  list: MempoolProviderEntry[],
): MempoolProviderEntry[] {
  if (list.length === 0) {
    return urlsToProviderEntries([FALLBACK_MAINNET], true);
  }
  if (activeProviderUrls(list).length > 0) {
    return list;
  }
  return list.map((e, i) => ({...e, enabled: i === 0}));
}

/**
 * Load stored provider list, or migrate from legacy `api_mainnet` / curated defaults.
 *
 * - Custom (not in curated list) → exclusive-enable that URL.
 * - Curated / missing → curated list all enabled.
 * Always re-syncs `api` / `api_mainnet` to the first enabled URL.
 */
export async function loadMempoolProviderEntries(): Promise<
  MempoolProviderEntry[]
> {
  const stored = appConfigRepository.get(CONFIG_KEYS.MEMPOOL_PROVIDERS_ENTRIES);
  const fromJson = parseStoredProviderEntries(stored);
  if (fromJson) {
    const synced = ensureAtLeastOneEnabled(fromJson);
    // Keep primary in sync with enabled set (guards stale api pointing at a disabled host).
    const primary = primaryProviderUrl(synced);
    const current =
      appConfigRepository.get('api_mainnet') ||
      appConfigRepository.get('api') ||
      '';
    if (
      normalizeMempoolApiRoot(current) !== normalizeMempoolApiRoot(primary) ||
      synced !== fromJson
    ) {
      saveMempoolProviderEntries(synced);
    }
    return synced;
  }

  const curated = await loadDefaultMempoolProviderEntries();
  const curatedRoots = new Set(
    curated.map(e => normalizeMempoolApiRoot(e.url)),
  );

  const legacy =
    appConfigRepository.get('api_mainnet') ||
    appConfigRepository.get('api') ||
    '';
  const normalized = legacy ? normalizeProviderUrl(legacy) : '';
  if (
    normalized &&
    !normalized.toLowerCase().includes('/testnet') &&
    !curatedRoots.has(normalizeMempoolApiRoot(normalized))
  ) {
    const migrated = exclusiveEnable(normalized, curated);
    saveMempoolProviderEntries(migrated);
    return migrated;
  }

  saveMempoolProviderEntries(curated);
  return curated;
}

/**
 * Ensure entries exist (migrate if needed) and return **enabled** URLs only
 * for the client / fee pool. Never includes disabled providers.
 */
export async function ensureMempoolProvidersSeeded(): Promise<string[]> {
  const list = await loadMempoolProviderEntries();
  const active = activeProviderUrls(list);
  return active.length > 0 ? active : [FALLBACK_MAINNET];
}
