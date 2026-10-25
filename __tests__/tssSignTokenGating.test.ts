jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    dklsMpcSignPSBT: jest.fn(),
    dklsMpcSendBTCWithUTXOs: jest.fn(),
    dklsNostrMpcSendBTC: jest.fn(),
    dklsNostrMpcSignPSBT: jest.fn(),
    mpcSignPSBT: jest.fn(),
    mpcSendBTCWithUTXOs: jest.fn(),
    nostrMpcSendBTC: jest.fn(),
    nostrMpcSignPSBT: jest.fn(),
    requestSignCeremonyToken: jest.fn(),
    requestPsbtSignCeremonyToken: jest.fn(),
    requestSendSignCeremonyToken: jest.fn(),
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
  native.requestPsbtSignCeremonyToken.mockResolvedValue('tok-sign-1');
  native.requestSendSignCeremonyToken.mockResolvedValue('tok-sign-1');
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
    // F20: PSBT mints go through the native confirmation sheet,
    // bound to the exact PSBT being signed.
    expect(native.requestPsbtSignCeremonyToken).toHaveBeenCalledWith(
      'sess-1',
      'cHNidA==',
    );
    expect(native.requestSignCeremonyToken).not.toHaveBeenCalled();
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
    expect(native.requestPsbtSignCeremonyToken).not.toHaveBeenCalled();
    expect(native.dklsMpcSignPSBT).toHaveBeenCalledWith(
      ...SIGN_ARGS,
      'tok-owner-9',
    );
    expect(native.completeCeremonyToken).not.toHaveBeenCalled();
    expect(native.releaseCeremonyToken).not.toHaveBeenCalled();
  });

  test('mint failure (user cancel) never reaches the sign call', async () => {
    native.requestPsbtSignCeremonyToken.mockRejectedValueOnce(
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
    // F20-1b: sends mint via the native payment confirmation.
    expect(native.requestSendSignCeremonyToken).toHaveBeenCalledWith(
      'sess-send-2',
      'tb1qto',
      '1000',
      '10',
      'tb1qchange',
    );
    expect(native.requestSignCeremonyToken).not.toHaveBeenCalled();
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
    // F20: via the PSBT confirmation minter, with the PSBT bound.
    expect(native.requestPsbtSignCeremonyToken).toHaveBeenCalledTimes(1);
    expect(native.requestPsbtSignCeremonyToken.mock.calls[0][1]).toBe(
      'cHNidA==',
    );
    const mintedSession = native.requestPsbtSignCeremonyToken.mock.calls[0][0];
    expect(typeof mintedSession).toBe('string');
    expect(mintedSession.length).toBeGreaterThan(0);
    const call = native.dklsNostrMpcSignPSBT.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-sign-1');
  });

  test('GG18 mpcSignPSBT mints a sign token for its session (3b-6)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.mpcSignPSBT.mockResolvedValueOnce('signed-gg18');
    const out = await TssProvider.mpcSignPSBT(...SIGN_ARGS);
    expect(out).toBe('signed-gg18');
    expect(native.requestPsbtSignCeremonyToken).toHaveBeenCalledWith(
      'sess-1',
      'cHNidA==',
    );
    expect(native.mpcSignPSBT).toHaveBeenCalledWith(...SIGN_ARGS, 'tok-sign-1');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-sign-1');
  });

  test('GG18 mpcSendBTCWithUTXOs mints a sign token for its session (3b-6)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.mpcSendBTCWithUTXOs.mockResolvedValueOnce('txid-gg18');
    const out = await TssProvider.mpcSendBTCWithUTXOs(
      'srv',
      'p1',
      'p1,p2',
      'sess-gg18-send',
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
    expect(out).toBe('txid-gg18');
    expect(native.requestSendSignCeremonyToken).toHaveBeenCalledWith(
      'sess-gg18-send',
      'tb1qto',
      '1000',
      '10',
      'tb1qchange',
    );
    const call = native.mpcSendBTCWithUTXOs.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-sign-1');
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-sign-1');
  });

  test('GG18 nostrMpcSendBTC mints a fresh single-call ceremony (3b-6)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.nostrMpcSendBTC.mockResolvedValueOnce('txid-gg18-nostr');
    const out = await TssProvider.nostrMpcSendBTC(
      'wss://r',
      'npub1,npub2',
      'npub1,npub2',
      '5000',
      'tb1qto',
      '1000',
      '10',
      '[]',
      'tb1qchange',
    );
    expect(out).toBe('txid-gg18-nostr');
    expect(native.requestSendSignCeremonyToken).toHaveBeenCalledTimes(1);
    expect(native.requestSendSignCeremonyToken.mock.calls[0][1]).toBe(
      'tb1qto',
    );
    const call = native.nostrMpcSendBTC.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-sign-1');
  });

  test('GG18 nostrMpcSignPSBT mints a fresh single-call ceremony (3b-6)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.nostrMpcSignPSBT.mockResolvedValueOnce('signed-gg18-nostr');
    const out = await TssProvider.nostrMpcSignPSBT(
      'wss://r',
      'npub1,npub2',
      'npub1,npub2',
      'cHNidA==',
    );
    expect(out).toBe('signed-gg18-nostr');
    expect(native.requestPsbtSignCeremonyToken).toHaveBeenCalledTimes(1);
    expect(native.requestPsbtSignCeremonyToken.mock.calls[0][1]).toBe(
      'cHNidA==',
    );
    const call = native.nostrMpcSignPSBT.mock.calls[0];
    expect(call[call.length - 1]).toBe('tok-sign-1');
  });

  test('F20: unparsable PSBT (native confirmation rejects) never signs', async () => {
    native.requestPsbtSignCeremonyToken.mockRejectedValueOnce(
      Object.assign(new Error('Could not read this transaction.'), {
        code: 'CEREMONY_PSBT_INVALID',
      }),
    );
    await expect(TssProvider.mpcSignPSBT(...SIGN_ARGS)).rejects.toThrow(
      'Could not read this transaction.',
    );
    expect(native.dklsMpcSignPSBT).not.toHaveBeenCalled();
    expect(native.mpcSignPSBT).not.toHaveBeenCalled();
  });

  test('F20: user declining the native sheet mints nothing, never signs', async () => {
    native.requestPsbtSignCeremonyToken.mockRejectedValueOnce(
      Object.assign(new Error('auth required'), {
        code: 'CEREMONY_AUTH_REQUIRED',
      }),
    );
    await expect(TssProvider.mpcSignPSBT(...SIGN_ARGS)).rejects.toThrow();
    expect(native.dklsMpcSignPSBT).not.toHaveBeenCalled();
  });

  test('F20-1b: declining the payment confirmation never sends', async () => {
    native.requestSendSignCeremonyToken.mockRejectedValueOnce(
      Object.assign(new Error('auth required'), {
        code: 'CEREMONY_AUTH_REQUIRED',
      }),
    );
    await expect(
      TssProvider.mpcSendBTCWithUTXOs(
        'srv',
        'p1',
        'p1,p2',
        'sess-send-x',
        'sk',
        'ek',
        'dk',
        'btcpub',
        'tb1qto',
        '1000',
        '10',
        '[]',
        'tb1qchange',
      ),
    ).rejects.toThrow();
    expect(native.dklsMpcSendBTCWithUTXOs).not.toHaveBeenCalled();
    expect(native.mpcSendBTCWithUTXOs).not.toHaveBeenCalled();
  });

  test('GG18 mint failure never reaches the native call (3b-6)', async () => {
    resolveBackend.mockResolvedValueOnce('gg18');
    native.requestPsbtSignCeremonyToken.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), {
        code: 'CEREMONY_AUTH_REQUIRED',
      }),
    );
    await expect(TssProvider.mpcSignPSBT(...SIGN_ARGS)).rejects.toThrow();
    expect(native.mpcSignPSBT).not.toHaveBeenCalled();
  });
});
