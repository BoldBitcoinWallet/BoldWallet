/**
 * BIP125 replace-by-fee plans for a stuck outgoing transaction.
 *
 * The signed transaction still goes through the existing send pipeline, which
 * emits one payment output and an optional change output. Every coin in the
 * returned list is marked required so both phones hash and sign the same set.
 */
import {NativeModules} from 'react-native';
import utxoRepository, {type StoredUtxo} from './repositories/UtxoRepository';
import {scriptPubKeyFromAddress} from '../utils/scriptPubKeyFromAddress';
import {dbg} from '../utils';

const {BBMTLibNativeModule} = NativeModules;

export const RBF_SEQUENCE_LOCK = 0xfffffffe;
export const DUST_SATS = 546;

const INPUT_WU: Record<string, number> = {
  taproot: 230,
  'segwit-native': 272,
  'segwit-compatible': 720,
  segwit: 720,
  legacy: 592,
};
const OUTPUT_WU: Record<string, number> = {
  taproot: 136,
  'segwit-native': 124,
  'segwit-compatible': 128,
  segwit: 128,
  legacy: 136,
};
const TX_OVERHEAD_WU = 48;

export interface ChainVin {
  txid?: string;
  vout?: number;
  sequence?: number;
  prevout?: {
    scriptpubkey_address?: string;
    scriptpubkey?: string;
    value?: number;
  };
}

export interface ChainVout {
  scriptpubkey_address?: string;
  value?: number;
}

export interface ChainTx {
  txid: string;
  fee?: number;
  weight?: number;
  size?: number;
  status?: {confirmed?: boolean};
  vin?: ChainVin[];
  vout?: ChainVout[];
}

export interface RbfCoin {
  txid: string;
  vout: number;
  value: number;
  derivation_path: string;
  address: string;
  scriptpubkey: string;
  required: true;
}

export interface AddressPath {
  derivationPath: string;
}

export interface RbfEligibility {
  eligible: boolean;
  reason?: string;
  warning?: string;
  tx: ChainTx;
  origFee: number;
  origVsize: number;
  origFeeRate: number;
  inputSum: number;
  descendantFee: number;
  ourInputs: RbfCoin[];
  /** The only output is ours, so a speed up reduces that output. */
  shrinkRecipient?: boolean;
  /** Single foreign output this pipeline can keep. Absent on a one-output self-send. */
  recipient?: {address: string; value: number};
  change?: {address: string; value: number};
  canSpeedUp: boolean;
  canCancel: boolean;
}

export interface RbfPlan {
  ok: true;
  mode: 'speedup' | 'cancel';
  toAddress: string;
  amountSats: number;
  feeSats: number;
  utxos: RbfCoin[];
  changeAddress: string | null;
  skipChangeIndexBump: boolean;
  addedInput: boolean;
  vsize: number;
  feeRate: number;
}

export interface RbfPlanError {
  ok: false;
  reason: string;
  suggestCancel?: boolean;
  /** The plan needs a fresh change address before it can be signed. */
  needsChangeAddress?: boolean;
}

export interface RbfSendPayload extends RbfPlan {
  utxosJson: string;
  spendingHash: string;
  replacedTxId: string;
}

export interface ExtraCoin {
  txid: string;
  vout: number;
  value: number;
  address: string;
  derivationPath: string;
  scriptpubkey: string;
}

function inputWeight(addressType: string): number {
  return INPUT_WU[addressType] ?? INPUT_WU['segwit-native'];
}

function outputWeight(addressType: string): number {
  return OUTPUT_WU[addressType] ?? OUTPUT_WU['segwit-native'];
}

export function estimateVsize(
  inputCount: number,
  outputCount: number,
  addressType: string,
): number {
  const weight =
    TX_OVERHEAD_WU +
    inputCount * inputWeight(addressType) +
    outputCount * outputWeight(addressType);
  return Math.max(1, Math.ceil(weight / 4));
}

