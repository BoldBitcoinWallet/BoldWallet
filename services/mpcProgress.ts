import type {TssBackend} from './tssBackend';

/** Native TssHook JSON payload (subset). */
export type MpcHookMessage = {
  type?: string;
  step?: number;
  done?: boolean;
  utxo_total?: number;
  utxo_current?: number;
  info?: string;
  time?: number;
};

export type MpcProgressUtxoState = {
  utxoIndex: number;
  utxoCount: number;
  utxoRange: number;
};

export function emptyMpcUtxoState(): MpcProgressUtxoState {
  return {utxoIndex: 0, utxoCount: 0, utxoRange: 0};
}

/** Reset hook session refs when starting a new keygen/keysign modal. */
export function resetMpcHookSession(
  progressRef: {current: number},
  utxoRef: {current: MpcProgressUtxoState},
): void {
  progressRef.current = 0;
  utxoRef.current = emptyMpcUtxoState();
}

export const MPC_PROGRESS_SENTINEL_STEP = 99;

export type MpcProgressResult = {
  /** null = leave circular progress unchanged */
  percent: number | null;
  utxoState?: MpcProgressUtxoState;
  mpcDone?: boolean;
};

/**
 * GG18 keygen denominator (variable native steps; cap only).
 * DKLs uses dklsKeygenPercent instead — see BBMTLib/dkls/lan.go steps 0,1,2,3..N,99.
 */
export function getKeygenStepCount(
  backend: TssBackend,
  isTrio: boolean,
): number {
  if (backend === 'dkls23') {
    return isTrio ? 22 : 14;
  }
  return isTrio ? 29 : 18;
}

/** GG18 keysign denominator per input. DKLs uses dklsKeysignPercent. */
export function getKeysignStepCount(backend: TssBackend): number {
  return backend === 'dkls23' ? 12 : 36;
}

const DKLS_KEYGEN_PREP_END_PERCENT = 20;
/** Last hook step index before sentinel 99 (duo ~11 DKG rounds after step 2). */
const DKLS_KEYGEN_MAX_ROUND_STEP_DUO = 13;
const DKLS_KEYGEN_MAX_ROUND_STEP_TRIO = 21;

const DKLS_KEYSIGN_PREP_BAND_FRACTION = 0.15;
/** Last keysign round step before complete (runSignWithSender starts at 3). */
const DKLS_KEYSIGN_MAX_ROUND_STEP = 12;

function stepToPercent(step: number, totalSteps: number): number {
  if (step >= MPC_PROGRESS_SENTINEL_STEP) {
    return 100;
  }
  if (totalSteps <= 0) {
    return 0;
  }
  return Math.min(99, Math.round((100 * step) / totalSteps));
}

/**
 * DKLs keygen: native steps 0 init, 1–2 setup, 3..N MPC rounds, 99 done.
 * Linear step/total stalls low then jumps; split prep vs rounds for smoother UI.
 */
export function dklsKeygenPercent(step: number, isTrio: boolean): number {
  if (step >= MPC_PROGRESS_SENTINEL_STEP) {
    return 100;
  }
  if (step <= 0) {
    return 0;
  }
  if (step <= 2) {
    return Math.round((step / 2) * DKLS_KEYGEN_PREP_END_PERCENT);
  }
  const maxRoundStep = isTrio
    ? DKLS_KEYGEN_MAX_ROUND_STEP_TRIO
    : DKLS_KEYGEN_MAX_ROUND_STEP_DUO;
  const roundSpan = maxRoundStep - 2;
  const roundIndex = Math.min(step - 2, roundSpan);
  const tail = 99 - DKLS_KEYGEN_PREP_END_PERCENT;
  return Math.min(
    99,
    Math.round(
      DKLS_KEYGEN_PREP_END_PERCENT + (tail * roundIndex) / roundSpan,
    ),
  );
}

/**
 * DKLs keysign: steps 1–2 LAN/Nostr prep, 3..N sign rounds, 99 done.
 */
export function dklsKeysignPercent(
  step: number,
  utxo: MpcProgressUtxoState,
): number {
  if (step >= MPC_PROGRESS_SENTINEL_STEP) {
    return 100;
  }
  if (step <= 0) {
    return 0;
  }
  const prgUTXO = utxo.utxoCount > 0 ? (utxo.utxoIndex - 1) * utxo.utxoRange : 0;
  const band = utxo.utxoCount > 0 ? utxo.utxoRange : 100;
  if (step <= 2) {
    return Math.round(
      prgUTXO + band * (step / 2) * DKLS_KEYSIGN_PREP_BAND_FRACTION,
    );
  }
  const roundSpan = DKLS_KEYSIGN_MAX_ROUND_STEP - 2;
  const roundIndex = Math.min(step - 2, roundSpan);
  const within =
    DKLS_KEYSIGN_PREP_BAND_FRACTION +
    (1 - DKLS_KEYSIGN_PREP_BAND_FRACTION) * (roundIndex / roundSpan);
  return Math.min(100, Math.round(prgUTXO + band * within));
}

function keysignStepToPercent(
  step: number,
  backend: TssBackend,
  utxo: MpcProgressUtxoState,
): number {
  const keysignSteps = getKeysignStepCount(backend);
  if (step >= MPC_PROGRESS_SENTINEL_STEP) {
    return 100;
  }
  if (utxo.utxoCount > 0) {
    const prgUTXO = (utxo.utxoIndex - 1) * utxo.utxoRange;
    return Math.min(
      100,
      Math.round(prgUTXO + (utxo.utxoRange * step) / keysignSteps),
    );
  }
  return Math.min(100, Math.round((100 * step) / keysignSteps));
}

/**
 * Map a native MPC hook message to UI progress (0–100).
 * Preserves send_btc UTXO banding and monotonic progress within a session.
 */
export function mapMpcHookToPercent(
  msg: MpcHookMessage,
  backend: TssBackend,
  opts: {
    isTrio: boolean;
    utxo: MpcProgressUtxoState;
    currentProgress: number;
  },
): MpcProgressResult {
  const {isTrio, utxo, currentProgress} = opts;
  const step = msg.step ?? 0;

  if (msg.type === 'keygen') {
    if (msg.done) {
      return {percent: 100, mpcDone: true};
    }
    const percent =
      backend === 'dkls23'
        ? dklsKeygenPercent(step, isTrio)
        : stepToPercent(step, getKeygenStepCount(backend, isTrio));
    return {
      percent: Math.max(currentProgress, percent),
    };
  }

  if (msg.type === 'btc_send') {
    const next: MpcProgressResult = {percent: null};
    if (msg.done) {
      next.percent = 100;
    }
    if ((msg.utxo_total ?? 0) > 0) {
      const utxoCount = msg.utxo_total!;
      next.utxoState = {
        utxoCount,
        utxoIndex: msg.utxo_current ?? 0,
        utxoRange: 100 / utxoCount,
      };
    }
    return next;
  }

  if (msg.type === 'keysign') {
    if (msg.done) {
      return {
        percent: 100,
        mpcDone: true,
        utxoState: {utxoIndex: 0, utxoCount: 0, utxoRange: 0},
      };
    }
    const raw =
      backend === 'dkls23'
        ? dklsKeysignPercent(step, utxo)
        : keysignStepToPercent(step, backend, utxo);
    if (raw <= 0) {
      return {percent: null};
    }
    const percent = Math.min(100, Math.max(currentProgress, raw));
    return {percent};
  }

  return {percent: null};
}
