/**
 * BrantaService tests — opt-in gating, address match, and SDK wrapper.
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

jest.mock('@branta-ops/branta', () => ({
  BrantaServerBaseUrl: {
    Production: 'https://api.branta.pro',
    Staging: 'https://staging.branta.pro',
  },
  createNobleCryptoProvider: jest.fn(() => ({})),
}), {virtual: true});

const mockGetPaymentsByQrCode = jest.fn();

jest.mock(
  '@branta-ops/branta/v2',
  () => ({
    BrantaService: jest.fn().mockImplementation(() => ({
      getPaymentsByQrCode: mockGetPaymentsByQrCode,
    })),
  }),
  {virtual: true},
);

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
  brantaOnChainAddressesMatch,
  initializeBranta,
  isBrantaEnabled,
  resolveBrantaQr,
} from '../services/BrantaService';
import {runBrantaVerifiedBackfillIfNeeded} from '../services/BrantaVerifiedBackfill';

const mockExecute = database.execute as jest.Mock;
const mockBackfill =
  merchantLabelRepository.backfillVerifiedTxsFromMerchantHistory as jest.Mock;
const MockBrantaSdk = require('@branta-ops/branta/v2').BrantaService as jest.Mock;

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
    mockGetPaymentsByQrCode.mockReset();
    MockBrantaSdk.mockClear();
    mockBackfill.mockClear();
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

describe('brantaOnChainAddressesMatch', () => {
  test('compares bech32 case-insensitively', () => {
    expect(
      brantaOnChainAddressesMatch(
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH',
      ),
    ).toBe(true);
  });

  test('rejects different bech32 addresses', () => {
    expect(
      brantaOnChainAddressesMatch(
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      ),
    ).toBe(false);
  });

  test('compares non-bech32 exactly', () => {
    expect(
      brantaOnChainAddressesMatch(
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      ),
    ).toBe(true);
    expect(
      brantaOnChainAddressesMatch(
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        '1a1zp1ep5qgefi2dmptftl5slmv7divfna',
      ),
    ).toBe(false);
  });

  test('compares testnet bech32 case-insensitively', () => {
    expect(
      brantaOnChainAddressesMatch(
        'tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s',
        'TB1QSHRA2MLUJC9WFSCVN4D8AQPYQGXZL55853XG7S',
      ),
    ).toBe(true);
  });
});

describe('resolveBrantaQr gating', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockGetPaymentsByQrCode.mockReset();
    MockBrantaSdk.mockClear();
  });

  test('returns null without calling SDK when disabled', async () => {
    mockExecute.mockReturnValue({rows: []});
    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toBeNull();
    expect(MockBrantaSdk).not.toHaveBeenCalled();
    expect(mockGetPaymentsByQrCode).not.toHaveBeenCalled();
  });

  test('initializeBranta is a no-op when disabled', () => {
    mockExecute.mockReturnValue({rows: []});
    initializeBranta('mainnet');
    expect(MockBrantaSdk).not.toHaveBeenCalled();
  });

  test('still shows merchant when SDK returned a payment (tamper is SDK-side)', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockGetPaymentsByQrCode.mockResolvedValue({
      payments: [
        {
          platform: 'Test Shop',
          description: 'order',
          platformLogoUrl: 'https://example.com/logo.png',
          platformLogoLightUrl: 'https://example.com/logo-light.png',
          destinations: [
            {value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'},
          ],
        },
      ],
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.01&branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result?.platform).toBe('Test Shop');
    expect(result?.address).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  });

  test('returns merchant payment when BIP-21 and decrypted bech32 match', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockGetPaymentsByQrCode.mockResolvedValue({
      payments: [
        {
          platform: 'Test Shop',
          description: 'order',
          platformLogoUrl: 'https://example.com/logo.png',
          platformLogoLightUrl: 'https://example.com/logo-light.png',
          destinations: [
            {value: 'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH'},
          ],
        },
      ],
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.01&branta_id=1&branta_secret=2',
      'mainnet',
    );
    expect(result).toEqual({
      address: 'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH',
      platform: 'Test Shop',
      description: 'order',
      logoUrl: 'https://example.com/logo.png',
      logoLightUrl: 'https://example.com/logo-light.png',
      verifyUrl: 'https://branta.pro/verify/test',
    });
  });

  test('returns merchant payment when lightning is listed before matching on-chain dest', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockGetPaymentsByQrCode.mockResolvedValue({
      payments: [
        {
          platform: 'Test Shop',
          description: 'order',
          platformLogoUrl: 'https://example.com/logo.png',
          platformLogoLightUrl: 'https://example.com/logo-light.png',
          destinations: [
            {type: 'bolt11', value: 'lntb1invalidinvoice'},
            {
              type: 'bitcoin_address',
              value: 'tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s',
            },
          ],
        },
      ],
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s?branta_id=1&branta_secret=2',
      'testnet3',
    );
    expect(result).toEqual({
      address: 'tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s',
      platform: 'Test Shop',
      description: 'order',
      logoUrl: 'https://example.com/logo.png',
      logoLightUrl: 'https://example.com/logo-light.png',
      verifyUrl: 'https://branta.pro/verify/test',
    });
  });

  test('uses typed on-chain dest for address even if listed after lightning', async () => {
    setConfigRows({[CONFIG_KEYS.BRANTA_ENABLED]: 'true'});
    mockGetPaymentsByQrCode.mockResolvedValue({
      payments: [
        {
          platform: 'Test Shop',
          destinations: [
            {type: 'bolt11', value: 'lntb1invalidinvoice'},
            {
              type: 'bitcoin_address',
              value: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
            },
          ],
        },
      ],
      verifyUrl: 'https://branta.pro/verify/test',
    });

    const result = await resolveBrantaQr(
      'bitcoin:tb1qshra2mlujc9wfscvn4d8aqpyqgxzl55853xg7s?branta_id=1&branta_secret=2',
      'testnet3',
    );
    expect(result?.platform).toBe('Test Shop');
    expect(result?.address).toBe(
      'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    );
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
