import {
  feeFromValues,
  inspectRbfTx,
  minReplacementFeeSats,
  planCancel,
  planSpeedUp,
  quoteReplacement,
  type ChainTx,
  type RbfEligibility,
} from '../services/rbfBuilder';

jest.mock('../utils', () => ({dbg: jest.fn()}));
jest.mock('../services/repositories/UtxoRepository', () => ({
  __esModule: true,
  default: {getUtxosForNetwork: jest.fn(() => [])},
}));
jest.mock('react-native', () => ({
  NativeModules: {BBMTLibNativeModule: {}},
}));

const PATHS: Record<string, {derivationPath: string}> = {
  tb1qsender: {derivationPath: "m/84'/1'/0'/0/0"},
  tb1qchange: {derivationPath: "m/84'/1'/0'/1/0"},
};

function stuckTx(overrides: Partial<ChainTx> = {}): ChainTx {
  return {
    txid: '11'.repeat(32),
    fee: 1000,
    weight: 400,
    status: {confirmed: false},
    vin: [
      {
        txid: 'aa'.repeat(32),
        vout: 0,
        sequence: 0xfffffffd,
        prevout: {
          scriptpubkey_address: 'tb1qsender',
          scriptpubkey: '0014aa',
          value: 100_000,
        },
      },
    ],
    vout: [
      {scriptpubkey_address: 'tb1qrecipient', value: 90_000},
      {scriptpubkey_address: 'tb1qchange', value: 9_000},
    ],
    ...overrides,
  };
}

function eligible(): RbfEligibility {
  const result = inspectRbfTx(stuckTx(), PATHS);
  if (!result.eligible) {
    throw new Error(result.reason);
  }
  return result;
}