/** Fee the signed transaction actually pays, including dust absorbed into the fee. */
export function broadcastFeeSats(
  inputs: Array<{value?: number}>,
  outputs: Array<{value?: number}>,
  requested: number,
): number {
  const inputSum = inputs.reduce((sum, input) => sum + (input.value || 0), 0);
  const outputSum = outputs.reduce((sum, output) => sum + (output.value || 0), 0);
  if (inputs.length && outputs.length && inputSum >= outputSum) {
    return inputSum - outputSum;
  }
  return requested;
}

/**
 * A replacement must not advance the change index when it reuses an address
 * or pays no change. A normal send still advances it.
 */
export function replacementSkipsChangeBump(args: {
  inputs: Array<{required?: boolean}>;
  outputs: Array<{scriptpubkey_address?: string}>;
  toAddress: string;
  nextChangeAddress: string | null;
  skipChangeIndexBump?: boolean;
}): boolean {
  if (args.skipChangeIndexBump) {
    return true;
  }
  if (!args.inputs.some(input => input.required)) {
    return false;
  }
  const change = args.outputs.find(
    output => output.scriptpubkey_address && output.scriptpubkey_address !== args.toAddress,
  );
  if (!change) {
    return true;
  }
  return change.scriptpubkey_address !== args.nextChangeAddress;
}

/** BIP125 minimum absolute fee for a replacement of `newVsize` vbytes. */
export function minReplacementFeeSats(
  origFee: number,
  origVsize: number,
  newVsize: number,
  descendantFee = 0,
): number {
  const safeOrigVsize = Math.max(1, origVsize);
  const origRate = origFee / safeOrigVsize;
  const relay = origFee + descendantFee + newVsize;
  const bumped = Math.ceil((origRate + 1) * newVsize);
  return Math.max(relay, bumped);
}

/** Fee implied by the transaction itself. The stored fee field can miss dust that was absorbed. */
export function feeFromValues(tx: ChainTx): number | null {
  const vins = tx.vin ?? [];
  const vouts = tx.vout ?? [];
  if (
    !vins.length ||
    !vouts.length ||
    !vins.every(vin => vin.prevout?.value != null) ||
    !vouts.every(vout => vout.value != null)
  ) {
    return null;
  }
  const inputs = vins.reduce((sum, vin) => sum + (vin.prevout?.value ?? 0), 0);
  const outputs = vouts.reduce((sum, vout) => sum + (vout.value ?? 0), 0);
  return inputs >= outputs ? inputs - outputs : null;
}

function origVsizeOf(tx: ChainTx): number {
  if (tx.weight && tx.weight > 0) {
    return Math.ceil(tx.weight / 4);
  }
  if (tx.size && tx.size > 0) {
    return tx.size;
  }
  return estimateVsize(tx.vin?.length ?? 1, tx.vout?.length ?? 1, 'segwit-native');
}

