jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    dklsMpcSignPSBT: jest.fn(),
    dklsMpcSendBTCWithUTXOs: jest.fn(),
    dklsNostrMpcSendBTC: jest.fn(),
    dklsNostrMpcSignPSBT: jest.fn(),
    mpcSignPSBT: jest.fn(),
    requestSignCeremonyToken: jest.fn(),
    completeCeremonyToken: jest.fn(),
    releaseCeremonyToken: jest.fn(),
    sha256: jest.fn(async (s: string) => `sha256(${s})`),
  },
}));

jest.mock('../services/tssBackend', () => ({
  resolveTssBackend: jest.fn(),
  resolveTssBackendForKeygen: jest.fn(),
  detectKeyshareTssBackend: jest.fn(),
}));

jest.mock('../services/mpcCancel', () => ({
  markMpcInProgress: jest.fn(),
  resetMpcCancelState: jest.fn(),
  safeCancelMpc: jest.fn(),
}));

// 3b-2a: TssProvider -> ceremonyAuth -> utils (op-sqlite); stub the logger.
jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

import {BBMTLibNativeModule} from '../native_modules';
import {TssProvider} from '../services/TssProvider';
import {resolveTssBackend} from '../services/tssBackend';

const native = BBMTLibNativeModule as any;
const resolveBackend = resolveTssBackend as jest.Mock;

const SIGN_ARGS = [
  'srv',
  'p1',
  'p1,p2',
  'sess-1',
  'sk',
  'ek',
  'dk',
  'cHNidA==',
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  resolveBackend.mockResolvedValue('dkls23');
  native.requestSignCeremonyToken.mockResolvedValue('tok-sign-1');
  native.completeCeremonyToken.mockResolvedValue(true);
  native.releaseCeremonyToken.mockResolvedValue(true);
  native.dklsMpcSignPSBT.mockResolvedValue('signed-psbt');
  native.dklsMpcSendBTCWithUTXOs.mockResolvedValue('sent-txid');
  native.dklsNostrMpcSignPSBT.mockResolvedValue('signed-nostr-psbt');
});

describe('3b-2a sign token gating (F15b-2 / F10-bridge)', () => {
  test('mpcSignPSBT mints a sign token and passes it last', async () => {
    const out = await TssProvider.mpcSignPSBT(...SIGN_ARGS);
    expect(out).toBe('signed-psbt');
    expect(native.requestSignCeremonyToken).toHaveBeenCalledWith('sess-1');
    expect(native.dklsMpcSignPSBT).toHaveBeenCalledWith(
      ...SIGN_ARGS,
      'tok-sign-1',
    );
  });

  test('mpcSignPSBT completes the minted token on success', async () => {
    await TssProvider.mpcSignPSBT(...SIGN_ARGS);
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-sign-1');
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  test('mpcSignPSBT releases the minted token on native failure', async () => {
    native.dklsMpcSignPSBT.mockRejectedValueOnce(
      Object.assign(new Error('nope'), {code: 'DKLS_PSBT_LAN'}),
    );
    await expect(TssProvider.mpcSignPSBT(...SIGN_ARGS)).rejects.toThrow(
      'nope',
    );
    expect(native.releaseCeremonyToken).toHaveBeenCalledWith('tok-sign-1');
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
  });

  test('owner-provided token passes through with no mint or lifecycle', async () => {
    const out = await TssProvider.mpcSignPSBT(...SIGN_ARGS, 'tok-owner-9');
    expect(out).toBe('signed-psbt');
    expect(native.requestSignCeremonyToken).not.toHaveBeenCalled();
    expect(native.dklsMpcSignPSBT).toHaveBeenCalledWith(
      ...SIGN_ARGS,
      'tok-owner-9',
    );
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  test('mint failure (user cancel) never reaches the sign call', async () => {
    native.requestSignCeremonyToken.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), {
        code: 'CEREMONY_AUTH_REQUIRED',
      }),
    );
    await expect(TssProvider.mpcSignPSBT(...SIGN_ARGS)).rejects.toThrow();
    expect(native.dklsMpcSignPSBT).not.toHaveBeenCalled();
  });

  test('mpcSendBTCWithUTXOs mints for its session and passes token last', async () => {
    const out = await TssProvider.mpcSendBTCWithUTXOs(
      'srv',
      'p1',
      'p1,p2',
      'sess-send-2',
      'sk',
      'ek',
      'dk',
      'btcpub',
      'tb1qto',
      '1000',
      '10',
      '[]',
      'tb1qchange',
    );
    expect(out).toBe('sent-txid');
    expect(native.requestSignCeremonyToken).toHaveBeenCalledWith(
      'sess-send-2',
    );
    const call = native.dklsMpcSendBTCWithUTXOs.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-sign-1');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-sign-1');
  });

  test('nostrMpcSignPSBT mints a fresh single-call ceremony', async () => {
    const out = await TssProvider.nostrMpcSignPSBT(
      'wss://r',
      'npub1,npub2',
      'npub1,npub2',
      'cHNidA==',
    );
    expect(out).toBe('signed-nostr-psbt');
    // No MPC session on the call: wrapper mints a fresh ceremony ID.
    expect(native.requestSignCeremonyToken).toHaveBeenCalledTimes(1);
    const mintedSession = native.requestSignCeremonyToken.mock.calls[0][0];
    expect(typeof mintedSession).toBe('string');
    expect(mintedSession.length).toBeGreaterThan(0);
    const call = native.dklsNostrMpcSignPSBT.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-sign-1');
  });

  test('GG18 branch stays untokenized and mints nothing (F19 gap)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.mpcSignPSBT.mockResolvedValueOnce('signed-gg18');
    const out = await TssProvider.mpcSignPSBT(...SIGN_ARGS);
    expect(out).toBe('signed-gg18');
    expect(native.requestSignCeremonyToken).not.toHaveBeenCalled();
    expect(native.mpcSignPSBT).toHaveBeenCalledWith(...SIGN_ARGS);
  });
});
