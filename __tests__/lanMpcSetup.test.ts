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
  default: {clear: jest.fn()},
}));
jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    getBool: jest.fn(),
  },
}));

import {
  buildLanRelayServerUrl,
  coalesceLanHost,
  isIPv4LanHost,
  isLanMpcRelayProbeResponse,
  isLanPeerDiscoveryPayload,
  normalizeLanHost,
  resolveDuoLanRoles,
  resolveEffectiveLanKeygenContext,
  resolveLanKeygenParties,
  resolveLanSigningParties,
  resolveDklsLanSigningPartiesFromKeyshare,
  resolveDklsNostrSigningParties,
  resolveGg18LanSigningPartiesFromKeyshare,
  resolveTrioLanRoles,
  isTrioWalletKeyshare,
  TRIO_PARTIES_CSV,
} from '../services/lanMpcSetup';

describe('isLanPeerDiscoveryPayload', () => {
  it('rejects native timeout error strings', () => {
    expect(
      isLanPeerDiscoveryPayload('error:peer discovery timed out after 5 seconds'),
    ).toBe(false);
  });

  it('accepts a valid duo discovery line', () => {
    const payload =
      '192.168.1.10:55155@48656c6c6f@npub1abc,192.168.1.20:55155@6c6f63616c';
    expect(isLanPeerDiscoveryPayload(payload)).toBe(true);
  });
});

describe('isIPv4LanHost', () => {
  it('rejects error token mistaken as host', () => {
    expect(isIPv4LanHost('error')).toBe(false);
    expect(normalizeLanHost('error')).toBeNull();
  });
});

describe('coalesceLanHost', () => {
  it('falls back to getLanIp when discovery packet omits local IP', () => {
    expect(coalesceLanHost('', '192.168.1.42')).toBe('192.168.1.42');
    expect(coalesceLanHost(undefined, null, '10.0.0.5')).toBe('10.0.0.5');
  });

  it('prefers first valid candidate', () => {
    expect(coalesceLanHost('192.168.1.10', '192.168.1.20')).toBe('192.168.1.10');
  });
});

describe('normalizeLanHost', () => {
  it('strips scheme and port', () => {
    expect(normalizeLanHost('http://192.168.1.10:55155/foo')).toBe(
      '192.168.1.10',
    );
    expect(normalizeLanHost('192.168.1.20:55155')).toBe('192.168.1.20');
  });

  it('rejects empty and 0.0.0.0', () => {
    expect(normalizeLanHost('')).toBeNull();
    expect(normalizeLanHost('0.0.0.0')).toBeNull();
  });
});

describe('resolveTrioLanRoles', () => {
  it('assigns KeyShare1 to highest last octet regardless of input order', () => {
    const a = resolveTrioLanRoles({
      localIP: '192.168.0.5',
      peerIP: '192.168.0.50',
      peerIP2: '192.168.0.12',
    });
    expect(a.masterHost).toBe('192.168.0.50');
    expect(a.ipByRole.KeyShare1).toBe('192.168.0.50');
    expect(a.localParty).toBe('KeyShare3');

    const b = resolveTrioLanRoles({
      localIP: '192.168.0.50',
      peerIP: '192.168.0.5',
      peerIP2: '192.168.0.12',
    });
    expect(b.isMaster).toBe(true);
    expect(b.localParty).toBe('KeyShare1');
    expect(b.masterHost).toBe('192.168.0.50');
  });

  it('produces unique roles for three distinct IPs', () => {
    const r = resolveTrioLanRoles({
      localIP: '10.0.0.1',
      peerIP: '10.0.0.2',
      peerIP2: '10.0.0.3',
    });
    const roles = new Set([r.localParty, r.peerParty, r.peerParty2]);
    expect(roles.size).toBe(3);
    expect(r.masterHost).toBe('10.0.0.3');
  });
});

describe('resolveDuoLanRoles', () => {
  it('elects master by higher last octet', () => {
    const r = resolveDuoLanRoles('192.168.1.20', '192.168.1.10');
    expect(r.isMaster).toBe(true);
    expect(r.masterHost).toBe('192.168.1.20');
  });
});

describe('isTrioWalletKeyshare', () => {
  it('detects trio from committee length', () => {
    expect(
      isTrioWalletKeyshare({
        keygen_committee_keys: ['a', 'b', 'c'],
      }),
    ).toBe(true);
    expect(isTrioWalletKeyshare({keygen_committee_keys: ['a', 'b']})).toBe(
      false,
    );
  });
});

describe('resolveDklsLanSigningPartiesFromKeyshare', () => {
  it('maps npub committee to KeyShare3 + peer KeyShare1 (not LAN IP roles)', () => {
    const meta = {
      local_party_key: 'npubCarol',
      keygen_committee_keys: ['npubAlice', 'npubBob', 'npubCarol'],
    };
    const r = resolveDklsLanSigningPartiesFromKeyshare(meta, 'npubAlice');
    expect(r.partyID).toBe('KeyShare3');
    expect(r.peerParty).toBe('KeyShare1');
    expect(r.partiesCSV).toBe('KeyShare1,KeyShare3');
  });

  it('uses local_party_key when already in KeyShare committee', () => {
    const meta = {
      local_party_key: 'KeyShare2',
      keygen_committee_keys: ['KeyShare1', 'KeyShare2', 'KeyShare3'],
    };
    const r = resolveDklsLanSigningPartiesFromKeyshare(meta, 'KeyShare1');
    expect(r.partyID).toBe('KeyShare2');
    expect(r.peerParty).toBe('KeyShare1');
    expect(r.partiesCSV).toBe('KeyShare1,KeyShare2');
  });

  it('throws when local and peer resolve to the same KeyShare', () => {
    expect(() =>
      resolveDklsLanSigningPartiesFromKeyshare(
        {
          local_party_key: 'KeyShare1',
          keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
        },
        'KeyShare1',
      ),
    ).toThrow(/two different key shares/i);
  });
});