export function inspectRbfTx(
  tx: ChainTx,
  addressPathMap: Record<string, AddressPath>,
  descendantFee = 0,
): RbfEligibility {
  const base: RbfEligibility = {
    eligible: false,
    tx,
    origFee: feeFromValues(tx) ?? tx.fee ?? 0,
    origVsize: origVsizeOf(tx),
    origFeeRate: 0,
    inputSum: 0,
    descendantFee,
    ourInputs: [],
    canSpeedUp: false,
    canCancel: false,
  };
  base.origFeeRate = base.origVsize > 0 ? base.origFee / base.origVsize : 0;

  if (tx.status?.confirmed) {
    return {...base, reason: 'This transaction is already confirmed.'};
  }
  const vins = tx.vin ?? [];
  if (!vins.length) {
    return {...base, reason: 'This transaction has no inputs to replace.'};
  }
  for (const vin of vins) {
    if (vin.sequence == null || vin.sequence >= RBF_SEQUENCE_LOCK) {
      return {
        ...base,
        reason: 'This transaction does not signal replace-by-fee.',
      };
    }
  }

  const ourInputs: RbfCoin[] = [];
  let inputSum = 0;
  for (const vin of vins) {
    const address = vin.prevout?.scriptpubkey_address ?? '';
    const path = addressPathMap[address]?.derivationPath;
    const value = vin.prevout?.value;
    if (
      !vin.txid ||
      vin.vout == null ||
      value == null ||
      !address ||
      !path
    ) {
      return {
        ...base,
        reason: address && !path
          ? 'An input is not from this wallet.'
          : 'Input details are still missing. Pull to refresh, then try again.',
      };
    }
    const script =
      vin.prevout?.scriptpubkey || scriptPubKeyFromAddress(address) || '';
    if (!script) {
      return {...base, reason: 'Could not lock an input script for signing.'};
    }
    inputSum += value;
    ourInputs.push({
      txid: vin.txid,
      vout: vin.vout,
      value,
      derivation_path: path,
      address,
      scriptpubkey: script,
      required: true,
    });
  }

  const owned = (tx.vout ?? []).filter(
    v => v.scriptpubkey_address && addressPathMap[v.scriptpubkey_address],
  );
  const foreign = (tx.vout ?? []).filter(
    v => v.scriptpubkey_address && !addressPathMap[v.scriptpubkey_address],
  );
  const recipient = foreign.length === 1 && foreign[0]?.scriptpubkey_address
    ? {address: foreign[0].scriptpubkey_address, value: foreign[0].value ?? 0}
    : undefined;
  const changeOutput = owned.find(v =>
    (addressPathMap[v.scriptpubkey_address!]?.derivationPath ?? '').includes(
      '/1/',
    ),
  );
  const changeSource =
    changeOutput ?? (recipient ? owned[0] : owned.length === 1 ? undefined : owned[0]);
  const change =
    changeSource?.scriptpubkey_address && (changeSource.value ?? 0) > 0
      ? {address: changeSource.scriptpubkey_address, value: changeSource.value ?? 0}
      : undefined;

  const outputCount = (tx.vout ?? []).length;
  const soleOwned =
    foreign.length === 0 && owned.length === 1 && outputCount === 1;
  const canSpeedUp =
    (recipient != null && outputCount <= 2 && owned.length <= 1) || soleOwned;
  const speedUpReason = canSpeedUp
    ? undefined
    : 'Speed up keeps one recipient and one change output. Cancel can still replace this transaction.';

  return {
    ...base,
    eligible: true,
    reason: speedUpReason,
    inputSum,
    ourInputs,
    shrinkRecipient: soleOwned,
    recipient: recipient ?? (outputCount === 1 && owned[0]?.scriptpubkey_address
      ? {address: owned[0].scriptpubkey_address, value: owned[0].value ?? 0}
      : undefined),
    change: recipient ? change : undefined,
    canSpeedUp,
    canCancel: true,
  };
}

function vsizeForPlan(
  eligibility: RbfEligibility,
  inputCount: number,
  outputCount: number,
  addressType: string,
): number {
  const origInputs = eligibility.ourInputs.length;
  const origOutputs =
    (eligibility.recipient ? 1 : 0) + (eligibility.change ? 1 : 0);
  if (
    inputCount === origInputs &&
    outputCount === origOutputs &&
    eligibility.origVsize > 0
  ) {
    return eligibility.origVsize;
  }
  return estimateVsize(inputCount, outputCount, addressType);
}

function coinFromStored(u: StoredUtxo | ExtraCoin): RbfCoin | null {
  const path = 'derivationPath' in u ? u.derivationPath : '';
  const script =
    ('scriptpubkey' in u ? u.scriptpubkey : '') ||
    ('scriptPubkey' in u ? u.scriptPubkey : '') ||
    scriptPubKeyFromAddress(u.address) ||
    '';
  const value = 'valueSats' in u ? u.valueSats : u.value;
  if (!path || !script || value == null) {
    return null;
  }
  return {
    txid: u.txid,
    vout: u.vout,
    value,
    derivation_path: path,
    address: u.address,
    scriptpubkey: script,
    required: true,
  };
}

