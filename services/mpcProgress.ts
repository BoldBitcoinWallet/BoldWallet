import type {TssBackend} from './tssBackend';

/** Native TssHook JSON payload (subset). */
export type MpcHookMessage = {
  session?: string;
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

/** Progress snapshot after user abort — keeps UI consistent without implying success. */
export function progressStateAfterAbort(
  currentProgress: number,
): {percent: number; statusLabel: string} {
  return {
    percent: Math.min(99, Math.max(0, currentProgress)),
    statusLabel: 'Aborted',
  };
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
  /** Native recv/wait heartbeat during long transport waits */
  transportLiveness?: boolean;
};

/** Parses `keygen round (receiving N)` heartbeat tick from native info. */
export function parseKeygenRecvHeartbeatTick(info: string): number | null {
  const m = info.match(/receiving\s+(\d+)/i);
  if (!m) {
    return null;
  }
  const tick = parseInt(m[1], 10);
  return Number.isFinite(tick) && tick > 0 ? tick : null;
}

/** Parses `waiting for peers (N)` join heartbeat tick. */
export function parseKeygenWaitPeersTick(info: string): number | null {
  const m = info.match(/waiting\s+for\s+peers\s*\((\d+)\)/i);
  if (!m) {
    return null;
  }
  const tick = parseInt(m[1], 10);
  return Number.isFinite(tick) && tick > 0 ? tick : null;
}

const KEYGEN_RECV_CREEP_PER_TICK = 0.5;
const KEYGEN_WAIT_PEERS_CREEP_PER_TICK = 0.3;

/**
 * Nudges keygen % upward during recv/wait heartbeats without crossing the next step band.
 */
export function keygenRecvLivenessPercent(
  step: number,
  tick: number,
  isTrio: boolean,
  backend: TssBackend,
  currentProgress: number,
  opts?: {waitPeers?: boolean},
): number {
  if (tick <= 0) {
    return Math.max(currentProgress, keygenPercentForUi(step, isTrio, backend));
  }
  const base = keygenPercentForUi(step, isTrio, backend);
  const nextStep = step + 1;
  let ceiling = keygenPercentForUi(nextStep, isTrio, backend) - 1;
  if (ceiling <= base) {
    ceiling = Math.min(98, base + 1);
  }
  const perTick = opts?.waitPeers
    ? KEYGEN_WAIT_PEERS_CREEP_PER_TICK
    : KEYGEN_RECV_CREEP_PER_TICK;
  const bump = Math.min(tick * perTick, Math.max(0, ceiling - base));
  const target = Math.round(base + bump);
  return Math.min(98, Math.max(currentProgress, target));
}

/**
 * GG18 linear denominator for legacy callers/tests only.
 * Runtime keygen mapping uses gg18KeygenPercent (phased), not step/total.
 */
export function getKeygenStepCount(
  backend: TssBackend,
  isTrio: boolean,
): number {
  if (backend === 'dkls23') {
    return isTrio ? 14 : 10;
  }
  return isTrio ? 16 : 10;
}

/** GG18 keysign denominator per input. DKLs uses dklsKeysignPercent. */
export function getKeysignStepCount(backend: TssBackend): number {
  return backend === 'dkls23' ? 12 : 36;
}

const DKLS_KEYGEN_PREP_END_PERCENT = 20;
/**
 * Last native keygen step index before 99 (DKLs DKG starts at step 3).
 * Tuned to typical round counts so late rounds map ~75–95% before done (not ~37%).
 */
export const DKLS_KEYGEN_MAX_ROUND_STEP_DUO = 9;
export const DKLS_KEYGEN_MAX_ROUND_STEP_TRIO = 11;

const GG18_KEYGEN_PREP_END_PERCENT = 15;
/** Typical visible GG18 keygen steps before done (JoinKeygen milestones + message apply). */
export const GG18_KEYGEN_MAX_ROUND_STEP_DUO = 9;
export const GG18_KEYGEN_MAX_ROUND_STEP_TRIO = 14;

const DKLS_KEYSIGN_PREP_BAND_FRACTION = 0.15;
/** Last keysign round step before complete (runSignWithSender starts at 3). */
const DKLS_KEYSIGN_MAX_ROUND_STEP = 12;

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
  const roundSpan = Math.max(1, maxRoundStep - 2);
  const roundIndex = Math.min(step - 2, roundSpan);
  const tail = 99 - DKLS_KEYGEN_PREP_END_PERCENT;
  return Math.min(
    99,
    Math.round(DKLS_KEYGEN_PREP_END_PERCENT + (tail * roundIndex) / roundSpan),
  );
}

/**
 * GG18 keygen: sparse milestone steps then +2 per applied message.
 * Phased mapping avoids showing ~35–40% right before done.
 */
