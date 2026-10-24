jest.mock('react-native', () => ({
  Alert: {alert: jest.fn()},
}));

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    setAPI: jest.fn(),
    setFeeAPIs: jest.fn(),
    requestConfigCeremonyToken: jest.fn(),
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

jest.mock('../services/walletOnlineStore', () => ({
  isWalletOnline: jest.fn(() => true),
}));

jest.mock('../services/repositories/AppConfigRepository', () => ({
  __esModule: true,
  default: {get: jest.fn()},
}));

// TssProvider/ceremonyAuth -> utils (op-sqlite); stub the logger.
jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

import {Alert} from 'react-native';
import {BBMTLibNativeModule} from '../native_modules';
import {
  defaultConfirmApiUrls,
  ensureFeeApisApplied,
  ensureMempoolApiApplied,
  isCeremonyAuthRejection,
} from '../services/apiConfigApply';
import {TssProvider} from '../services/TssProvider';

const native = BBMTLibNativeModule as any;
const alertMock = Alert.alert as jest.Mock;

function authRejection() {
  return Object.assign(new Error('nope'), {code: 'CEREMONY_AUTH_REQUIRED'});
}

beforeEach(() => {
  jest.clearAllMocks();
  native.setAPI.mockResolvedValue('ok');
  native.setFeeAPIs.mockResolvedValue('ok');
  native.requestConfigCeremonyToken.mockResolvedValue('tok-cfg-1');
  native.completeCeremonyToken.mockResolvedValue(true);
  native.releaseCeremonyToken.mockResolvedValue(true);
});