export function planSpeedUp(args: {
  eligibility: RbfEligibility;
  feeSats: number;
  addressType: string;
  extraUtxos: ExtraCoin[];
  freshChangeAddress: string | null;
}): RbfPlan | RbfPlanError {
  const {eligibility, addressType} = args;
  if (!eligibility.canSpeedUp || !eligibility.recipient) {
    return {
      ok: false,
      reason:
        eligibility.reason ||
        'This transaction cannot be sped up. Cancel it instead.',
      suggestCancel: eligibility.canCancel,
    };
  }
  const amount = eligibility.recipient.value;
  const origInputs = eligibility.ourInputs;
  const inputSum = eligibility.inputSum;
  if (eligibility.shrinkRecipient) {
    const nextAmount = inputSum - args.feeSats;
    if (nextAmount <= DUST_SATS) {
      return {
        ok: false,
        suggestCancel: true,
        reason: 'That fee leaves a dust amount. Cancel the transaction instead.',
      };
    }
    if (args.feeSats > nextAmount) {
      return {
        ok: false,
        suggestCancel: true,
        reason:
          'The new fee would be larger than the amount returning to your wallet. Cancel the transaction instead.',
      };
    }
    const vsize = vsizeForPlan(eligibility, origInputs.length, 1, addressType);
    const minFee = minReplacementFeeSats(
      eligibility.origFee,
      eligibility.origVsize,
      vsize,
      eligibility.descendantFee,
    );
    if (args.feeSats < minFee) {
      return {
        ok: false,
        reason: `The replacement fee must be at least ${minFee} sats.`,
      };
    }
    return {
      ok: true,
      mode: 'speedup',
      toAddress: eligibility.recipient.address,
      amountSats: nextAmount,
      feeSats: args.feeSats,
      utxos: origInputs,
      changeAddress: null,
      skipChangeIndexBump: true,
      addedInput: false,
      vsize,
      feeRate: args.feeSats / vsize,
    };
  }
  if (args.feeSats > amount) {
    return {
      ok: false,
      suggestCancel: true,
      reason:
        'The new fee would be larger than the payment. Cancel the transaction instead.',
    };
  }
  const changeValue = eligibility.change?.value ?? 0;
  const feeDelta = args.feeSats - eligibility.origFee;

  const sameShape = (): RbfPlan | null => {
    if (!eligibility.change) {
      const remainder = inputSum - amount - args.feeSats;
      if (remainder !== 0) {
        return null;
      }
      const vsize = vsizeForPlan(eligibility, origInputs.length, 1, addressType);
      return {
        ok: true,
        mode: 'speedup',
        toAddress: eligibility.recipient!.address,
        amountSats: amount,
        feeSats: args.feeSats,
        utxos: origInputs,
        changeAddress: null,
        skipChangeIndexBump: true,
        addedInput: false,
        vsize,
        feeRate: args.feeSats / vsize,
      };
    }
    const nextChange = changeValue - feeDelta;
    if (nextChange > DUST_SATS) {
      const vsize = vsizeForPlan(eligibility, origInputs.length, 2, addressType);
      return {
        ok: true,
        mode: 'speedup',
        toAddress: eligibility.recipient!.address,
        amountSats: amount,
        feeSats: args.feeSats,
        utxos: origInputs,
        changeAddress: eligibility.change.address,
        skipChangeIndexBump: true,
        addedInput: false,
        vsize,
        feeRate: args.feeSats / vsize,
      };
    }
    if (nextChange >= 0) {
      const actualFee = inputSum - amount;
      if (actualFee > amount) {
        return null;
      }
      const vsize = vsizeForPlan(eligibility, origInputs.length, 1, addressType);
      return {
        ok: true,
        mode: 'speedup',
        toAddress: eligibility.recipient!.address,
        amountSats: amount,
        feeSats: actualFee,
        utxos: origInputs,
        changeAddress: null,
        skipChangeIndexBump: true,
        addedInput: false,
        vsize,
        feeRate: actualFee / vsize,
      };
    }
    return null;
  };

  const direct = sameShape();
  if (direct) {
    const minFee = minReplacementFeeSats(
      eligibility.origFee,
      eligibility.origVsize,
      direct.vsize,
      eligibility.descendantFee,
    );
    if (direct.feeSats < minFee) {
      return {
        ok: false,
        reason: `The replacement fee must be at least ${minFee} sats.`,
      };
    }
    return direct;
  }

  const spent = new Set(origInputs.map(u => `${u.txid}:${u.vout}`));
  const extras = args.extraUtxos
    .filter(u => u.value > DUST_SATS && !spent.has(`${u.txid}:${u.vout}`))
    .slice()
    .sort((a, b) => a.value - b.value || a.txid.localeCompare(b.txid));

  for (const extra of extras) {
    const coin = coinFromStored(extra);
    if (!coin) {
      continue;
    }
    const utxos = [...origInputs, coin];
    const sum = inputSum + coin.value;
    const remainder = sum - amount - args.feeSats;
    if (remainder < 0) {
      continue;
    }
    if (remainder > DUST_SATS) {
      if (!args.freshChangeAddress) {
        return {
          ok: false,
          needsChangeAddress: true,
          reason: 'A new change address is not available yet.',
        };
      }
      const vsize = estimateVsize(utxos.length, 2, addressType);
      const minFee = minReplacementFeeSats(
        eligibility.origFee,
        eligibility.origVsize,
        vsize,
        eligibility.descendantFee,
      );
      if (args.feeSats < minFee) {
        return {
          ok: false,
          reason: `The replacement fee must be at least ${minFee} sats.`,
        };
      }
      return {
        ok: true,
        mode: 'speedup',
        toAddress: eligibility.recipient.address,
        amountSats: amount,
        feeSats: args.feeSats,
        utxos,
        changeAddress: args.freshChangeAddress,
        skipChangeIndexBump: false,
        addedInput: true,
        vsize,
        feeRate: args.feeSats / vsize,
      };
    }
    const actualFee = sum - amount;
    if (actualFee > amount) {
      continue;
    }
    const vsize = estimateVsize(utxos.length, 1, addressType);
    const minFee = minReplacementFeeSats(
      eligibility.origFee,
      eligibility.origVsize,
      vsize,
      eligibility.descendantFee,
    );
    if (actualFee < minFee) {
      continue;
    }
    return {
      ok: true,
      mode: 'speedup',
      toAddress: eligibility.recipient.address,
      amountSats: amount,
      feeSats: actualFee,
      utxos,
      changeAddress: null,
      skipChangeIndexBump: true,
      addedInput: true,
      vsize,
      feeRate: actualFee / vsize,
    };
  }

  return {
    ok: false,
    suggestCancel: true,
    reason:
      'Confirmed coins cannot cover the higher fee. Cancel the transaction to return the funds.',
  };
}

