/**
 * @format
 */

jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  CONFIG_KEYS: {MEMPOOL_PROVIDERS_ENTRIES: 'mempool_providers_entries'},
  default: {set: jest.fn(), get: jest.fn()},
}));
jest.mock('../utils', () => ({
  getMainnetAPIList: jest.fn(async () => [
    'https://mempool.space/api',
    'https://mempool.emzy.de/api',
  ]),
}));

import appConfigRepository from '../services/repositories/AppConfigRepository';
import {
  activeProviderUrls,
  ensureAtLeastOneEnabled,
  exclusiveEnable,
  getHeaderProviderDisplay,
  hostnameFromMempoolApiBase,
  parseProviderUrls,
  parseStoredProviderEntries,
  primaryProviderUrl,
  providerListSummary,
  urlsToProviderEntries,
} from '../services/mempoolProvidersStore';

describe('mempoolProvidersStore', () => {
  beforeEach(() => {
    (appConfigRepository.get as jest.Mock).mockReset();
    (appConfigRepository.set as jest.Mock).mockReset();
  });

  it('parses CSV and newlines, de-dupes, and maps to enabled entries', () => {
    const urls = parseProviderUrls(
      'https://a.example/api\nhttps://b.example/api, https://a.example/api',
    );
    expect(urls).toEqual([
      'https://a.example/api',
      'https://b.example/api',
    ]);
    const entries = urlsToProviderEntries(urls);
    expect(entries.every(e => e.enabled)).toBe(true);
    expect(activeProviderUrls(entries)).toEqual(urls);
  });

  it('omits disabled providers from the active list', () => {
    const list = urlsToProviderEntries([
      'https://a.example/api',
      'https://b.example/api',
    ]);
    list[1].enabled = false;
    expect(activeProviderUrls(list)).toEqual(['https://a.example/api']);
    expect(providerListSummary(list)).toBe('1 active · 1 off');
    expect(primaryProviderUrl(list)).toBe('https://a.example/api');
  });

  it('exclusive-enables one URL and disables the rest', () => {
    const list = urlsToProviderEntries([
      'https://mempool.space/api',
      'https://mempool.emzy.de/api',
    ]);
    const next = exclusiveEnable('https://mempool.space/api', list);
    expect(activeProviderUrls(next)).toEqual(['https://mempool.space/api']);
    expect(next.find(e => e.url.includes('emzy'))?.enabled).toBe(false);
  });

  it('never returns disabled URLs from activeProviderUrls', () => {
    const list = [
      {url: 'https://on.example/api', enabled: true},
      {url: 'https://off.example/api', enabled: false},
      {url: 'https://also-on.example/api', enabled: true},
    ];
    expect(activeProviderUrls(list)).toEqual([
      'https://on.example/api',
      'https://also-on.example/api',
    ]);
  });

  it('force-enables the first entry when all are disabled', () => {
    const list = urlsToProviderEntries([
      'https://a.example/api',
      'https://b.example/api',
    ]);
    list.forEach(e => {
      e.enabled = false;
    });
    const fixed = ensureAtLeastOneEnabled(list);
    expect(activeProviderUrls(fixed)).toEqual(['https://a.example/api']);
    expect(fixed[1].enabled).toBe(false);
  });

  it('adds a custom URL when exclusive-enabling an unknown host', () => {
    const list = urlsToProviderEntries(['https://mempool.space/api']);
    const next = exclusiveEnable('https://my-node.example/api', list);
    expect(activeProviderUrls(next)).toEqual(['https://my-node.example/api']);
    expect(next).toHaveLength(2);
    expect(next.every(e => e.enabled === (e.url.includes('my-node')))).toBe(
      true,
    );
  });

  it('restores enabled flags from stored JSON', () => {
    const raw = JSON.stringify([
      {url: 'https://a.example/api', enabled: true},
      {url: 'https://b.example/api', enabled: false},
    ]);
    const parsed = parseStoredProviderEntries(raw);
    expect(parsed).toEqual([
      {url: 'https://a.example/api', enabled: true},
      {url: 'https://b.example/api', enabled: false},
    ]);
    expect(activeProviderUrls(parsed ?? [])).toEqual([
      'https://a.example/api',
    ]);
  });

  it('formats header label as host or host +N from enabled only', () => {
    (appConfigRepository.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'mempool_providers_entries') {
        return JSON.stringify([
          {url: 'https://mempool.space/api', enabled: true},
          {url: 'https://mempool.emzy.de/api', enabled: true},
          {url: 'https://off.example/api', enabled: false},
        ]);
      }
      return null;
    });
    expect(getHeaderProviderDisplay('https://mempool.space/api')).toEqual({
      host: 'mempool.space',
      extraCount: 1,
      label: 'mempool.space +1',
    });

    (appConfigRepository.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'mempool_providers_entries') {
        return JSON.stringify([
          {url: 'https://my-node.example/api', enabled: true},
          {url: 'https://mempool.space/api', enabled: false},
        ]);
      }
      return null;
    });
    expect(getHeaderProviderDisplay('https://my-node.example/api')).toEqual({
      host: 'my-node.example',
      extraCount: 0,
      label: 'my-node.example',
    });
  });

  it('hostnameFromMempoolApiBase strips scheme and /api', () => {
    expect(hostnameFromMempoolApiBase('https://mempool.space/api')).toBe(
      'mempool.space',
    );
    expect(
      hostnameFromMempoolApiBase('https://mempool.space/testnet/api'),
    ).toBe('mempool.space/testnet');
  });

  it('header label on testnet ignores mainnet enabled pool', () => {
    (appConfigRepository.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'mempool_providers_entries') {
        return JSON.stringify([
          {url: 'https://mempool.space/api', enabled: true},
          {url: 'https://mempool.emzy.de/api', enabled: true},
          {url: 'https://mempool.bisq.services/api', enabled: true},
        ]);
      }
      return null;
    });
    expect(
      getHeaderProviderDisplay('https://mempool.space/testnet/api'),
    ).toEqual({
      host: 'mempool.space/testnet',
      extraCount: 0,
      label: 'mempool.space/testnet',
    });
  });
});