describe('resolveDklsNostrSigningParties', () => {
  it('builds sorted 2-npub CSV for native keysign', () => {
    const r = resolveDklsNostrSigningParties('npub1bbb', 'npub1aaa', {
      keygen_committee_keys: ['npub1aaa', 'npub1bbb', 'npub1ccc'],
    });
    expect(r.partiesNpubsCSV).toBe('npub1aaa,npub1bbb');
    expect(r.localNpub).toBe('npub1bbb');
    expect(r.peerNpub).toBe('npub1aaa');
  });

  it('throws when local and peer npubs match', () => {
    expect(() =>
      resolveDklsNostrSigningParties('npub1same', 'npub1same', null),
    ).toThrow(/two different devices/i);
  });
});

describe('resolveGg18LanSigningPartiesFromKeyshare', () => {
  it('uses keyshare local_party_key not IP-derived KeyShare slot', () => {
    const meta = {
      local_party_key: 'KeyShare2',
      keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
    };
    const r = resolveGg18LanSigningPartiesFromKeyshare(meta, {
      peerParty: 'KeyShare1',
      peerCommitteeKey: 'npubPeerShouldIgnoreForLanGg18',
    });
    expect(r.partyID).toBe('KeyShare2');
    expect(r.partiesCSV).toBe('KeyShare1,KeyShare2');
  });

  it('uses npub committee keys for Nostr-origin GG18 wallets', () => {
    const meta = {
      local_party_key: 'npub1alice',
      keygen_committee_keys: ['npub1alice', 'npub1bob'],
    };
    const r = resolveGg18LanSigningPartiesFromKeyshare(meta, {
      peerCommitteeKey: 'npub1bob',
      peerParty: 'KeyShare1',
    });
    expect(r.partyID).toBe('npub1alice');
    expect(r.partiesCSV).toBe('npub1alice,npub1bob');
  });
});

describe('resolveLanSigningParties', () => {
  it('trio 2-of-3 spend: exactly two KeyShares in CSV (local + one peer)', () => {
    const r = resolveLanSigningParties({
      localParty: 'KeyShare3',
      peerParty: 'KeyShare1',
      peerParty2: 'KeyShare2',
    });
    expect(r.partyID).toBe('KeyShare3');
    expect(r.partiesCSV).toBe('KeyShare1,KeyShare3');
    expect(r.partiesCSV.split(',')).toHaveLength(2);
  });

  it('throws when local and peer roles match', () => {
    expect(() =>
      resolveLanSigningParties({
        localParty: 'KeyShare1',
        peerParty: 'KeyShare1',
      }),
    ).toThrow(/two different key shares/i);
  });
});

describe('resolveEffectiveLanKeygenContext', () => {
  const appConfigRepository = require('../services/repositories/AppConfigRepository')
    .default as {get: jest.Mock; getBool: jest.Mock};

  beforeEach(() => {
    appConfigRepository.get.mockReturnValue(null);
    appConfigRepository.getBool.mockImplementation((key: string) => {
      if (key === 'lan_is_master') {
        return true;
      }
      if (key === 'lan_is_trio') {
        return false;
      }
      return false;
    });
  });

  it('uses live isMaster state instead of stale persisted master flag', () => {
    appConfigRepository.get.mockImplementation((key: string) => {
      if (key === 'lan_local_party') {
        return 'KeyShare2';
      }
      if (key === 'lan_peer_party') {
        return 'KeyShare1';
      }
      if (key === 'lan_master_host') {
        return '192.168.1.10';
      }
      return null;
    });
    const ctx = resolveEffectiveLanKeygenContext({
      setupMode: 'duo',
      state: {
        isMaster: false,
        masterHost: '192.168.1.10',
        localParty: 'KeyShare2',
        peerParty: 'KeyShare1',
        peerParty2: null,
      },
    });
    expect(ctx.isMaster).toBe(false);
    expect(ctx.localParty).toBe('KeyShare2');
  });
});

describe('resolveLanKeygenParties', () => {
  it('uses fixed trio CSV', () => {
    const r = resolveLanKeygenParties({
      isTrio: true,
      isMaster: false,
      localParty: 'KeyShare2',
    });
    expect(r.partiesCSV).toBe(TRIO_PARTIES_CSV);
    expect(r.partyID).toBe('KeyShare2');
  });

  it('throws when trio local party is missing', () => {
    expect(() =>
      resolveLanKeygenParties({
        isTrio: true,
        isMaster: false,
        localParty: '',
      }),
    ).toThrow(/party role is missing/i);
  });
});

describe('buildLanRelayServerUrl', () => {
  it('builds http URL without path', () => {
    expect(buildLanRelayServerUrl('192.168.1.5', 55155)).toBe(
      'http://192.168.1.5:55155',
    );
  });
});

describe('isLanMpcRelayProbeResponse', () => {
  it('accepts 404 from MPC relay getSession', () => {
    expect(isLanMpcRelayProbeResponse(404)).toBe(true);
  });

  it('rejects 401 from publish handshake server', () => {
    expect(isLanMpcRelayProbeResponse(401)).toBe(false);
  });
});