export function planCancel(args: {
  eligibility: RbfEligibility;
  feeSats: number;
  selfAddress: string;
  addressType: string;
}): RbfPlan | RbfPlanError {
  const {eligibility} = args;
  if (!eligibility.canCancel || !eligibility.ourInputs.length) {
    return {ok: false, reason: eligibility.reason || 'This transaction cannot be cancelled.'};
  }
  if (!args.selfAddress) {
    return {ok: false, reason: 'A wallet address to receive the funds is not ready.'};
  }
  const amount = eligibility.inputSum - args.feeSats;
  if (amount <= DUST_SATS) {
    return {ok: false, reason: 'That fee leaves nothing to return to your wallet.'};
  }
  if (args.feeSats > amount) {
    return {
      ok: false,
      reason: 'That fee is larger than the amount which would return to your wallet.',
    };
  }
  const vsize = estimateVsize(
    eligibility.ourInputs.length,
    1,
    args.addressType,
  );
  const minFee = minReplacementFeeSats(
    eligibility.origFee,
    eligibility.origVsize,
    vsize,
    eligibility.descendantFee,
  );
  if (args.feeSats < minFee) {
    return {
      ok: false,
      reason: `The replacement fee must be at least ${minFee} sats.`,
    };
  }
  return {
    ok: true,
    mode: 'cancel',
    toAddress: args.selfAddress,
    amountSats: amount,
    feeSats: args.feeSats,
    utxos: eligibility.ourInputs,
    changeAddress: null,
    skipChangeIndexBump: true,
    addedInput: false,
    vsize,
    feeRate: args.feeSats / vsize,
  };
}

