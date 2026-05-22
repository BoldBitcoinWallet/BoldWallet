import {
  buildTxPreviewFromFeeEstimate,
  computeChangeSats,
  isLikelyPsbtChangeOutput,
  mapParsedPsbtDetails,
  isTestnetNetwork,
  networkLabel,
  psbtCollapsedSummaryLine,
  sat2btcStr,
  sendCollapsedRecapLine,
} from '../components/transactionFlowUtils';
import type {PsbtFlowDetails, TxPreview} from '../types/transactionFlow';

describe('transactionFlowUtils', () => {
  it('sat2btcStr formats sats to 8 decimal BTC', () => {
    expect(sat2btcStr(100_000_000)).toBe('1.00000000');
    expect(sat2btcStr('50000')).toBe('0.00050000');
  });

  it('computeChangeSats subtracts amount and fee from inputs', () => {
    const preview: TxPreview = {
      utxos: [],
      changeAddress: 'bc1qchange',
      changeAddressPath: "m/84'/0'/0'/1/0",
      totalInputSats: 200_000,
    };
    expect(computeChangeSats(preview, 150_000, 10_000)).toBe(40_000);
    expect(computeChangeSats(null, 150_000, 10_000)).toBe(0);
  });

  it('network helpers detect testnet', () => {
    expect(isTestnetNetwork('testnet')).toBe(true);
    expect(isTestnetNetwork('testnet3')).toBe(true);
    expect(isTestnetNetwork('mainnet')).toBe(false);
    expect(networkLabel('testnet')).toBe('Testnet');
    expect(networkLabel('mainnet')).toBe('Mainnet');
  });

  it('psbtCollapsedSummaryLine summarizes IO and fee', () => {
    const details: PsbtFlowDetails = {
      inputs: [{txid: 'aa', vout: 0, amount: 100_000}],
      outputs: [
        {address: 'bc1qrecipient', amount: 80_000},
        {address: 'bc1qchange', amount: 15_000},
      ],
      fee: 5_000,
      totalInput: 100_000,
      totalOutput: 95_000,
    };
    expect(psbtCollapsedSummaryLine(details)).toBe(
      '1 input → 2 outputs · fee 0.00005000 BTC',
    );
  });

  it('sendCollapsedRecapLine includes amount and shortened to address', () => {
    const line = sendCollapsedRecapLine(
      100_000_000,
      'bc1qabcdefghijklmnopqrstuvwxyz',
      addr => `${addr.slice(0, 4)}...${addr.slice(-4)}`,
    );
    expect(line).toContain('1.00000000 BTC');
    expect(line).toContain('bc1q...wxyz');
  });

  it('mapParsedPsbtDetails preserves output isChange and paths', () => {
    const mapped = mapParsedPsbtDetails({
      inputs: [{txid: 'a', vout: 0, amount: 1000, address: 'bc1qin'}],
      outputs: [
        {
          address: 'bc1qout',
          amount: 900,
          isChange: false,
          derivationPath: "m/84'/0'/0'/0/1",
        },
        {
          address: 'bc1qchg',
          amount: 50,
          isChange: true,
          derivationPath: "m/84'/0'/0'/1/0",
        },
      ],
      fee: 50,
      totalInput: 1000,
      totalOutput: 950,
      derivePaths: ["m/84'/0'/0'/0/0"],
      outputDerivePaths: ["m/84'/0'/0'/0/1", "m/84'/0'/0'/1/0"],
    });
    expect(mapped.outputs[1].isChange).toBe(true);
    expect(mapped.outputDerivePaths).toHaveLength(2);
  });

  it('buildTxPreviewFromFeeEstimate maps selected UTXOs', () => {
    const preview = buildTxPreviewFromFeeEstimate(
      {
        feeSats: 500,
        feeRate: 10,
        vbytes: 140,
        selectedUtxos: [
          {
            txid: 'tx1',
            vout: 0,
            address: 'bc1qa',
            network: 'mainnet',
            valueSats: 50_000,
            scriptPubkey: null,
            derivationPath: "m/84'/0'/0'/0/0",
            isConfirmed: true,
            blockHeight: null,
            blockTime: null,
            fetchedAt: 0,
          },
        ],
      },
      'bc1qchange',
      "m/84'/0'/0'/1/0",
    );
    expect(preview.utxos).toHaveLength(1);
    expect(preview.totalInputSats).toBe(50_000);
    expect(preview.changeAddress).toBe('bc1qchange');
  });

  it('isLikelyPsbtChangeOutput uses 10% heuristic', () => {
    expect(isLikelyPsbtChangeOutput(5_000, 100_000)).toBe(true);
    expect(isLikelyPsbtChangeOutput(50_000, 100_000)).toBe(false);
  });
});
