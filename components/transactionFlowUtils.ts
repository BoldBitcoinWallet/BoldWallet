import Big from 'big.js';
import type {PsbtFlowDetails, TxPreview} from '../types/transactionFlow';
import type {FeeEstimate} from '../services/feeUtils';

export function sat2btcStr(sats?: string | number): string {
  return Big(sats || 0)
    .div(1e8)
    .toFixed(8);
}

export function computeChangeSats(
  txPreview: TxPreview | null | undefined,
  satoshiAmount: string | number,
  satoshiFees: string | number,
): number {
  if (!txPreview || txPreview.totalInputSats <= 0) {
    return 0;
  }
  return (
    txPreview.totalInputSats -
    Number(satoshiAmount) -
    Number(satoshiFees)
  );
}

export function isTestnetNetwork(net?: string): boolean {
  return net === 'testnet3' || net === 'testnet';
}

export function networkLabel(net?: string): string {
  return isTestnetNetwork(net) ? 'Testnet' : 'Mainnet';
}

export function networkForApi(net?: string): string {
  if (isTestnetNetwork(net)) {
    return 'testnet3';
  }
  if (net === 'mainnet') {
    return 'mainnet';
  }
  return net || 'mainnet';
}

export function isLikelyPsbtChangeOutput(
  outputAmount: number,
  totalInput: number,
): boolean {
  return totalInput > 0 && outputAmount < totalInput * 0.1;
}

export function psbtCollapsedSummaryLine(details: PsbtFlowDetails): string {
  const inN = details.inputs.length;
  const outN = details.outputs.length;
  return `${inN} input${inN !== 1 ? 's' : ''} → ${outN} output${
    outN !== 1 ? 's' : ''
  } · fee ${sat2btcStr(details.fee)} BTC`;
}

/** Normalize JSON from BBMTLib ParsePSBTDetails. */
export function mapParsedPsbtDetails(raw: {
  inputs?: PsbtFlowDetails['inputs'];
  outputs?: Array<{
    address: string;
    amount: number;
    isChange?: boolean;
    derivationPath?: string;
  }>;
  fee?: number;
  totalInput?: number;
  totalOutput?: number;
  derivePaths?: string[];
  outputDerivePaths?: string[];
}): PsbtFlowDetails {
  return {
    inputs: raw.inputs || [],
    outputs: (raw.outputs || []).map(o => ({
      address: o.address,
      amount: o.amount,
      isChange: o.isChange,
      derivationPath: o.derivationPath,
    })),
    fee: raw.fee || 0,
    totalInput: raw.totalInput || 0,
    totalOutput: raw.totalOutput || 0,
    derivePaths: raw.derivePaths || [],
    outputDerivePaths: raw.outputDerivePaths || [],
  };
}

export function buildTxPreviewFromFeeEstimate(
  result: FeeEstimate,
  changeAddress: string,
  changeAddressPath = '',
): TxPreview {
  const utxos = result.selectedUtxos.map(u => ({
    address: u.address,
    value: u.valueSats,
    derivationPath: u.derivationPath ?? '',
  }));
  return {
    utxos,
    changeAddress,
    changeAddressPath,
    totalInputSats: utxos.reduce((s, u) => s + u.value, 0),
  };
}

export function sendCollapsedRecapLine(
  satoshiAmount: string | number,
  toAddress: string,
  shorten: (addr: string) => string,
): string {
  return `Sending ${sat2btcStr(satoshiAmount)} BTC to ${shorten(toAddress)}`;
}
