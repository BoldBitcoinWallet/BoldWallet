export type UtxoPreview = {
  address: string;
  value: number;
  derivationPath: string;
};

export type TxPreview = {
  utxos: UtxoPreview[];
  changeAddress: string;
  changeAddressPath: string;
  totalInputSats: number;
};

export type PsbtFlowInput = {
  txid: string;
  vout: number;
  amount: number;
  /** Present when ParsePSBTDetails extracts witness/non-witness prevout address. */
  address?: string;
};

export type PsbtFlowOutput = {
  address: string;
  amount: number;
  /** Set from PSBT output Bip32Derivation (change chain) or fee heuristic. */
  isChange?: boolean;
  derivationPath?: string;
};

export type PsbtFlowDetails = {
  inputs: PsbtFlowInput[];
  outputs: PsbtFlowOutput[];
  fee: number;
  totalInput: number;
  totalOutput: number;
  /** Per-input derivation paths (legacy field name). */
  derivePaths?: string[];
  /** Per-output derivation paths when present in PSBT. */
  outputDerivePaths?: string[];
};

export type SendFlowParams = {
  satoshiAmount: string | number;
  satoshiFees: string | number;
  toAddress: string;
  network?: string;
  selectedCurrency?: string;
  fiatAmount?: string;
  fiatFees?: string;
};

export type CollapsedSummaryMode = 'full' | 'minimal' | 'none';
// 'full' — pairing screens: To/fee strip when collapsed
// 'none' — always expanded body (PSBTModal)
