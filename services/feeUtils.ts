/**
 * feeUtils — pure-TS fee estimation with DB + HTTP caching.
 *
 * Replaces the Go-side EstimateFees / EstimateFeeWithUTXOs for the
 * pre-send UI estimate.  Fee rates are fetched through MempoolClient
 * (round-robin, failover) and cached in the `fee_rates` SQLite table.
 * UTXOs come from UtxoRepository (already synced by UtxoSyncer).
 *
 * The actual on-chain fee is still determined by the Go signing code.
 */
import database from './Database';
import mempoolClient from './MempoolClient';
import {dbg} from '../utils';
import type {StoredUtxo} from './repositories/UtxoRepository';
import {dedupeUtxosByOutpoint} from './utxoDedup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeeStrategy = 'top' | '30m' | '1hr' | 'eco' | 'min';

export interface FeeRates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
  fetchedAt: number;
}

export type ScriptType = 'P2TR' | 'P2WPKH' | 'P2SH' | 'P2PKH';

export interface FeeEstimate {
  feeSats: number;
  feeRate: number;
  vbytes: number;
  selectedUtxos: StoredUtxo[];
}

// ---------------------------------------------------------------------------
// Constants — weight units matching Go's calculateFees exactly
// ---------------------------------------------------------------------------

const INPUT_WU: Record<ScriptType, number> = {
  P2TR: 230,
  P2WPKH: 272,
  P2SH: 720,
  P2PKH: 592,
};

const OUTPUT_WU: Record<ScriptType, number> = {
  P2TR: 136,
  P2WPKH: 124,
  P2SH: 128,
  P2PKH: 136,
};

const BASE_TX_WU = 40; // version(4) + inputCount(1) + outputCount(1) + locktime(4) = 10 bytes × 4 WU
const SEGWIT_MARKER_WU = 8; // 2 bytes × 4 WU (marker + flag)
const DUST_THRESHOLD_SATS = 546;

const FEE_RATES_DB_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// 1. fetchFeeRates — DB-cached, MempoolClient-backed
// ---------------------------------------------------------------------------

function getCachedFeeRates(): FeeRates | null {
  try {
    const {rows} = database.execute(
      'SELECT fastest, half_hour, hour, economy, minimum, fetched_at FROM fee_rates WHERE id = 1',
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      fastestFee: r.fastest as number,
      halfHourFee: r.half_hour as number,
      hourFee: r.hour as number,
      economyFee: r.economy as number,
      minimumFee: r.minimum as number,
      fetchedAt: r.fetched_at as number,
    };
  } catch {
    return null;
  }
}

function writeFeeRates(rates: FeeRates): void {
  try {
    database.execute(
      `INSERT INTO fee_rates (id, fastest, half_hour, hour, economy, minimum, fetched_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         fastest    = excluded.fastest,
         half_hour  = excluded.half_hour,
         hour       = excluded.hour,
         economy    = excluded.economy,
         minimum    = excluded.minimum,
         fetched_at = excluded.fetched_at`,
      [
        rates.fastestFee,
        rates.halfHourFee,
        rates.hourFee,
        rates.economyFee,
        rates.minimumFee,
        rates.fetchedAt,
      ],
    );
  } catch (err) {
    dbg('feeUtils.writeFeeRates error', err);
  }
}

export async function fetchFeeRates(apiBase: string): Promise<FeeRates> {
  const cached = getCachedFeeRates();
  if (cached && Date.now() - cached.fetchedAt < FEE_RATES_DB_TTL_MS) {
    dbg('feeUtils.fetchFeeRates: DB fresh — returning cached');
    return cached;
  }

  const cleanApi = apiBase.replace(/\/+$/, '');
  const url = `${cleanApi}/v1/fees/recommended`;
  const res = await mempoolClient.get<{
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
    economyFee: number;
    minimumFee: number;
  }>(url);

  if (!res.ok || !res.data) {
    if (cached) {
      dbg('feeUtils.fetchFeeRates: API failed, returning stale cache');
      return cached;
    }
    throw new Error(`Fee rate fetch failed (${res.status})`);
  }

  const rates: FeeRates = {
    fastestFee: res.data.fastestFee,
    halfHourFee: res.data.halfHourFee,
    hourFee: res.data.hourFee,
    economyFee: res.data.economyFee,
    minimumFee: res.data.minimumFee,
    fetchedAt: Date.now(),
  };
  writeFeeRates(rates);
  dbg('feeUtils.fetchFeeRates: wrote', rates);
  return rates;
}

// ---------------------------------------------------------------------------
// 2. detectAddressType — prefix-based script classification
// ---------------------------------------------------------------------------

export function detectAddressType(address: string): ScriptType {
  const a = address.toLowerCase();
  if (a.startsWith('bc1p') || a.startsWith('tb1p')) return 'P2TR';
  if (a.startsWith('bc1q') || a.startsWith('tb1q')) return 'P2WPKH';
  if (address.startsWith('3') || address.startsWith('2')) return 'P2SH';
  return 'P2PKH';
}

