import * as fs from 'fs';
import * as path from 'path';

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    dklsMpcSignPSBT: jest.fn(),
    dklsMpcSendBTCWithUTXOs: jest.fn(),
    dklsNostrMpcSendBTC: jest.fn(),
    dklsNostrMpcSignPSBT: jest.fn(),
    dklsMpcTssSetup: jest.fn(),
    dklsNostrMpcTssSetup: jest.fn(),
    mpcSignPSBT: jest.fn(),
    mpcSendBTCWithUTXOs: jest.fn(),
    nostrMpcSendBTC: jest.fn(),
    nostrMpcSignPSBT: jest.fn(),
    mpcTssSetup: jest.fn(),
    nostrMpcTssSetup: jest.fn(),
    nostrKeypair: jest.fn(),
    eciesKeypair: jest.fn(),
    publishData: jest.fn(),
    fetchData: jest.fn(),
    setAPI: jest.fn(),
    setFeeAPIs: jest.fn(),
    importBackupToStagedHandle: jest.fn(),
    persistStoredKeyshare: jest.fn(),
    backupEncryptStoredKeyshare: jest.fn(),
    dklsCancelMpcSession: jest.fn(),
    dklsCancelNostrMpc: jest.fn(),
    cancelMpcSession: jest.fn(),
    cancelNostrMpc: jest.fn(),
    requestSignCeremonyToken: jest.fn(),
    requestKeygenCeremonyToken: jest.fn(),
    requestExportCeremonyToken: jest.fn(),
    requestImportCeremonyToken: jest.fn(),
    requestConfigCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(),
    releaseCeremonyToken: jest.fn(),
    sha256: jest.fn(async (s: string) => `sha256(${s})`),
    getKeyshareMetadataJSON: jest.fn(),
  },
}));

jest.mock('../services/tssBackend', () => ({
  resolveTssBackend: jest.fn(async () => 'dkls23'),
  resolveTssBackendForKeygen: jest.fn(async () => 'dkls23'),
  detectKeyshareTssBackend: jest.fn(),
}));

jest.mock('../services/mpcCancel', () => ({
  markMpcInProgress: jest.fn(),
  resetMpcCancelState: jest.fn(),
  safeCancelMpc: jest.fn(async (_kind: string, invoke: () => unknown) => {
    await invoke();
    return {outcome: 'cancelled'};
  }),
}));

// TssProvider -> ceremonyAuth -> utils (op-sqlite); stub the logger.
jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

import {BBMTLibNativeModule} from '../native_modules';
import {
  findLiveCeremonyToken,
  getSessionToken,
  releaseCeremonyToken,
  requestKeygenCeremonyToken,
  requestSignCeremonyToken,
} from '../services/ceremonyAuth';
import {TssProvider} from '../services/TssProvider';
import {
  resolveTssBackend,
  resolveTssBackendForKeygen,
} from '../services/tssBackend';

const native = BBMTLibNativeModule as any;
const root = path.join(__dirname, '..');

function authRejection(): Error {
  return Object.assign(new Error('denied'), {code: 'CEREMONY_AUTH_REQUIRED'});
}

// ---------------------------------------------------------------------------
// Strict-native simulator: mirrors the native gate contract (class +
// session binding per method). Real enforcement lives natively
// (JVM/harness negative tests); this stub proves the JS layer only
// ever produces calls the gate accepts, and that malicious shapes
// fail closed.
// ---------------------------------------------------------------------------
type MintEntry = {op: string; session: string};
const mintRegistry = new Map<string, MintEntry>();
const approvedUrls = new Set<string>([
  'https://mempool.space/api',
  'https://mempool.space/testnet4/api',
]);

function mintStub(op: string) {
  return jest.fn(async (session: string) => {
    const token = `tok-${op}-${session}`;
    mintRegistry.set(token, {op, session});
    return token;
  });
}

function gate(
  token: unknown,
  allowedOps: string[],
  callSession?: unknown,
): void {
  if (typeof token !== 'string' || token === '') {
    throw authRejection();
  }
  const entry = mintRegistry.get(token);
  if (!entry || !allowedOps.includes(entry.op)) {
    throw authRejection();
  }
  if (callSession !== undefined && entry.session !== callSession) {
    throw authRejection();
  }
}

