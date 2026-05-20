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
 * Keygen progress denominator for type=keygen (max pre-done step index).
 *
 * DKLs native scale (see BBMTLib/dkls/lan.go, nostr.go, runDKGWithSender):
 * 0 init, 1 wait/peers, 2 start, 3..N MPC rounds, 99 done sentinel.
 * Duo ~11 MPC rounds → max step ~13; trio adds rounds → ~21; denominators include headroom.
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

/**
 * Keysign progress denominator per input (2-party sign; trio 2-of-3 subset uses same).
 *
 * DKLs runSignWithSender reports stepNo from 3; ~9 sign rounds → max ~11; denominator 12.
 */
export function getKeysignStepCount(backend: TssBackend): number {
  return backend === 'dkls23' ? 12 : 36;
}

function stepToPercent(step: number, totalSteps: number): number {
  if (step >= MPC_PROGRESS_SENTINEL_STEP) {
    return 100;
  }
  if (totalSteps <= 0) {
    return 0;
  }
  return Math.min(99, Math.round((100 * step) / totalSteps));
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
    const total = getKeygenStepCount(backend, isTrio);
    const percent = stepToPercent(step, total);
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
    const raw = keysignStepToPercent(step, backend, utxo);
    if (raw <= 0) {
      return {percent: null};
    }
    const percent = Math.min(100, Math.max(currentProgress, raw));
    return {percent};
  }

  return {percent: null};
}
