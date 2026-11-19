/**
 * BrantaService tests — opt-in gating and SDK 4.x verify() wrapper.
 */

jest.mock('../utils', () => ({
  dbg: jest.fn(),
}));

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

jest.mock('../services/Database', () => ({
  __esModule: true,
  default: {
    execute: jest.fn(() => ({rows: []})),
  },
}));

const mockVerify = jest.fn();
const mockOnlineState = {value: true};

jest.mock(
  '@branta-ops/branta',
  () => ({
    BrantaEnvironment: {
      Production: 'Production',
      Staging: 'Staging',
      Localhost: 'Localhost',
    },
    createNobleCryptoProvider: jest.fn(() => ({})),
    BrantaService: jest.fn().mockImplementation(() => ({
      verify: mockVerify,
    })),
  }),
  {virtual: true},
);

jest.mock('../services/walletOnlineStore', () => ({
  isWalletOnline: () => mockOnlineState.value,
}));

jest.mock('../services/repositories/MerchantLabelRepository', () => ({
  __esModule: true,
  default: {
    backfillVerifiedTxsFromMerchantHistory: jest.fn(() => 2),
  },
}));

import database from '../services/Database';
import merchantLabelRepository from '../services/repositories/MerchantLabelRepository';
import appConfigRepository, {
  APP_CONFIG_KEYS_PRESERVED_ON_WALLET_DELETE,
  CONFIG_KEYS,
} from '../services/repositories/AppConfigRepository';
import {
  brantaZkParamLengths,
  initializeBranta,
  isBrantaEnabled,
  looksLikeBrantaVerifiableInput,
  resolveBrantaQr,
} from '../services/BrantaService';
import {runBrantaVerifiedBackfillIfNeeded} from '../services/BrantaVerifiedBackfill';

const mockExecute = database.execute as jest.Mock;
const mockBackfill =
  merchantLabelRepository.backfillVerifiedTxsFromMerchantHistory as jest.Mock;
const MockBrantaSdk = require('@branta-ops/branta').BrantaService as jest.Mock;
const {BrantaEnvironment} = require('@branta-ops/branta');

function setConfigRows(map: Record<string, string | null>) {
  mockExecute.mockImplementation((_sql: string, params: unknown[] = []) => {
    const key = params[0] as string | undefined;
    if (key && Object.prototype.hasOwnProperty.call(map, key)) {
      const value = map[key];
      return {rows: value == null ? [] : [{value}]};
    }
    return {rows: []};
  });
}

describe('Branta opt-in preference', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockReturnValue({rows: []});
    mockVerify.mockReset();
    MockBrantaSdk.mockClear();
    mockBackfill.mockClear();
    mockOnlineState.value = true;
  });

  test('CONFIG_KEYS.BRANTA_ENABLED is branta_enabled', () => {
    expect(CONFIG_KEYS.BRANTA_ENABLED).toBe('branta_enabled');
  });

  test('BRANTA_ENABLED is not preserved on wallet delete', () => {
    expect(APP_CONFIG_KEYS_PRESERVED_ON_WALLET_DELETE).not.toContain(
      CONFIG_KEYS.BRANTA_ENABLED,
    );
  });

  test('getBool default false when key is absent', () => {
    mockExecute.mockReturnValue({rows: []});
    expect(
      appConfigRepository.getBool(CONFIG_KEYS.BRANTA_ENABLED, false),
    ).toBe(false);
  });

  test('isBrantaEnabled is false when preference is absent', () => {
    mockExecute.mockReturnValue({rows: []});
    expect(isBrantaEnabled()).toBe(false);
  });

  test('isBrantaEnabled is true when stored as true', () => {
    mockExecute.mockReturnValue({rows: [{value: 'true'}]});
    expect(isBrantaEnabled()).toBe(true);
  });
});