describe('3b-2d config gating (F10-bridge B15-B16)', () => {
  test('allowlisted URL applies silently with empty token', async () => {
    const out = await ensureMempoolApiApplied(
      'mainnet',
      'https://mempool.space/api',
    );
    expect(out).toBe('ok');
    expect(native.setAPI).toHaveBeenCalledWith(
      'mainnet',
      'https://mempool.space/api',
      '',
      '',
    );
    expect(native.requestConfigCeremonyToken).not.toHaveBeenCalled();
  });

  test('unknown URL: confirm + mint + retry with token, then complete', async () => {
    native.setAPI
      .mockRejectedValueOnce(authRejection())
      .mockResolvedValueOnce('ok-applied');
    const confirm = jest.fn(async () => true);
    const out = await ensureMempoolApiApplied(
      'mainnet',
      'https://custom.example/api',
      confirm,
    );
    expect(out).toBe('ok-applied');
    expect(confirm).toHaveBeenCalledWith(['https://custom.example/api']);
    expect(native.requestConfigCeremonyToken).toHaveBeenCalledTimes(1);
    expect(native.setAPI).toHaveBeenLastCalledWith(
      'mainnet',
      'https://custom.example/api',
      'tok-cfg-1',
      expect.any(String),
    );
    expect(native.completeCeremonyToken).toHaveBeenCalledWith('tok-cfg-1');
  });

  test('confirm deny throws without minting', async () => {
    native.setAPI.mockRejectedValue(authRejection());
    const confirm = jest.fn(async () => false);
    await expect(
      ensureMempoolApiApplied('mainnet', 'https://evil.example/api', confirm),
    ).rejects.toThrow('cancelled');
    expect(native.requestConfigCeremonyToken).not.toHaveBeenCalled();
  });

  test('denied URL short-circuits on retry (no repeat Alert)', async () => {
    native.setAPI.mockRejectedValue(authRejection());
    const confirm = jest.fn(async () => false);
    await expect(
      ensureMempoolApiApplied('mainnet', 'https://denied.example/api', confirm),
    ).rejects.toThrow();
    expect(confirm).toHaveBeenCalledTimes(1);
    await expect(
      ensureMempoolApiApplied('mainnet', 'https://denied.example/api', confirm),
    ).rejects.toThrow('denied');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test('null confirm mints directly (settings save, URL on screen)', async () => {
    native.setAPI
      .mockRejectedValueOnce(authRejection())
      .mockResolvedValueOnce('ok');
    const out = await ensureMempoolApiApplied(
      'mainnet',
      'https://typed.example/api',
      null,
    );
    expect(out).toBe('ok');
    expect(native.requestConfigCeremonyToken).toHaveBeenCalledTimes(1);
  });

  test('non-auth errors propagate without confirm or mint', async () => {
    native.setAPI.mockRejectedValue(new Error('native boom'));
    const confirm = jest.fn(async () => true);
    await expect(
      ensureMempoolApiApplied('mainnet', 'https://x.example/api', confirm),
    ).rejects.toThrow('native boom');
    expect(confirm).not.toHaveBeenCalled();
    expect(native.requestConfigCeremonyToken).not.toHaveBeenCalled();
  });

  test('concurrent same-URL applies share one approval', async () => {
    native.setAPI
      .mockRejectedValueOnce(authRejection())
      .mockResolvedValue('ok');
    const confirm = jest.fn(async () => true);
    const [a, b] = await Promise.all([
      ensureMempoolApiApplied('mainnet', 'https://race.example/api', confirm),
      ensureMempoolApiApplied('mainnet', 'https://race.example/api', confirm),
    ]);
    expect(a).toBe('ok');
    expect(b).toBe('ok');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(native.requestConfigCeremonyToken).toHaveBeenCalledTimes(1);
  });

  test('fee helper joins bases and applies silently when allowed', async () => {
    const out = await ensureFeeApisApplied([
      'https://mempool.space/api',
      'https://mempool.space/testnet4/api',
    ]);
    expect(out).toBe('ok');
    expect(native.setFeeAPIs).toHaveBeenCalledWith(
      'https://mempool.space/api,https://mempool.space/testnet4/api',
      '',
      '',
    );
  });

  test('fee helper confirms unknown hosts with the parsed list', async () => {
    native.setFeeAPIs
      .mockRejectedValueOnce(authRejection())
      .mockResolvedValueOnce('ok');
    const confirm = jest.fn(async () => true);
    await ensureFeeApisApplied(
      'https://mempool.space/api, https://fee.example/api',
      confirm,
    );
    expect(confirm).toHaveBeenCalledWith([
      'https://mempool.space/api',
      'https://fee.example/api',
    ]);
    expect(native.requestConfigCeremonyToken).toHaveBeenCalledTimes(1);
  });

  test('TssProvider.setAPI passes an explicit token through', async () => {
    await TssProvider.setAPI(
      'mainnet',
      'https://u.example/api',
      'tok-explicit',
      'sess-explicit',
    );
    expect(native.setAPI).toHaveBeenCalledWith(
      'mainnet',
      'https://u.example/api',
      'tok-explicit',
      'sess-explicit',
    );
  });

  test('default confirm resolves true on Approve, false on Cancel', async () => {
    const pApprove = defaultConfirmApiUrls(['https://u.example/api']);
    expect(alertMock).toHaveBeenCalledTimes(1);
    const buttons = alertMock.mock.calls[0][2] as Array<{
      text: string;
      onPress: () => void;
    }>;
    expect(alertMock.mock.calls[0][1]).toContain('https://u.example/api');
    buttons.find(b => b.text === 'Approve')!.onPress();
    await expect(pApprove).resolves.toBe(true);

    const pCancel = defaultConfirmApiUrls(['https://u.example/api']);
    const buttons2 = alertMock.mock.calls[1][2] as Array<{
      text: string;
      onPress: () => void;
    }>;
    buttons2.find(b => b.text === 'Cancel')!.onPress();
    await expect(pCancel).resolves.toBe(false);
  });

  test('isCeremonyAuthRejection matches code only', () => {
    expect(isCeremonyAuthRejection(authRejection())).toBe(true);
    expect(isCeremonyAuthRejection(new Error('x'))).toBe(false);
    expect(isCeremonyAuthRejection(null)).toBe(false);
  });
});
