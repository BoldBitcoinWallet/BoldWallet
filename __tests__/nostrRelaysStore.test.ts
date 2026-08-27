/**
 * @format
 */

jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {getItem: jest.fn(), setItem: jest.fn()},
}));
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {set: jest.fn(), get: jest.fn()},
}));
jest.mock('../utils', () => ({
  getNostrRelays: jest.fn(async () => []),
  NOSTR_RELAY_DENYLIST: ['wss://nostr.oxtr.dev'],
}));

import {
  activeRelaysCSV,
  firstInvalidRelayUrl,
  parseRelayUrls,
  parseStoredRelayEntries,
  relayListSummary,
  urlsToEntries,
} from '../services/nostrRelaysStore';

describe('nostrRelaysStore', () => {
  it('parses CSV and newlines, de-dupes, and maps to enabled entries', () => {
    const urls = parseRelayUrls(
      'wss://a.example\nwss://b.example, wss://a.example',
    );
    expect(urls).toEqual(['wss://a.example', 'wss://b.example']);
    const entries = urlsToEntries(urls);
    expect(entries.every(e => e.enabled)).toBe(true);
    expect(activeRelaysCSV(entries)).toBe('wss://a.example,wss://b.example');
  });

  it('omits disabled relays from the MPC CSV', () => {
    const list = urlsToEntries(['wss://a.example', 'wss://b.example']);
    list[1].enabled = false;
    expect(activeRelaysCSV(list)).toBe('wss://a.example');
    expect(relayListSummary(list)).toBe('1 active · 1 off');
  });

  it('rejects URLs without ws/wss scheme', () => {
    expect(firstInvalidRelayUrl(['https://not-a-relay'])).toBe(
      'https://not-a-relay',
    );
    expect(firstInvalidRelayUrl(['wss://ok.example'])).toBeNull();
  });

  it('restores enabled flags from stored JSON', () => {
    const raw = JSON.stringify([
      {url: 'wss://a.example', enabled: true},
      {url: 'wss://b.example', enabled: false},
    ]);
    const parsed = parseStoredRelayEntries(raw);
    expect(parsed).toEqual([
      {url: 'wss://a.example', enabled: true},
      {url: 'wss://b.example', enabled: false},
    ]);
    expect(activeRelaysCSV(parsed ?? [])).toBe('wss://a.example');
  });
});
