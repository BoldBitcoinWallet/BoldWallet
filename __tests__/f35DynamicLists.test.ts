// F35: unsigned GitHub-raw endpoint/relay lists (pinned + validated).
// utils -> Database chain pulls ESM-only @op-engineering/op-sqlite,
// which jest cannot parse. Stub it (this suite tests list fetching
// and validation only, never the DB).
jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(),
}));
jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));
jest.mock('react-native-encrypted-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../App', () => ({
  isDebugLoggingEnabled: () => false,
}));
jest.mock('../services/LocalCache', () => ({
  __esModule: true,
  default: {getItem: jest.fn(), setItem: jest.fn()},
}));

import LocalCache from '../services/LocalCache';
import {
  fetchDynamicAPIEndpoints,
  fetchDynamicNostrRelays,
  getMainnetAPIList,
  getNostrRelays,
} from '../utils';

const cache = LocalCache as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
};

const PIN =
  'b94706d435c6d70b00867605f96892c4a5d1e545';

function mockFetchOnce(text: string, ok = true): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    text: async () => text,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = jest.fn(async () => ({ok: false}));
  cache.getItem.mockResolvedValue(null);
  cache.setItem.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('F35 pinned dynamic lists', () => {
  test('API fetch uses the pinned commit URL', async () => {
    mockFetchOnce('- https://mempool.space\n');
    const out = await fetchDynamicAPIEndpoints();
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(
      `/mempool-space-hosts/${PIN}/README.md`,
    );
    expect(out).toEqual(['https://mempool.space/api']);
  });

  test('malicious API content cannot redirect: non-mempool/http hosts dropped', async () => {
    mockFetchOnce(
      [
        '- https://evil.com/?x=mempool',
        '- http://plain.mempool.example',
        '- https://mempool.space',
        '- https://benpool.mempool.space/',
      ].join('\n'),
    );
    const out = await getMainnetAPIList();
    // javascript:/ws: schemes never match the https extractor;
    // http: and wrong-host URLs fail hostname validation.
    expect(out).toEqual([
      'https://mempool.space/api',
      'https://benpool.mempool.space/api',
    ]);
  });

  test('oversized API body fails closed to the hardcoded fallback', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => 'x'.repeat(64 * 1024 + 1),
    });
    expect(await getMainnetAPIList()).toEqual([
      'https://mempool.space/api',
    ]);
  });

  test('relay fetch uses the pinned commit and drops non-wss', async () => {
    mockFetchOnce(
      [
        '- wss://bbw-nostr.xyz',
        '- wss://nostr.hifish.org',
        '- ws://plain.example/x',
      ].join('\n'),
    );
    const out = await fetchDynamicNostrRelays();
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(
      `/mempool-space-hosts/${PIN}/NOSTR.md`,
    );
    expect(out).toEqual([
      'wss://bbw-nostr.xyz',
      'wss://nostr.hifish.org',
    ]);
  });

  test('relay fallback stays on defaults (denylist applied separately)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ok: false});
    const out = await getNostrRelays(true);
    expect(out).toContain('wss://bbw-nostr.xyz');
    expect(out).toContain('wss://nostr.hifish.org');
    expect(out).toContain('wss://nostr.xxi.quest');
    expect(out).not.toContain('wss://nostr.oxtr.dev');
  });

  test('poisoned relay cache is re-validated, not trusted', async () => {
    cache.getItem.mockResolvedValue(
      'wss://bbw-nostr.xyz,https://evil.com/relay,ws://plain/x',
    );
    const out = await getNostrRelays(false);
    expect(out).toEqual(['wss://bbw-nostr.xyz']);
    // No refetch needed: one valid cached entry short-circuits.
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
