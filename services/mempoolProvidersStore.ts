/**
 * Mempool provider lists — same shape as Nostr relays (url + enabled).
 * Mainnet and testnet4 are stored separately. Enabled URLs are the only
 * failover / fee / sync pool for that network.
 */
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';
import {
  CANONICAL_TESTNET_MEMPOOL_API_BASE,
  getStoredNetworkKey,
  isTestnetNetworkKey,
  isValidTestnetMempoolApiUrl,
  mainnetPricesUrl,
  normalizeMempoolApiRoot,
  normalizeUserMempoolApiInput,
} from './mempoolApiBase';
import {getMainnetAPIList, getTestnetAPIList} from '../utils';

export type MempoolProviderEntry = {
  url: string;
  enabled: boolean;
};

export const PROVIDER_SCHEME_ERROR =
  'Provider URLs must start with https:// or http://';

const FALLBACK_MAINNET = 'https://mempool.space/api';

export type ProviderNetwork = 'mainnet' | 'testnet4';

export function providerNetworkKey(network: string): ProviderNetwork {
  return isTestnetNetworkKey(network) ? 'testnet4' : 'mainnet';
}

export function fallbackProviderUrl(network: string): string {
  return providerNetworkKey(network) === 'testnet4'
    ? CANONICAL_TESTNET_MEMPOOL_API_BASE
    : FALLBACK_MAINNET;
}

function entriesConfigKey(network: string): string {
  return providerNetworkKey(network) === 'testnet4'
    ? CONFIG_KEYS.MEMPOOL_PROVIDERS_ENTRIES_TESTNET
    : CONFIG_KEYS.MEMPOOL_PROVIDERS_ENTRIES;
}

function perNetworkApiKey(network: string): string {
  return providerNetworkKey(network) === 'testnet4'
    ? 'api_testnet4'
    : 'api_mainnet';
}

/** True when `url` belongs on `network` (testnet4 path, or mainnet without one). */
export function providerUrlMatchesNetwork(url: string, network: string): boolean {
  if (providerNetworkKey(network) === 'testnet4') {
    return isValidTestnetMempoolApiUrl(url);
  }
  const u = (url || '').trim().toLowerCase();
  if (!u.startsWith('https://') && !u.startsWith('http://')) {
    return false;
  }
  return !/\/testnet|\/signet/i.test(u);
}

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

export function primaryProviderUrl(
  list: MempoolProviderEntry[],
  fallback: string = FALLBACK_MAINNET,
): string {
  const active = activeProviderUrls(list);
  return active[0] || fallback;
}

/**
 * Curated rows on, custom rows kept but off. "Use public endpoints"
 * does not delete an endpoint the user added.
 */
export function withPublicEndpointsSelected(
  entries: MempoolProviderEntry[],
  curated: MempoolProviderEntry[],
): MempoolProviderEntry[] {
  const roots = new Set(curated.map(e => normalizeMempoolApiRoot(e.url)));
  const custom = entries.filter(
    e => e.url && !roots.has(normalizeMempoolApiRoot(e.url)),
  );
  return [
    ...curated.map(e => ({url: e.url, enabled: true})),
    ...custom.map(e => ({...e, enabled: false})),
  ];
}

/**
 * Compact host for the header pill.
 * Mainnet: `mempool.space`. Testnet: `mempool.space/testnet4` (path kept so it
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
  if (path === 'testnet4' || path.startsWith('testnet4/')) {
    return `${host}/testnet4`;
  }
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

/** True for mempool.space-style `/testnet` and `/testnet4` API bases. */
export function isTestnetMempoolApiBase(apiBase: string): boolean {
  return /\/testnet4?(\/|$)/i.test(apiBase || '');
}

/**
 * Sync label for HeaderProvider: primary enabled host + `+N` when that
 * network's pool has more than one enabled provider. Testnet reads the
 * testnet list, never the mainnet one.
 */
/** Enabled provider API bases for the network implied by `apiBase`. */
export function getActiveProviderUrlsForApiBase(
  apiBase?: string | null,
): string[] {
  const fallbackBase = (apiBase || '').trim();
  const testnet = isTestnetMempoolApiBase(fallbackBase);
  const stored = appConfigRepository.get(
    testnet
      ? CONFIG_KEYS.MEMPOOL_PROVIDERS_ENTRIES_TESTNET
      : CONFIG_KEYS.MEMPOOL_PROVIDERS_ENTRIES,
  );
  const parsed = parseStoredProviderEntries(stored);
  const active = parsed ? activeProviderUrls(parsed) : [];
  if (active.length > 0) {
    return active;
  }
  if (fallbackBase) {
    return [fallbackBase];
  }
  return [testnet ? CANONICAL_TESTNET_MEMPOOL_API_BASE : FALLBACK_MAINNET];
}