function last<T>(args: unknown[]): T {
  return args[args.length - 1] as T;
}

function installStrictNative(): void {
  mintRegistry.clear();
  native.requestSignCeremonyToken.mockImplementation(mintStub('sign'));
  native.requestKeygenCeremonyToken.mockImplementation(mintStub('keygen'));
  native.requestExportCeremonyToken.mockImplementation(mintStub('export'));
  native.requestImportCeremonyToken.mockImplementation(mintStub('import'));
  native.requestConfigCeremonyToken.mockImplementation(mintStub('config'));
  native.completeCeremonyToken.mockResolvedValue(true);
  native.releaseCeremonyToken.mockResolvedValue(true);
  native.getKeyshareMetadataJSON.mockResolvedValue('{"pub_key":"03aa"}');

  native.dklsMpcSignPSBT.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign'], a[3]);
    return 'signed-psbt';
  });
  native.dklsMpcSendBTCWithUTXOs.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign'], a[3]);
    return 'txid';
  });
  native.dklsNostrMpcSendBTC.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign']);
    return 'txid';
  });
  native.dklsNostrMpcSignPSBT.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign']);
    return 'signed';
  });
  native.dklsMpcTssSetup.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['keygen'], a[3]);
    return JSON.stringify({handle: 'h', metadata: {pub_key: 'aa'}});
  });
  native.dklsNostrMpcTssSetup.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['keygen'], a[3]);
    return JSON.stringify({handle: 'h', metadata: {pub_key: 'aa'}});
  });
  // 3b-6: GG18 branches mirror the DKLs gate contract. Note the GG18
  // server setup arg shape carries ppmFile at index 2, so its
  // sessionID sits at index 4 (DKLs twin: index 3).
  native.mpcSignPSBT.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign'], a[3]);
    return 'signed-gg18';
  });
  native.mpcSendBTCWithUTXOs.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign'], a[3]);
    return 'txid-gg18';
  });
  native.nostrMpcSendBTC.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign']);
    return 'txid-gg18';
  });
  native.nostrMpcSignPSBT.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign']);
    return 'signed-gg18';
  });
  native.mpcTssSetup.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['keygen'], a[4]);
    return '{"pub_key":"bb"}';
  });
  native.nostrMpcTssSetup.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['keygen'], a[3]);
    return '{"pub_key":"cc"}';
  });
  native.nostrKeypair.mockImplementation(async (...a: unknown[]) => {
    gate(a[0], ['keygen']);
    return '{"npub":"npub1x"}';
  });
  native.eciesKeypair.mockImplementation(async (...a: unknown[]) => {
    gate(a[0], ['keygen']);
    return '{"pub":"aa"}';
  });
  native.publishData.mockImplementation(async (...a: unknown[]) => {
    gate(a[a.length - 2], ['sign', 'keygen'], last(a));
    return 'published';
  });
  native.fetchData.mockImplementation(async (...a: unknown[]) => {
    gate(a[a.length - 2], ['sign', 'keygen'], last(a));
    return 'fetched';
  });
  const apiGate = async (...a: unknown[]) => {
    const urls =
      typeof a[0] === 'string' && a.length > 3
        ? [a[1] as string] // setAPI(network, url, token, session)
        : (a[0] as string).split(',').map(s => s.trim()).filter(Boolean);
    const token = a[a.length - 2];
    const session = last(a);
    if (urls.every(u => approvedUrls.has(u.replace(/\/+$/, '')))) {
      return 'ok';
    }
    gate(token, ['config'], session);
    urls.forEach(u => approvedUrls.add(u.replace(/\/+$/, '')));
    return 'ok';
  };
  native.setAPI.mockImplementation(apiGate);
  native.setFeeAPIs.mockImplementation(apiGate);
  native.importBackupToStagedHandle.mockImplementation(
    async (...a: unknown[]) => {
      gate(a[a.length - 2], ['import'], last(a));
      return JSON.stringify({handle: 'h', metadata: {pub_key: 'aa'}});
    },
  );
  native.persistStoredKeyshare.mockImplementation(async (...a: unknown[]) => {
    gate(a[a.length - 2], ['import'], last(a));
    return '{"pub_key":"aa"}';
  });
  native.backupEncryptStoredKeyshare.mockImplementation(
    async (...a: unknown[]) => {
      gate(last(a), ['export']);
      return 'BW2$blob';
    },
  );
  native.dklsCancelMpcSession.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign', 'keygen'], a[0]);
    return null;
  });
  native.cancelMpcSession.mockImplementation(async (...a: unknown[]) => {
    gate(last(a), ['sign', 'keygen'], a[0]);
    return null;
  });
  native.dklsCancelNostrMpc.mockImplementation(async (...a: unknown[]) => {
    gate(a[0], ['sign', 'keygen']);
    return null;
  });
  native.cancelNostrMpc.mockImplementation(async (...a: unknown[]) => {
    gate(a[0], ['sign', 'keygen']);
    return null;
  });
}