export function gg18KeygenPercent(step: number, isTrio: boolean): number {
  if (step >= MPC_PROGRESS_SENTINEL_STEP) {
    return 100;
  }
  if (step <= 0) {
    return 0;
  }
  if (step <= 2) {
    return Math.round((step / 2) * GG18_KEYGEN_PREP_END_PERCENT);
  }
  const maxRoundStep = isTrio
    ? GG18_KEYGEN_MAX_ROUND_STEP_TRIO
    : GG18_KEYGEN_MAX_ROUND_STEP_DUO;
  const roundSpan = Math.max(1, maxRoundStep - 2);
  const roundIndex = Math.min(step - 2, roundSpan);
  const tail = 99 - GG18_KEYGEN_PREP_END_PERCENT;
  return Math.min(
    99,
    Math.round(GG18_KEYGEN_PREP_END_PERCENT + (tail * roundIndex) / roundSpan),
  );
}

export type KeygenProgressTraceRow = {
  step: number;
  percent: number;
};

/** Reference curve for tests/docs (not used at runtime). */
export function buildKeygenProgressTrace(
  backend: TssBackend,
  isTrio: boolean,
  maxStep = MPC_PROGRESS_SENTINEL_STEP,
): KeygenProgressTraceRow[] {
  const rows: KeygenProgressTraceRow[] = [];
  for (let step = 0; step <= maxStep; step += 1) {
    if (step === MPC_PROGRESS_SENTINEL_STEP) {
      rows.push({step, percent: 100});
      continue;
    }
    const percent =
      backend === 'dkls23'
        ? dklsKeygenPercent(step, isTrio)
        : gg18KeygenPercent(step, isTrio);
    rows.push({step, percent});
  }
  return rows;
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
  const prgUTXO =
    utxo.utxoCount > 0 ? (utxo.utxoIndex - 1) * utxo.utxoRange : 0;
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
 * Keygen progress bar curve per backend (DKLS vs GG18 native step counts differ).
 */
export function keygenPercentForUi(
  step: number,
  isTrio: boolean,
  backend: TssBackend,
): number {
  return backend === 'dkls23'
    ? dklsKeygenPercent(step, isTrio)
    : gg18KeygenPercent(step, isTrio);
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
    isSendBitcoin?: boolean;
    isSignPSBT?: boolean;
    utxo: MpcProgressUtxoState;
    currentProgress: number;
  },
): MpcProgressResult {
  const {isTrio, utxo, currentProgress} = opts;
  const isSendBitcoin = opts.isSendBitcoin === true;
  const step = msg.step ?? 0;

  if (msg.type === 'keygen') {
    if (msg.done) {
      return {percent: 100, mpcDone: true};
    }
    const info = msg.info ?? '';
    const infoLower = info.toLowerCase();
    let percent = keygenPercentForUi(step, isTrio, backend);
    let transportLiveness = false;

    const recvTick = parseKeygenRecvHeartbeatTick(info);
    if (recvTick !== null && infoLower.includes('receiving')) {
      percent = keygenRecvLivenessPercent(
        step,
        recvTick,
        isTrio,
        backend,
        currentProgress,
      );
      transportLiveness = true;
    } else if (step <= 2) {
      const waitTick = parseKeygenWaitPeersTick(info);
      if (waitTick !== null && infoLower.includes('waiting')) {
        percent = keygenRecvLivenessPercent(
          step,
          waitTick,
          isTrio,
          backend,
          currentProgress,
          {waitPeers: true},
        );
        transportLiveness = true;
      }
    }

    const waitingJoin =
      step <= 2 && infoLower.includes('waiting') && !transportLiveness;
    return {
      percent: waitingJoin ? percent : Math.max(currentProgress, percent),
      transportLiveness: transportLiveness || undefined,
    };
  }

  if (msg.type === 'psbt') {
    const next: MpcProgressResult = {percent: null};
    const info = (msg.info ?? '').toLowerCase();

    if (msg.done) {
      return {percent: 100};
    }

    if (info.includes('pre-agreement')) {
      return {percent: Math.max(currentProgress, 5)};
    }

    if ((msg.utxo_total ?? 0) > 0) {
      const utxoCount = msg.utxo_total!;
      const utxoIndex = msg.utxo_current ?? 0;
      const utxoRange = 100 / utxoCount;
      next.utxoState = {utxoCount, utxoIndex, utxoRange};
      const base = (utxoIndex - 1) * utxoRange;
      const hint =
        info.includes('joining') || info.includes('keysign') ? 0.2 : 0.08;
      const pct = Math.round(base + utxoRange * hint);
      if (pct > 0) {
        next.percent = Math.max(currentProgress, Math.min(99, pct));
      }
    }
    return next;
  }

  if (msg.type === 'btc_send') {
    const next: MpcProgressResult = {percent: null};
    const info = (msg.info ?? '').toLowerCase();

    if (msg.done) {
      next.percent = 100;
      return next;
    }

    if (info.includes('pre-agreement') && isSendBitcoin) {
      return {percent: Math.max(currentProgress, 5)};
    }

    if (isSendBitcoin && (msg.utxo_total ?? 0) > 0) {
      const utxoCount = msg.utxo_total!;
      const utxoIndex = msg.utxo_current ?? 0;
      const buildCap = 15;
      const buildPct = Math.min(
        buildCap,
        Math.round((buildCap * utxoIndex) / utxoCount),
      );
      next.utxoState = {
        utxoCount,
        utxoIndex,
        utxoRange: 100 / utxoCount,
      };
      if (buildPct > 0) {
        next.percent = Math.max(currentProgress, buildPct);
      }
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