export function getHeaderProviderDisplay(
  apiBase?: string | null,
): HeaderProviderDisplay {
  const fallbackBase = (apiBase || '').trim();
  const testnet = isTestnetMempoolApiBase(fallbackBase);
  const active = getActiveProviderUrlsForApiBase(apiBase);
  const primaryUrl =
    active[0] ||
    fallbackBase ||
    (testnet ? CANONICAL_TESTNET_MEMPOOL_API_BASE : FALLBACK_MAINNET);
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

/**
 * Defaults for Network Providers. Pulls the pinned remote list first.
 * A failed, empty, or timed-out fetch uses the built-in copy of that list.
 */
export async function loadDefaultMempoolProviderEntries(
  network: string = 'mainnet',
): Promise<MempoolProviderEntry[]> {
  const net = providerNetworkKey(network);
  const fallback = fallbackProviderUrl(net);
  const urls =
    net === 'testnet4' ? await getTestnetAPIList() : await getMainnetAPIList();
  const matching = (urls.length > 0 ? urls : [fallback]).filter((url: string) =>
    providerUrlMatchesNetwork(url, net),
  );
  const list = urlsToProviderEntries(
    matching.length > 0 ? matching : [fallback],
    true,
  );
  return list.length > 0 ? list : urlsToProviderEntries([fallback], true);
}

/**
 * Public mainnet `/api/v1/prices` URLs. Remote list first, built-in copy
 * if that fetch fails. Used for fiat quotes while the wallet is on testnet4.
 */
export async function publicMainnetPriceUrls(): Promise<string[]> {
  const entries = await loadDefaultMempoolProviderEntries('mainnet');
  return entries.map(entry => mainnetPricesUrl(entry.url));
}

/**
 * Persist entries and sync `api_<network>` to the first enabled URL.
 * The global `api` key is updated only when that network is the active one,
 * so loading the other network's list cannot clobber it.
 * If every entry is disabled, force-enable the first so we never invent a host
 * the user did not list (and never leave primary pointing at a disabled URL).
 */
export function saveMempoolProviderEntries(
  list: MempoolProviderEntry[],
  network: string = 'mainnet',
): MempoolProviderEntry[] {
  const net = providerNetworkKey(network);
  const fallback = fallbackProviderUrl(net);
  const chainList = list.filter(e => providerUrlMatchesNetwork(e.url, net));
  const normalized = ensureAtLeastOneEnabled(chainList, fallback);
  const primary = primaryProviderUrl(normalized, fallback);
  try {
    appConfigRepository.set(entriesConfigKey(net), JSON.stringify(normalized));
    appConfigRepository.set(perNetworkApiKey(net), primary);
    if (providerNetworkKey(getStoredNetworkKey()) === net) {
      appConfigRepository.set('api', primary);
    }
    notifyMempoolProvidersChanged();
  } catch {
    // ignore
  }
  return normalized;
}

/** If all disabled, enable the first entry. Otherwise return list unchanged. */
export function ensureAtLeastOneEnabled(
  list: MempoolProviderEntry[],
  fallback: string = FALLBACK_MAINNET,
): MempoolProviderEntry[] {
  if (list.length === 0) {
    return urlsToProviderEntries([fallback], true);
  }
  if (activeProviderUrls(list).length > 0) {
    return list;
  }
  return list.map((e, i) => ({...e, enabled: i === 0}));
}

function legacyApiForNetwork(network: ProviderNetwork): string {
  if (network === 'testnet4') {
    return (
      appConfigRepository.get('api_testnet4') ||
      appConfigRepository.get('api_testnet3') ||
      ''
    );
  }
  return (
    appConfigRepository.get('api_mainnet') ||
    appConfigRepository.get('api') ||
    ''
  );
}

/**
 * Load the stored list for `network`, or migrate from the legacy per-network
 * API / curated defaults.
 *
 * - Custom (not in the curated list, and on the right chain) → exclusive-enable.
 * - Curated / missing → curated list all enabled.
 * A URL for the other chain is ignored.
 */
export async function loadMempoolProviderEntries(
  network: string = 'mainnet',
): Promise<MempoolProviderEntry[]> {
  const net = providerNetworkKey(network);
  const fallback = fallbackProviderUrl(net);
  const stored = appConfigRepository.get(entriesConfigKey(net));
  const fromJson = parseStoredProviderEntries(stored);
  if (fromJson) {
    const onChain = fromJson.filter(e => providerUrlMatchesNetwork(e.url, net));
    if (onChain.length > 0) {
      const synced = ensureAtLeastOneEnabled(onChain, fallback);
      const primary = primaryProviderUrl(synced, fallback);
      const current = appConfigRepository.get(perNetworkApiKey(net)) || '';
      if (
        normalizeMempoolApiRoot(current) !== normalizeMempoolApiRoot(primary) ||
        synced.length !== fromJson.length
      ) {
        return saveMempoolProviderEntries(synced, net);
      }
      return synced;
    }
  }

  const curated = await loadDefaultMempoolProviderEntries(net);
  const curatedRoots = new Set(
    curated.map(e => normalizeMempoolApiRoot(e.url)),
  );

  const legacy = legacyApiForNetwork(net);
  const normalized = legacy ? normalizeProviderUrl(legacy) : '';
  if (
    normalized &&
    providerUrlMatchesNetwork(normalized, net) &&
    !curatedRoots.has(normalizeMempoolApiRoot(normalized))
  ) {
    const migrated = exclusiveEnable(normalized, curated);
    return saveMempoolProviderEntries(migrated, net);
  }

  return saveMempoolProviderEntries(curated, net);
}

/**
 * Ensure entries exist (migrate if needed) and return **enabled** URLs only
 * for the client / fee pool. Never includes disabled providers.
 * Omitted network stays mainnet so price fetches do not read the testnet list.
 */
export async function ensureMempoolProvidersSeeded(
  network: string = 'mainnet',
): Promise<string[]> {
  const net = providerNetworkKey(network);
  const list = await loadMempoolProviderEntries(net);
  const active = activeProviderUrls(list);
  return active.length > 0 ? active : [fallbackProviderUrl(net)];
}