describe('rbfBuilder', () => {
  it('rejects a confirmed, non-signaling, or foreign-input transaction', () => {
    expect(inspectRbfTx(stuckTx({status: {confirmed: true}}), PATHS).eligible).toBe(
      false,
    );
    expect(
      inspectRbfTx(
        stuckTx({
          vin: [
            {
              txid: 'aa'.repeat(32),
              vout: 0,
              sequence: 0xfffffffe,
              prevout: {
                scriptpubkey_address: 'tb1qsender',
                scriptpubkey: '0014aa',
                value: 100_000,
              },
            },
          ],
        }),
        PATHS,
      ).reason,
    ).toMatch(/replace-by-fee/);
    expect(
      inspectRbfTx(stuckTx(), {tb1qchange: PATHS.tb1qchange}).reason,
    ).toMatch(/not from this wallet/);
  });

  it('computes the BIP125 minimum replacement fee', () => {
    expect(minReplacementFeeSats(1000, 100, 100)).toBe(1100);
    expect(minReplacementFeeSats(1000, 100, 140, 500)).toBe(1000 + 500 + 140);
  });

  it('speeds up by shrinking the existing change output', () => {
    const plan = planSpeedUp({
      eligibility: eligible(),
      feeSats: 2000,
      addressType: 'segwit-native',
      extraUtxos: [],
      freshChangeAddress: null,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.amountSats).toBe(90_000);
    expect(plan.toAddress).toBe('tb1qrecipient');
    expect(plan.feeSats).toBe(2000);
    expect(plan.changeAddress).toBe('tb1qchange');
    expect(plan.skipChangeIndexBump).toBe(true);
    expect(plan.utxos).toHaveLength(1);
    expect(plan.utxos[0].required).toBe(true);
  });

  it('adds a confirmed coin when the send spent the whole input', () => {
    const maxed = inspectRbfTx(
      stuckTx({
        fee: 1000,
        vout: [{scriptpubkey_address: 'tb1qrecipient', value: 99_000}],
      }),
      PATHS,
    );
    const plan = planSpeedUp({
      eligibility: maxed,
      feeSats: 3000,
      addressType: 'segwit-native',
      extraUtxos: [
        {
          txid: 'bb'.repeat(32),
          vout: 1,
          value: 50_000,
          address: 'tb1qsender',
          derivationPath: "m/84'/1'/0'/0/1",
          scriptpubkey: '0014bb',
        },
      ],
      freshChangeAddress: 'tb1qfresh',
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.addedInput).toBe(true);
    expect(plan.utxos.map(u => u.txid)).toEqual([
      'aa'.repeat(32),
      'bb'.repeat(32),
    ]);
    expect(plan.changeAddress).toBe('tb1qfresh');
    expect(plan.skipChangeIndexBump).toBe(false);
    expect(plan.amountSats).toBe(99_000);
  });

  it('cancels by returning every input minus the new fee', () => {
    const plan = planCancel({
      eligibility: eligible(),
      feeSats: 3000,
      selfAddress: 'tb1qsender',
      addressType: 'segwit-native',
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toAddress).toBe('tb1qsender');
    expect(plan.amountSats).toBe(97_000);
    expect(plan.changeAddress).toBeNull();
    expect(plan.skipChangeIndexBump).toBe(true);
    expect(plan.utxos[0].required).toBe(true);
  });

  it('can bump again from the replacement it just planned', () => {
    const first = planSpeedUp({
      eligibility: eligible(),
      feeSats: 2000,
      addressType: 'segwit-native',
      extraUtxos: [],
      freshChangeAddress: null,
    });
    if (!first.ok) {
      throw new Error(first.reason);
    }
    const again = inspectRbfTx(
      stuckTx({
        txid: '22'.repeat(32),
        fee: first.feeSats,
        weight: first.vsize * 4,
        vout: [
          {scriptpubkey_address: 'tb1qrecipient', value: first.amountSats},
          {
            scriptpubkey_address: 'tb1qchange',
            value: 100_000 - first.amountSats - first.feeSats,
          },
        ],
      }),
      PATHS,
    );
    const second = planSpeedUp({
      eligibility: again,
      feeSats: 4000,
      addressType: 'segwit-native',
      extraUtxos: [],
      freshChangeAddress: null,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.feeSats).toBe(4000);
    expect(second.utxos[0].txid).toBe('aa'.repeat(32));
  });

  it('uses the fee implied by inputs and outputs when the stored fee is short', () => {
    const tx = stuckTx({fee: 100});
    expect(feeFromValues(tx)).toBe(1000);
    expect(inspectRbfTx(tx, PATHS).origFee).toBe(1000);
  });

  it('speeds up a one-output self-send by reducing that output', () => {
    const self = inspectRbfTx(
      stuckTx({
        vout: [{scriptpubkey_address: 'tb1qsender', value: 99_000}],
      }),
      PATHS,
    );
    expect(self.shrinkRecipient).toBe(true);
    const plan = planSpeedUp({
      eligibility: self,
      feeSats: 2000,
      addressType: 'segwit-native',
      extraUtxos: [],
      freshChangeAddress: null,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.amountSats).toBe(98_000);
    expect(plan.toAddress).toBe('tb1qsender');
    expect(plan.addedInput).toBe(false);
    expect(plan.changeAddress).toBeNull();
  });

  it('quotes the same fee the builder signs, with and without an extra coin', () => {
    const same = quoteReplacement({
      mode: 'speedup',
      eligibility: eligible(),
      rate: 20,
      addressType: 'segwit-native',
      extraUtxos: [],
      freshChangeAddress: null,
      selfAddress: 'tb1qsender',
    });
    const sameBuilt = planSpeedUp({
      eligibility: eligible(),
      feeSats: same.feeSats,
      addressType: 'segwit-native',
      extraUtxos: [],
      freshChangeAddress: null,
    });
    expect(same.plan.ok && sameBuilt.ok && sameBuilt.feeSats).toBe(same.feeSats);

    const maxed = inspectRbfTx(
      stuckTx({vout: [{scriptpubkey_address: 'tb1qrecipient', value: 99_000}]}),
      PATHS,
    );
    const extra = [
      {
        txid: 'bb'.repeat(32),
        vout: 1,
        value: 50_000,
        address: 'tb1qsender',
        derivationPath: "m/84'/1'/0'/0/1",
        scriptpubkey: '0014bb',
      },
    ];
    const bumped = quoteReplacement({
      mode: 'speedup',
      eligibility: maxed,
      rate: 30,
      addressType: 'segwit-native',
      extraUtxos: extra,
      freshChangeAddress: 'tb1qfresh',
      selfAddress: 'tb1qsender',
    });
    const bumpedBuilt = planSpeedUp({
      eligibility: maxed,
      feeSats: bumped.feeSats,
      addressType: 'segwit-native',
      extraUtxos: extra,
      freshChangeAddress: 'tb1qfresh',
    });
    expect(bumped.plan.ok && bumpedBuilt.ok && bumpedBuilt.feeSats).toBe(
      bumped.feeSats,
    );
    if (bumped.plan.ok) {
      expect(bumped.plan.addedInput).toBe(true);
    }
  });

  it('asks for a change address with a flag rather than matching text', () => {
    const maxed = inspectRbfTx(
      stuckTx({vout: [{scriptpubkey_address: 'tb1qrecipient', value: 99_000}]}),
      PATHS,
    );
    const plan = planSpeedUp({
      eligibility: maxed,
      feeSats: 3000,
      addressType: 'segwit-native',
      extraUtxos: [
        {
          txid: 'bb'.repeat(32),
          vout: 1,
          value: 50_000,
          address: 'tb1qsender',
          derivationPath: "m/84'/1'/0'/0/1",
          scriptpubkey: '0014bb',
        },
      ],
      freshChangeAddress: null,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.needsChangeAddress).toBe(true);
  });

  it('refuses a speed up whose fee exceeds the payment', () => {
    const plan = planSpeedUp({
      eligibility: eligible(),
      feeSats: 90_001,
      addressType: 'segwit-native',
      extraUtxos: [],
      freshChangeAddress: null,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.suggestCancel).toBe(true);
  });
});