export interface ReplacementQuote {
  plan: RbfPlan | RbfPlanError;
  minFee: number;
  minRate: number;
  feeSats: number;
}

function planForMode(args: {
  mode: 'speedup' | 'cancel';
  eligibility: RbfEligibility;
  feeSats: number;
  addressType: string;
  extraUtxos: ExtraCoin[];
  freshChangeAddress: string | null;
  selfAddress: string;
}): RbfPlan | RbfPlanError {
  if (args.mode === 'cancel') {
    return planCancel({
      eligibility: args.eligibility,
      feeSats: args.feeSats,
      selfAddress: args.selfAddress,
      addressType: args.addressType,
    });
  }
  return planSpeedUp({
    eligibility: args.eligibility,
    feeSats: args.feeSats,
    addressType: args.addressType,
    extraUtxos: args.extraUtxos,
    freshChangeAddress: args.freshChangeAddress,
  });
}

/** One fee for both the sheet and the signed transaction. */
export function quoteReplacement(args: {
  mode: 'speedup' | 'cancel';
  eligibility: RbfEligibility;
  rate: number;
  addressType: string;
  extraUtxos: ExtraCoin[];
  freshChangeAddress: string | null;
  selfAddress: string;
}): ReplacementQuote {
  const at = (vsize: number) =>
    planForMode({
      ...args,
      feeSats: Math.max(1, Math.ceil(args.rate * Math.max(1, vsize))),
    });
  let vsize = Math.max(1, args.eligibility.origVsize);
  let plan = at(vsize);
  for (let i = 0; i < 3 && plan.ok && plan.vsize !== vsize; i++) {
    vsize = plan.vsize;
    plan = at(vsize);
  }
  let settled = plan.ok ? plan.vsize : vsize;
  let minFee = minReplacementFeeSats(
    args.eligibility.origFee,
    args.eligibility.origVsize,
    settled,
    args.eligibility.descendantFee,
  );
  if (!plan.ok || plan.feeSats < minFee) {
    const raised = planForMode({...args, feeSats: minFee});
    if (raised.ok) {
      plan = raised;
      settled = raised.vsize;
      minFee = minReplacementFeeSats(
        args.eligibility.origFee,
        args.eligibility.origVsize,
        settled,
        args.eligibility.descendantFee,
      );
      if (raised.feeSats < minFee) {
        const again = planForMode({...args, feeSats: minFee});
        if (again.ok) {
          plan = again;
        }
      }
    }
  }
  const used = plan.ok ? plan.vsize : settled;
  return {
    plan,
    minFee,
    minRate: Math.max(1, Math.ceil(minFee / Math.max(1, used))),
    feeSats: plan.ok ? plan.feeSats : minFee,
  };
}

type MempoolGet = (
  url: string,
) => Promise<{ok: boolean; data?: unknown; status?: number}>;

export async function resolveRbfEligibility(args: {
  tx: ChainTx;
  baseApi: string;
  addressPathMap: Record<string, AddressPath>;
  get?: MempoolGet;
}): Promise<RbfEligibility> {
  const get: MempoolGet =
    args.get ??
    (async url => {
      const mempoolClient = (await import('./MempoolClient')).default;
      return mempoolClient.get(url, {fresh: true, ttl: 0});
    });
  let tx = args.tx;
  const res = await get(`${args.baseApi.replace(/\/$/, '')}/tx/${tx.txid}`);
  if (res.ok && res.data && typeof res.data === 'object') {
    tx = {...tx, ...(res.data as ChainTx), txid: tx.txid};
  }
  let descendantFee = 0;
  let warning: string | undefined;
  try {
    const spends = await get(
      `${args.baseApi.replace(/\/$/, '')}/tx/${tx.txid}/outspends`,
    );
    if (spends.ok && Array.isArray(spends.data)) {
      const childIds = [
        ...new Set(
          (spends.data as Array<{spent?: boolean; txid?: string}>)
            .filter(s => s.spent && s.txid)
            .map(s => s.txid as string),
        ),
      ];
      for (const childId of childIds) {
        const child = await get(
          `${args.baseApi.replace(/\/$/, '')}/tx/${childId}`,
        );
        const body = child.data as ChainTx | undefined;
        if (body?.status?.confirmed) {
          return inspectRbfTx(
            {...tx, status: {...tx.status, confirmed: true}},
            args.addressPathMap,
          );
        }
        descendantFee += body?.fee ?? 0;
        warning =
          'An unconfirmed transaction already spends this one. The new fee also covers that child, which will be dropped.';
      }
    }
  } catch (err) {
    dbg('rbfBuilder: outspend check failed', err);
    warning = 'Could not check for transactions that spend this one.';
  }
  const result = inspectRbfTx(tx, args.addressPathMap, descendantFee);
  return warning ? {...result, warning} : result;
}

