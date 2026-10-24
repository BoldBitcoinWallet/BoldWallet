jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    dklsCancelMpcSession: jest.fn(),
    dklsCancelNostrMpc: jest.fn(),
    cancelMpcSession: jest.fn(),
    cancelNostrMpc: jest.fn(),
    requestSignCeremonyToken: jest.fn(),
    requestKeygenCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(),
    releaseCeremonyToken: jest.fn(),
    sha256: jest.fn(async (s: string) => `sha256(${s})`),
  },
}));

jest.mock('../services/tssBackend', () => ({
  resolveTssBackend: jest.fn(async () => 'dkls23'),
  resolveTssBackendForKeygen: jest.fn(),
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
  releaseCeremonyToken,
  requestSignCeremonyToken,
} from '../services/ceremonyAuth';
import {TssProvider} from '../services/TssProvider';

const native = BBMTLibNativeModule as any;

function authRejection() {
  return Object.assign(new Error('nope'), {code: 'CEREMONY_AUTH_REQUIRED'});
}

// ceremonyAuth session map persists across tests: every token a
// test registers is released here to keep tests hermetic.
const createdTokens: string[] = [];
afterEach(async () => {
  for (const t of createdTokens.splice(0)) {
    await releaseCeremonyToken(t).catch(() => undefined);
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  native.dklsCancelMpcSession.mockResolvedValue(null);
  native.dklsCancelNostrMpc.mockResolvedValue(null);
  native.requestSignCeremonyToken.mockResolvedValue('tok-cancel-fresh');
  native.requestKeygenCeremonyToken.mockResolvedValue('tok-cancel-kg');
  native.completeCeremonyToken.mockResolvedValue(true);
  native.releaseCeremonyToken.mockResolvedValue(true);
});

describe('3b-4 B19 cancel gating (F10-bridge)', () => {
  test('cancel reuses the live session token (no new prompt)', async () => {
    native.requestSignCeremonyToken.mockResolvedValueOnce('tok-live-1');
    const live = await requestSignCeremonyToken('sess-cancel-1');
    createdTokens.push(live);
    const res = await TssProvider.cancelMpcSession('sess-cancel-1');
    expect(res.outcome).toBe('cancelled');
    expect(native.dklsCancelMpcSession).toHaveBeenCalledWith(
      'sess-cancel-1',
      'tok-live-1',
    );
    // No second mint: the live token authorized the cancel.
    expect(native.requestSignCeremonyToken).toHaveBeenCalledTimes(1);
    // JS entry evicted after native consume+revoke.
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-live-1');
  });

  test('stale live token falls back to a fresh same-session mint', async () => {
    native.requestSignCeremonyToken.mockResolvedValueOnce('tok-stale-1');
    const stale = await requestSignCeremonyToken('sess-cancel-2');
    createdTokens.push(stale, 'tok-cancel-fresh');
    native.dklsCancelMpcSession
      .mockRejectedValueOnce(authRejection())
      .mockResolvedValueOnce(null);
    await TssProvider.cancelMpcSession('sess-cancel-2');
    expect(native.dklsCancelMpcSession).toHaveBeenNthCalledWith(
      1,
      'sess-cancel-2',
      'tok-stale-1',
    );
    // B19 stuck-cancel: fresh token for the SAME session re-auths.
    expect(native.requestSignCeremonyToken).toHaveBeenCalledWith(
      'sess-cancel-2',
    );
    expect(native.dklsCancelMpcSession).toHaveBeenNthCalledWith(
      2,
      'sess-cancel-2',
      'tok-cancel-fresh',
    );
  });

  test('no live token mints fresh directly (GG18/stuck path)', async () => {
    await TssProvider.cancelMpcSession('sess-cancel-3', 'keygen');
    expect(native.requestKeygenCeremonyToken).toHaveBeenCalledWith(
      'sess-cancel-3',
    );
    expect(native.requestSignCeremonyToken).not.toHaveBeenCalled();
    expect(native.dklsCancelMpcSession).toHaveBeenCalledWith(
      'sess-cancel-3',
      'tok-cancel-kg',
    );
    createdTokens.push('tok-cancel-kg');
  });

  test('non-auth cancel errors propagate without a mint', async () => {
    native.requestSignCeremonyToken.mockResolvedValueOnce('tok-live-4');
    const live = await requestSignCeremonyToken('sess-cancel-4');
    createdTokens.push(live);
    native.dklsCancelMpcSession.mockRejectedValueOnce(
      new Error('relay unreachable'),
    );
    await expect(
      TssProvider.cancelMpcSession('sess-cancel-4'),
    ).rejects.toThrow('relay unreachable');
    expect(native.requestSignCeremonyToken).toHaveBeenCalledTimes(1);
  });

  test('nostr cancel reuses the sole live ceremony token', async () => {
    native.requestSignCeremonyToken.mockResolvedValueOnce('tok-nostr-live');
    const live = await requestSignCeremonyToken('nostr-ceremony-1');
    createdTokens.push(live);
    await TssProvider.cancelNostrMpc();
    expect(native.dklsCancelNostrMpc).toHaveBeenCalledWith('tok-nostr-live');
    expect(native.requestSignCeremonyToken).toHaveBeenCalledTimes(1);
  });

  test('nostr cancel with nothing live mints a fresh cancel session', async () => {
    await TssProvider.cancelNostrMpc('keygen');
    expect(native.requestKeygenCeremonyToken).toHaveBeenCalledTimes(1);
    const freshSession =
      native.requestKeygenCeremonyToken.mock.calls[0][0] as string;
    expect(freshSession.startsWith('sha256(ceremony/cancel/')).toBe(true);
    expect(native.dklsCancelNostrMpc).toHaveBeenCalledWith('tok-cancel-kg');
    createdTokens.push('tok-cancel-kg');
  });
});