describe('resolveBrantaQr', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockVerify.mockReset();
    MockBrantaSdk.mockClear();
    mockOnlineState.value = true;
  });

  test('returns unknown without calling SDK when disabled', async () => {
    mockExecute.mockReturnValue({rows: []});
    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({status: 'unknown'});
    expect(MockBrantaSdk).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('initializeBranta is a no-op when disabled', () => {
    mockExecute.mockReturnValue({rows: []});
    initializeBranta('mainnet');
    expect(MockBrantaSdk).not.toHaveBeenCalled();
  });

  test('uses Production for mainnet and Staging otherwise', () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    initializeBranta('mainnet');
    expect(MockBrantaSdk).toHaveBeenCalledWith(
      expect.objectContaining({environment: BrantaEnvironment.Production}),
    );
    MockBrantaSdk.mockClear();
    initializeBranta('testnet4');
    expect(MockBrantaSdk).toHaveBeenCalledWith(
      expect.objectContaining({environment: BrantaEnvironment.Staging}),
    );
  });

  test('returns incomplete when offline for Branta QR while enabled', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockOnlineState.value = false;
    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({status: 'incomplete'});
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('returns unknown when offline for plain address while enabled', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockOnlineState.value = false;
    const result = await resolveBrantaQr(
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      'mainnet',
    );
    expect(result).toEqual({status: 'unknown'});
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('looksLikeBrantaVerifiableInput detects ZK params and derived-key rails', () => {
    expect(
      looksLikeBrantaVerifiableInput(
        'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?branta_id=1&branta_secret=2',
      ),
    ).toBe(true);
    expect(looksLikeBrantaVerifiableInput('lnbc1something')).toBe(true);
    expect(
      looksLikeBrantaVerifiableInput(
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      ),
    ).toBe(false);
  });

  test('brantaZkParamLengths reports id and secret lengths without values', () => {
    expect(
      brantaZkParamLengths(
        'bitcoin:tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s?branta_id=abc123&branta_secret=sekrit',
      ),
    ).toEqual({qrLen: 88, idLen: 6, secretLen: 6});
  });

  test('returns match with address from matchedDestinations', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockVerify.mockResolvedValue({
      status: 'match',
      payments: [
        {
          platform: 'Test Shop',
          description: 'order',
          platformLogoUrl: 'https://example.com/logo.png',
          platformLogoLightUrl: 'https://example.com/logo-light.png',
        },
      ],
      matchedDestinations: [
        {
          type: 'bitcoin_address',
          value: 'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH',
        },
      ],
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.01&branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({
      status: 'match',
      payment: {
        address: 'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH',
        platform: 'Test Shop',
        description: 'order',
        logoUrl: 'https://example.com/logo.png',
        logoLightUrl: 'https://example.com/logo-light.png',
        verifyUrl: 'https://branta.pro/verify/test',
      },
    });
  });

  test('picks bitcoin_address from matchedDestinations when bolt11 sibling present', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockVerify.mockResolvedValue({
      status: 'match',
      payments: [
        {
          platform: 'Test Shop',
          description: 'order',
          platformLogoUrl: 'https://example.com/logo.png',
          platformLogoLightUrl: 'https://example.com/logo-light.png',
        },
      ],
      matchedDestinations: [
        {type: 'bolt11', value: 'lntb1invalidinvoice'},
        {
          type: 'bitcoin_address',
          value: 'tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s',
        },
      ],
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s?branta_id=1&branta_secret=2',
      'testnet4',
    );
    expect(result).toEqual({
      status: 'match',
      payment: {
        address: 'tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s',
        platform: 'Test Shop',
        description: 'order',
        logoUrl: 'https://example.com/logo.png',
        logoLightUrl: 'https://example.com/logo-light.png',
        verifyUrl: 'https://branta.pro/verify/test',
      },
    });
  });

  test('returns unknown for match without bitcoin_address', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockVerify.mockResolvedValue({
      status: 'match',
      payments: [{platform: 'LN Shop'}],
      matchedDestinations: [{type: 'bolt11', value: 'lntb1invalidinvoice'}],
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'lnbc1something?branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({status: 'unknown'});
  });

  test('returns unknown when SDK status is unknown', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockVerify.mockResolvedValue({
      status: 'unknown',
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({status: 'unknown'});
  });

  test('returns tampered when SDK status is tampered', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockVerify.mockResolvedValue({
      status: 'tampered',
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({status: 'tampered'});
  });

  test('returns incomplete when SDK status is incomplete', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockVerify.mockResolvedValue({
      status: 'incomplete',
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({status: 'incomplete'});
  });

  test('returns incomplete when verify throws', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockVerify.mockRejectedValue(new Error('crypto_unavailable'));

    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({status: 'incomplete'});
  });
});

describe('BrantaVerifiedBackfill gating', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockBackfill.mockClear();
  });

  test('skips backfill when Branta is disabled and does not mark done', async () => {
    mockExecute.mockReturnValue({rows: []});
    await runBrantaVerifiedBackfillIfNeeded();
    expect(mockBackfill).not.toHaveBeenCalled();
    const writes = mockExecute.mock.calls.filter(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.toLowerCase().includes('insert'),
    );
    expect(writes).toHaveLength(0);
  });

  test('runs backfill once when enabled and flag is absent', async () => {
    setConfigRows({
      [CONFIG_KEYS.BRANTA_ENABLED]: 'true',
      [CONFIG_KEYS.BRANTA_VERIFIED_BACKFILL_V1]: null,
    });
    await runBrantaVerifiedBackfillIfNeeded();
    expect(mockBackfill).toHaveBeenCalledTimes(1);
  });
});