async function hashPlan(
  plan: RbfPlan,
  replacedTxId: string,
): Promise<RbfSendPayload | RbfPlanError> {
  const utxosJson = JSON.stringify(plan.utxos);
  if (!BBMTLibNativeModule?.spendingHashWithUTXOs) {
    return {ok: false, reason: 'Signing is not available on this device yet.'};
  }
  const spendingHash = await BBMTLibNativeModule.spendingHashWithUTXOs(
    utxosJson,
    plan.toAddress,
    String(plan.amountSats),
  );
  if (!spendingHash || typeof spendingHash !== 'string') {
    return {ok: false, reason: 'Could not lock the coins for co-signing.'};
  }
  return {...plan, utxosJson, spendingHash, replacedTxId};
}

function confirmedExtras(
  network: string,
  addressType: string,
): ExtraCoin[] {
  return utxoRepository
    .getUtxosForNetwork(network, addressType)
    .filter(u => u.isConfirmed && u.valueSats > DUST_SATS && u.derivationPath)
    .map(u => ({
      txid: u.txid,
      vout: u.vout,
      value: u.valueSats,
      address: u.address,
      derivationPath: u.derivationPath || '',
      scriptpubkey:
        u.scriptPubkey || scriptPubKeyFromAddress(u.address) || '',
    }));
}

export async function buildRbfSpeedUp(args: {
  eligibility: RbfEligibility;
  feeSats: number;
  addressType: string;
  network: string;
}): Promise<RbfSendPayload | RbfPlanError> {
  const extraUtxos = confirmedExtras(args.network, args.addressType);
  let freshChangeAddress: string | null = null;
  const draft = planSpeedUp({
    eligibility: args.eligibility,
    feeSats: args.feeSats,
    addressType: args.addressType,
    extraUtxos,
    freshChangeAddress: null,
  });
  if (!draft.ok && draft.needsChangeAddress) {
    const {WalletService} = await import('./WalletService');
    freshChangeAddress = await WalletService.getInstance().getNextChangeAddress(
      args.network,
      args.addressType,
    );
  }
  const plan =
    freshChangeAddress == null
      ? draft
      : planSpeedUp({
          eligibility: args.eligibility,
          feeSats: args.feeSats,
          addressType: args.addressType,
          extraUtxos,
          freshChangeAddress,
        });
  if (!plan.ok) {
    return plan;
  }
  return hashPlan(plan, args.eligibility.tx.txid);
}

export async function buildRbfCancel(args: {
  eligibility: RbfEligibility;
  feeSats: number;
  addressType: string;
  network: string;
}): Promise<RbfSendPayload | RbfPlanError> {
  const {WalletService} = await import('./WalletService');
  const receive = await WalletService.getInstance().getCurrentReceivePathInfo(
    args.network,
    args.addressType,
  );
  const plan = planCancel({
    eligibility: args.eligibility,
    feeSats: args.feeSats,
    selfAddress: receive?.address ?? '',
    addressType: args.addressType,
  });
  if (!plan.ok) {
    return plan;
  }
  return hashPlan(plan, args.eligibility.tx.txid);
}
