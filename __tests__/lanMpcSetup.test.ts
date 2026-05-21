import {
  buildLanRelayServerUrl,
  isLanMpcRelayProbeResponse,
  normalizeLanHost,
  resolveDuoLanRoles,
  resolveLanKeygenParties,
  resolveTrioLanRoles,
  TRIO_PARTIES_CSV,
} from '../services/lanMpcSetup';

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