const createdTokens: string[] = [];
afterEach(async () => {
  for (const t of createdTokens.splice(0)) {
    await releaseCeremonyToken(t).catch(() => undefined);
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  installStrictNative();
});

describe('3b-5 L5 malicious-JS simulation (F10-bridge)', () => {
  test('direct sign call without a token fails closed', async () => {
    await expect(
      native.dklsMpcSignPSBT('s', 'p', 'pp', 'sess', 'sk', 'ek', 'dk', 'psbt'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(
      native.dklsMpcSignPSBT(
        's',
        'p',
        'pp',
        'sess',
        'sk',
        'ek',
        'dk',
        'psbt',
        'tok-forged-1',
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
  });

  test('cross-class replay fails closed (sign token on export, export on sign)', async () => {
    const signTok = await requestSignCeremonyToken('sess-x');
    createdTokens.push(signTok);
    await expect(
      native.backupEncryptStoredKeyshare('pw', signTok),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    // And the legitimate export wrapper mints its own class (no reuse).
    native.requestExportCeremonyToken.mockClear();
    await TssProvider.backupEncryptStoredKeyshare('pw');
    expect(native.requestExportCeremonyToken).toHaveBeenCalledTimes(1);
  });

  test('cross-session replay fails closed (session-A token on session-B call)', async () => {
    const tokA = await requestSignCeremonyToken('sess-A');
    createdTokens.push(tokA);
    await expect(
      TssProvider.mpcSignPSBT(
        's',
        'p',
        'pp',
        'sess-B',
        'sk',
        'ek',
        'dk',
        'psbt',
        tokA,
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    // Owner token: no lifecycle meddling on failure.
    expect(native.releaseCeremonyToken).not.toHaveBeenCalledWith(tokA);
  });

  test('GG18: unsigned direct calls fail closed on all 6 branches (3b-6)', async () => {
    await expect(
      native.mpcSignPSBT('s', 'p', 'pp', 'sess', 'sk', 'ek', 'dk', 'psbt'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(
      native.mpcSignPSBT(
        's',
        'p',
        'pp',
        'sess',
        'sk',
        'ek',
        'dk',
        'psbt',
        'tok-forged-1',
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(
      native.mpcSendBTCWithUTXOs(
        's',
        'p',
        'pp',
        'sess',
        'sk',
        'ek',
        'dk',
        'pub',
        'to',
        '1',
        '1',
        '[]',
        'ch',
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(
      native.nostrMpcSendBTC(
        'r',
        'np',
        'np',
        '5',
        'to',
        '1',
        '1',
        '[]',
        'ch',
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(
      native.nostrMpcSignPSBT('r', 'np', 'np', 'psbt'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(
      native.mpcTssSetup('s', 'p', 'ppm', 'pp', 'sess', 'sk', 'ek', 'dk', 'cc'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(
      native.nostrMpcTssSetup('r', 'nsec', 'np', 'sess', 'sk', 'cc', 'ppm'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
  });

  test('GG18: wrong-class token fails on sign and setup (3b-6)', async () => {
    const keygenTok = await requestKeygenCeremonyToken('sess-gg18-x');
    createdTokens.push(keygenTok);
    (resolveTssBackend as jest.Mock).mockResolvedValueOnce('gg18');
    await expect(
      TssProvider.mpcSignPSBT(
        's',
        'p',
        'pp',
        'sess-gg18-x',
        'sk',
        'ek',
        'dk',
        'psbt',
        keygenTok,
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    const signTok = await requestSignCeremonyToken('sess-gg18-y');
    createdTokens.push(signTok);
    (resolveTssBackendForKeygen as jest.Mock).mockResolvedValueOnce('gg18');
    await expect(
      TssProvider.mpcTssSetup(
        's',
        'p',
        'ppm',
        'pp',
        'sess-gg18-y',
        'sk',
        'ek',
        'dk',
        'cc',
        undefined,
        undefined,
        signTok,
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
  });

  test('GG18: wrong-session token fails with no owner-token lifecycle (3b-6)', async () => {
    const tokA = await requestSignCeremonyToken('sess-GG18-A');
    createdTokens.push(tokA);
    (resolveTssBackend as jest.Mock).mockResolvedValueOnce('gg18');
    await expect(
      TssProvider.mpcSignPSBT(
        's',
        'p',
        'pp',
        'sess-GG18-B',
        'sk',
        'ek',
        'dk',
        'psbt',
        tokA,
      ),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    expect(native.releaseCeremonyToken).not.toHaveBeenCalledWith(tokA);
  });

  test('GG18: valid token succeeds via provider (sign + setup) (3b-6)', async () => {
    (resolveTssBackend as jest.Mock).mockResolvedValueOnce('gg18');
    const signed = await TssProvider.mpcSignPSBT(
      's',
      'p',
      'pp',
      'sess-gg18-ok',
      'sk',
      'ek',
      'dk',
      'psbt',
    );
    expect(signed).toBe('signed-gg18');
    expect(native.completeCeremonyToken).toHaveBeenCalledTimes(1);
    (resolveTssBackendForKeygen as jest.Mock).mockResolvedValueOnce('gg18');
    const setup = await TssProvider.mpcTssSetup(
      's',
      'p',
      'ppm',
      'pp',
      'sess-gg18-kg',
      'sk',
      'ek',
      'dk',
      'cc',
    );
    expect(setup.kind).toBe('legacy-gg18');
    expect(native.completeCeremonyToken).toHaveBeenCalledTimes(2);
    // GG18 server-setup arg shape: ppmFile sits at index 2, so the
    // session the native gate binds is at index 4 (DKLs twin: 3).
    // Pinned by assertion — if the order drifts, the gate binds
    // the wrong value and this fails before production does.
    const setupCall = native.mpcTssSetup.mock.calls[0];
    expect(setupCall[4]).toBe('sess-gg18-kg');
    const signCall = native.mpcSignPSBT.mock.calls[0];
    expect(signCall[3]).toBe('sess-gg18-ok');
  });

  test('every unsigned direct call across the gated surface fails closed', async () => {
    await expect(native.dklsMpcTssSetup('s', 'p', 'pp', 'x', 'sk', 'ek', 'dk', 'cc')).rejects.toMatchObject({
      code: 'CEREMONY_AUTH_REQUIRED',
    });
    await expect(native.nostrKeypair()).rejects.toMatchObject({
      code: 'CEREMONY_AUTH_REQUIRED',
    });
    await expect(native.eciesKeypair('')).rejects.toMatchObject({
      code: 'CEREMONY_AUTH_REQUIRED',
    });
    await expect(
      native.publishData('1', '2', 'e', 'r', 'duo'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(native.fetchData('u', 'd', 'c')).rejects.toMatchObject({
      code: 'CEREMONY_AUTH_REQUIRED',
    });
    await expect(
      native.importBackupToStagedHandle('b', 'p'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    await expect(native.persistStoredKeyshare('h', '', '')).rejects.toMatchObject(
      {code: 'CEREMONY_AUTH_REQUIRED'},
    );
    await expect(native.backupEncryptStoredKeyshare('pw')).rejects.toMatchObject(
      {code: 'CEREMONY_AUTH_REQUIRED'},
    );
    await expect(native.dklsCancelMpcSession('sess')).rejects.toMatchObject({
      code: 'CEREMONY_AUTH_REQUIRED',
    });
    await expect(native.dklsCancelNostrMpc()).rejects.toMatchObject({
      code: 'CEREMONY_AUTH_REQUIRED',
    });
  });

  test('config: evil URL without token fails; wrong-class token fails; config token approves', async () => {
    await expect(
      native.setAPI('mainnet', 'https://evil.example/api', '', ''),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    const signTok = await requestSignCeremonyToken('sess-cfg');
    createdTokens.push(signTok);
    await expect(
      native.setAPI('mainnet', 'https://evil.example/api', signTok, 'sess-cfg'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
    // Seed URLs pass silently with empty token.
    await expect(
      native.setAPI('mainnet', 'https://mempool.space/api', '', ''),
    ).resolves.toBe('ok');
  });

  test('cancel with an export token fails closed', async () => {
    await expect(
      native.dklsCancelMpcSession('sess', 'tok-export-sess'),
    ).rejects.toMatchObject({code: 'CEREMONY_AUTH_REQUIRED'});
  });

  test('no JS-reachable generic minter exists (source-text)', () => {
    const read = (rel: string) =>
      fs.readFileSync(path.join(root, rel), 'utf8');
    const auth = read('services/ceremonyAuth.ts');
    // Exactly the 5 per-ceremony mint entries; no generic minter.
    expect(
      (auth.match(/export function request(Sign|Keygen|Export|Import|Config)CeremonyToken\(/g) ??
        []).length,
    ).toBe(5);
    expect(auth).not.toMatch(/export (async )?function requestCeremonyToken\(/);
    const provider = read('services/TssProvider.ts');
    expect(provider).not.toMatch(/requestCeremonyToken\(/);
    // Native: exactly 5 mint entry points per platform.
    const kt = read('android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt');
    expect(
      (kt.match(/fun request(Sign|Keygen|Export|Import|Config)CeremonyToken/g) ??
        []).length,
    ).toBe(5);
    const swift = read('ios/BBMTLibNativeModule.swift').replace(
      /#if DEBUG[\s\S]*?#endif/g,
      '',
    );
    expect(
      (swift.match(/func request(Sign|Keygen|Export|Import|Config)CeremonyToken/g) ??
        []).length,
    ).toBe(5);
  });

  test('all 25 gated methods carry ceremonyToken on both platforms (source-text)', () => {
    const methods = [
      'mpcSignPSBT',
      'mpcSendBTCWithUTXOs',
      'nostrMpcSendBTC',
      'nostrMpcSignPSBT',
      'mpcTssSetup',
      'nostrMpcTssSetup',
      'dklsMpcSignPSBT',
      'dklsMpcSendBTCWithUTXOs',
      'dklsNostrMpcSendBTC',
      'dklsNostrMpcSignPSBT',
      'dklsMpcTssSetup',
      'dklsNostrMpcTssSetup',
      'nostrKeypair',
      'eciesKeypair',
      'publishData',
      'fetchData',
      'setAPI',
      'setFeeAPIs',
      'importBackupToStagedHandle',
      'persistStoredKeyshare',
      'backupEncryptStoredKeyshare',
      'cancelMpcSession',
      'cancelNostrMpc',
      'dklsCancelMpcSession',
      'dklsCancelNostrMpc',
    ];
    const read = (rel: string) =>
      fs.readFileSync(path.join(root, rel), 'utf8');
    const kt = read(
      'android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt',
    );
    const swift = read('ios/BBMTLibNativeModule.swift');
    const m = read('ios/BBMTLibNativeModule.m');
    for (const name of methods) {
      // Kotlin + Swift declarations take the token…
      expect(kt).toMatch(new RegExp(`fun ${name}\\(`));
      const ktDecl = kt.slice(
        kt.indexOf(`fun ${name}(`),
        kt.indexOf(`fun ${name}(`) + 600,
      );
      expect(ktDecl).toContain('ceremonyToken');
      expect(swift).toMatch(new RegExp(`func ${name}\\(`));
      const swiftDecl = swift.slice(
        swift.indexOf(`func ${name}(`),
        swift.indexOf(`func ${name}(`) + 600,
      );
      expect(swiftDecl).toContain('ceremonyToken');
      // …the .m export exposes it (except no-arg-impossible shapes)…
      expect(m).toContain(name);
      // 1100: the 14-param GG18 mpcSendBTCWithUTXOs extern places
      // ceremonyToken ~830 chars in; the 800-char window truncated it.
      const mDecl = m.slice(m.indexOf(name), m.indexOf(name) + 1100);
      expect(mDecl).toContain('ceremonyToken');
      // …and each side verifies (or decides/consumes) before work.
      expect(ktDecl + swiftDecl).toMatch(
        /CeremonyTokens\.(verify|verifySingleCall|verifyTransport|cancelConsume)|CeremonyApiAllowlist\.decide|gateApiUrls/,
      );
    }
  });

  test('round-trip: setup → persist → read → sign leaves no live tokens', async () => {
    // Setup (own mint) → staged.
    const setup = await TssProvider.mpcTssSetup(
      'srv',
      'p1',
      'ppm',
      'p1,p2',
      'sess-rt-1',
      'sk',
      'ek',
      'dk',
      'cc',
    );
    expect(setup.kind).toBe('staged');
    // Persist (own mint) → metadata.
    const meta = await TssProvider.persistStoredKeyshare('h', '', '');
    expect(JSON.parse(meta).pub_key).toBe('aa');
    // Metadata read needs no ceremony.
    const md = await native.getKeyshareMetadataJSON();
    expect(JSON.parse(md).pub_key).toBe('03aa');
    // Sign (own mint) → signature.
    const sig = await TssProvider.mpcSignPSBT(
      's',
      'p',
      'pp',
      'sess-rt-1',
      'sk',
      'ek',
      'dk',
      'psbt',
    );
    expect(sig).toBe('signed-psbt');
    // Cancel after completion re-auths via fresh mint (stuck path).
    const mintCalls = (native.requestSignCeremonyToken as jest.Mock).mock
      .calls.length;
    await TssProvider.cancelMpcSession('sess-rt-1');
    expect(
      (native.requestSignCeremonyToken as jest.Mock).mock.calls.length,
    ).toBe(mintCalls + 1);
    // No live session entries leak.
    expect(findLiveCeremonyToken()).toBeUndefined();
    expect(getSessionToken('sess-rt-1')).toBeUndefined();
  });

  test('backgrounding revokes nothing: no lifecycle revocation wiring (source-text)', () => {
    const read = (rel: string) =>
      fs.readFileSync(path.join(root, rel), 'utf8');
    for (const rel of [
      'services/ceremonyAuth.ts',
      'services/TssProvider.ts',
      'android/app/src/main/java/com/boldwallet/CeremonyTokens.kt',
      'ios/CeremonyTokens.swift',
    ]) {
      const text = read(rel);
      expect(text).not.toMatch(/AppState|onBackground|didEnterBackground|ON_PAUSE|onPause|applicationDidEnterBackground/);
    }
    // Tokens terminate only via the 4 named paths.
    const kt = read('android/app/src/main/java/com/boldwallet/CeremonyTokens.kt');
    expect(kt).toMatch(/fun complete\(/);
    expect(kt).toMatch(/fun release\(/);
    expect(kt).toMatch(/fun revokeSession\(/);
    expect(kt).toMatch(/fun cancelConsume\(/);
  });

  test('kill-mid-session recovers nothing: tokens are memory-only (source-text)', () => {
    const read = (rel: string) =>
      fs.readFileSync(path.join(root, rel), 'utf8');
    // The only persisted ceremony-adjacent store holds API URLs, never tokens.
    const ktStore = read(
      'android/app/src/main/java/com/boldwallet/CeremonyApiAllowlist.kt',
    );
    const storeBlock = ktStore.slice(
      ktStore.indexOf('interface Store'),
      ktStore.indexOf('fun isAllowed'),
    );
    expect(storeBlock).not.toMatch(/[Tt]oken/);
    expect(storeBlock).toMatch(/urls/);
    const ktModule = read(
      'android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt',
    );
    expect(ktModule).toMatch(/getStringSet\("urls"/);
    expect(ktModule).toMatch(/putStringSet\("urls"/);
    // No token is written to encrypted storage, keychain, prefs, or disk anywhere.
    for (const rel of [
      'android/app/src/main/java/com/boldwallet/BBMTLibNativeModule.kt',
      'ios/BBMTLibNativeModule.swift',
      'services/ceremonyAuth.ts',
    ]) {
      const text = read(rel);
      expect(text).not.toMatch(
        /EncryptedStorage\.setItem\([^)]*[Tt]oken|setSecureItem\([^)]*[Tt]oken|UserDefaults.*[Cc]eremony[Tt]oken|getSharedPreferences\([^)]*[Tt]oken/,
      );
    }
  });
});