// ---------------------------------------------------------------------------
// 3. estimateVbytes — weight-unit based, mirrors Go exactly
// ---------------------------------------------------------------------------

export function estimateVbytes(
  inputs: ScriptType[],
  outputs: ScriptType[],
): number {
  let weight = BASE_TX_WU;

  let hasSegWit = false;
  for (const inp of inputs) {
    weight += INPUT_WU[inp];
    if (inp === 'P2WPKH' || inp === 'P2TR') hasSegWit = true;
  }
  if (hasSegWit) weight += SEGWIT_MARKER_WU;

  for (const out of outputs) {
    weight += OUTPUT_WU[out];
  }

  if (inputs.length > 252) weight += 8;
  if (outputs.length > 252) weight += 8;

  return Math.ceil(weight / 4);
}

// ---------------------------------------------------------------------------
// 4. selectUtxos — smallest-first, matching Go's SelectUTXOs
// ---------------------------------------------------------------------------

export function selectUtxos(
  utxos: StoredUtxo[],
  targetSats: number,
): StoredUtxo[] {
  const sorted = dedupeUtxosByOutpoint(utxos).sort(
    (a, b) => a.valueSats - b.valueSats,
  );
  const selected: StoredUtxo[] = [];
  let total = 0;
  for (const u of sorted) {
    selected.push(u);
    total += u.valueSats;
    if (total >= targetSats) break;
  }
  if (total < targetSats) {
    throw new Error(
      `Insufficient UTXOs: need ${targetSats} sats, have ${total}`,
    );
  }
  return selected;
}

export {formatFeeEstimationError} from './feeErrorMessages';

// ---------------------------------------------------------------------------
// 5. pickRate — map FeeStrategy to the right field
// ---------------------------------------------------------------------------

export function pickRate(rates: FeeRates, strategy: FeeStrategy): number {
  switch (strategy) {
    case 'top':
      return rates.fastestFee;
    case '30m':
      return rates.halfHourFee;
    case '1hr':
      return rates.hourFee;
    case 'eco':
      return rates.economyFee;
    case 'min':
      return rates.minimumFee;
    default:
      return rates.halfHourFee;
  }
}

// ---------------------------------------------------------------------------
// 6. estimateFee — main entry point (two-pass, mirrors Go)
// ---------------------------------------------------------------------------

export async function estimateFee(params: {
  utxos: StoredUtxo[];
  receiverAddress: string;
  amountSats: number;
  changeAddress: string;
  strategy: FeeStrategy;
  apiBase: string;
}): Promise<FeeEstimate> {
  const {utxos, receiverAddress, amountSats, changeAddress, strategy, apiBase} =
    params;

  if (!utxos.length) {
    throw new Error('No UTXOs available for fee estimation');
  }

  const rates = await fetchFeeRates(apiBase);
  const feeRate = pickRate(rates, strategy);

  const receiverType = detectAddressType(receiverAddress);
  const changeType = detectAddressType(changeAddress || receiverAddress);

  // --- First pass: select for amount only, estimate fee ---
  let selected = selectUtxos(utxos, amountSats);
  let inputTypes = selected.map(u => detectAddressType(u.address));
  let outputs: ScriptType[] = [receiverType];

  let totalInput = selected.reduce((s, u) => s + u.valueSats, 0);
  let vb = estimateVbytes(inputTypes, outputs);
  let fee = vb * feeRate;

  // Add change output if above dust
  let change = totalInput - amountSats - fee;
  if (change > DUST_THRESHOLD_SATS) {
    outputs = [receiverType, changeType];
    vb = estimateVbytes(inputTypes, outputs);
    fee = vb * feeRate;
    change = totalInput - amountSats - fee;
  }

  // --- Second pass: re-select for amount + fee ---
  try {
    selected = selectUtxos(utxos, amountSats + fee);
  } catch {
    // If we can't cover amount+fee, keep first-pass selection (best effort)
  }
  inputTypes = selected.map(u => detectAddressType(u.address));
  totalInput = selected.reduce((s, u) => s + u.valueSats, 0);

  outputs = [receiverType];
  vb = estimateVbytes(inputTypes, outputs);
  fee = vb * feeRate;
  change = totalInput - amountSats - fee;
  if (change > DUST_THRESHOLD_SATS) {
    outputs = [receiverType, changeType];
    vb = estimateVbytes(inputTypes, outputs);
    fee = vb * feeRate;
  }

  // Enforce minimum 1 sat/vB
  if (fee < vb) fee = vb;

  dbg('feeUtils.estimateFee:', {
    strategy,
    feeRate,
    vb,
    fee,
    inputs: selected.length,
  });

  return {
    feeSats: fee,
    feeRate,
    vbytes: vb,
    selectedUtxos: selected,
  };
}
