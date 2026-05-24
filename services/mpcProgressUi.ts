import type {TssBackend} from './tssBackend';
import {
  getKeygenTssBackendPreference,
  resolveHookProgressBackend,
  resolveTssBackendFromCachedMeta,
} from './tssBackend';
import {
  mapMpcHookToPercent,
  type MpcHookMessage,
  type MpcProgressResult,
  type MpcProgressUtxoState,
} from './mpcProgress';
import {
  mapTransportHookToSubprogress,
  type MpcTransportSubprogressState,
} from './mpcTransportProgress';

export type MpcHookHandlerRefs = {
  progressRef: {current: number};
  utxoRef: {current: MpcProgressUtxoState};
  activeSessionRef?: {current: string | null};
};

export type MpcHookHandlerResult = {
  percent: number | null;
  statusLabel: string | null;
  /** First 4 chars of MPC session id for modal display */
  sessionShort: string | null;
  mpcDone: boolean;
  utxoState?: MpcProgressUtxoState;
  /** Recv/wait heartbeat active — pulse status indicator */
  transportLiveness?: boolean;
  /** Outbound LAN/Nostr upload subprogress (orthogonal to main %) */
  transportSubprogress?: MpcTransportSubprogressState | null;
};

/** Short session badge for progress modals (first 4 hex chars). */
export function mpcSessionShortLabel(
  session: string | null | undefined,
): string | null {
  const trimmed = session?.trim();
  if (!trimmed || trimmed.length < 4) {
    return null;
  }
  return trimmed.slice(0, 4);
}

/** Strip per-UTXO index suffix from LAN keysign session ids (`${session}${n}`). */
function resolveBaseSessionId(session: string): string {
  const trimmed = session.trim();
  if (trimmed.length > 64) {
    const suffix = trimmed.slice(64);
    if (/^\d{1,3}$/.test(suffix)) {
      return trimmed.slice(0, 64);
    }
  }
  return trimmed;
}

function isNostrKeysignPhaseHook(msg: MpcHookMessage): boolean {
  const info = (msg.info ?? '').toLowerCase();
  return (
    msg.type === 'keysign' ||
    ((msg.type === 'btc_send' || msg.type === 'psbt') &&
      (info.includes('joining') || info.includes('signed')))
  );
}

function captureHookSessionForUi(
  msg: MpcHookMessage,
  activeSessionRef?: {current: string | null},
): string | null {
  const hookSession = msg.session?.trim();
  if (hookSession && activeSessionRef) {
    if (!activeSessionRef.current) {
      activeSessionRef.current = resolveBaseSessionId(hookSession);
    } else if (isNostrKeysignPhaseHook(msg)) {
      // Nostr spend: replace pre-agreement sessionFlag with keysign sessionID for badge.
      activeSessionRef.current = resolveBaseSessionId(hookSession);
    }
  }
  const displaySession = activeSessionRef?.current ?? hookSession ?? null;
  return mpcSessionShortLabel(displaySession);
}

export type MpcHookTracePayload = {
  backend: TssBackend;
  msg: MpcHookMessage;
  mappedPercent: number | null;
  displayProgress: number;
};

/** Human-readable phase line for the MPC modal (DKLS + GG18). */
export function formatMpcPhaseLabel(
  msg: MpcHookMessage,
  opts: {
    isSendBitcoin: boolean;
    isSignPSBT?: boolean;
    utxo: MpcProgressUtxoState;
    isNostrTransport?: boolean;
  },
): string {
  const step = msg.step ?? 0;
  const info = (msg.info ?? '').toLowerCase();

  if (msg.type === 'keygen') {
    if (step <= 0) {
      return 'Preparing wallet setup…';
    }
    if (
      step <= 2 &&
      (info.includes('waiting') || info.includes('starting keygen'))
    ) {
      return 'Waiting for all devices…';
    }
    if (info.includes('round') || info.includes('message')) {
      if (info.includes('waiting') || info.includes('receiving')) {
        if (step >= 3) {
          const transportHint = opts.isNostrTransport
            ? 'over Nostr…'
            : 'from peers…';
          return `Key generation · round ${step - 2} (${transportHint})`;
        }
        return 'Key generation in progress…';
      }
      const m = msg.info?.match(/round\s*(\d+)/i);
      if (m) {
        return `Key generation · round ${m[1]}`;
      }
      if (step >= 3) {
        return `Key generation · round ${step - 2}`;
      }
      return 'Key generation in progress…';
    }
    if (step >= 99 || msg.done) {
      return 'Wallet setup complete';
    }
    return 'Creating your wallet…';
  }

  if (msg.type === 'keysign') {
    const {utxoIndex, utxoCount} = opts.utxo;
    if (
      (opts.isSendBitcoin || opts.isSignPSBT) &&
      utxoCount > 0 &&
      utxoIndex > 0
    ) {
      if (step <= 2 || info.includes('waiting')) {
        return `Signing · input ${utxoIndex} of ${utxoCount} (connecting)`;
      }
      if (info.includes('keysign round')) {
        return `Signing · input ${utxoIndex} of ${utxoCount}`;
      }
      return `Signing · input ${utxoIndex} of ${utxoCount}`;
    }
    if (step <= 2 || info.includes('waiting')) {
      return 'Waiting for co-signers…';
    }
    if (info.includes('keysign round')) {
      return 'Co-signing in progress…';
    }
    if (step >= 99 || msg.done) {
      return 'Signature complete';
    }
    return opts.isSignPSBT ? 'Signing PSBT…' : 'Signing transaction…';
  }

  if (msg.type === 'psbt') {
    if (info.includes('pre-agreement')) {
      return 'Connecting co-signers for PSBT…';
    }
    if (info.includes('joining') || info.includes('keysign')) {
      const {utxoIndex, utxoCount} = opts.utxo;
      if (utxoCount > 0 && utxoIndex > 0) {
        return `Signing PSBT · input ${utxoIndex} of ${utxoCount}`;
      }
      return 'Co-signing PSBT…';
    }
    return 'Preparing PSBT signatures…';
  }

  if (msg.type === 'btc_send') {
    if (info.includes('pre-agreement')) {
      return 'Connecting co-signers…';
    }
    if (info.includes('joining') || info.includes('keysign')) {
      const {utxoIndex, utxoCount} = opts.utxo;
      if (utxoCount > 0 && utxoIndex > 0) {
        return `Signing · input ${utxoIndex} of ${utxoCount}`;
      }
      return 'Co-signing transaction…';
    }
    if (info.includes('signed')) {
      return 'Signature complete';
    }
    return 'Building transaction…';
  }

  return 'Processing cryptographic operations…';
}

function hookMatchesActiveSession(
  msg: MpcHookMessage,
  activeSessionRef?: {current: string | null},
): boolean {
  const activeSession = activeSessionRef?.current;
  if (!activeSession || activeSession.length === 0) {
    return true;
  }
  const hookSession = msg.session?.trim();
  if (!hookSession || hookSession.length === 0) {
    return true;
  }
  const hookBase = resolveBaseSessionId(hookSession);
  if (hookBase === activeSession) {
    return true;
  }
  // LAN/Nostr multi-path signing uses per-input session ids: `${session}${index}`.
  const suffix = hookSession.slice(activeSession.length);
  if (hookSession.startsWith(activeSession) && /^\d+$/.test(suffix)) {
    return true;
  }
  // Nostr send/PSBT: pre-agreement sessionFlag → keysign sessionID (different hashes).
  if (isNostrKeysignPhaseHook(msg) && activeSessionRef) {
    activeSessionRef.current = hookBase;
    return true;
  }
  return false;
}

/**
 * Parse native TssHook JSON and map to UI progress (monotonic, optional session filter).
 */
/** Update refs when a hook arrives; returns whether to pulse / clear stale hint. */
export function trackMpcHookForTransportLiveness(
  message: string,
  result: MpcHookHandlerResult,
  refs: {
    progressBefore: number;
    lastBumpAtMsRef: {current: number};
    lastKeygenStepRef: {current: number};
  },
): {pulse: boolean; clearStale: boolean} {
  try {
    const msg = JSON.parse(message) as MpcHookMessage;
    if (msg.type === 'keygen' && typeof msg.step === 'number') {
      refs.lastKeygenStepRef.current = msg.step;
    }
  } catch {
    // ignore malformed hook JSON
  }
  const bumped =
    result.percent !== null && result.percent > refs.progressBefore;
  if (bumped || result.transportLiveness) {
    refs.lastBumpAtMsRef.current = Date.now();
  }
  return {
    pulse: result.transportLiveness === true,
    clearStale: bumped || result.transportLiveness === true,
  };
}

/** Fallback status when keygen % is flat during long outbound/inbound transport. */
export function staleTransportHintForKeygen(opts: {
  isPairing: boolean;
  isSpendFlow: boolean;
  displayPercent: number;
  lastBumpAtMs: number;
  lastKeygenStep: number;
  nowMs: number;
  isNostrTransport: boolean;
  staleMs?: number;
}): string | null {
  const staleMs = opts.staleMs ?? 3000;
  if (!opts.isPairing || opts.isSpendFlow) {
    return null;
  }
  if (opts.displayPercent < 20 || opts.displayPercent >= 99) {
    return null;
  }
  if (opts.lastKeygenStep < 3) {
    return null;
  }
  if (opts.nowMs - opts.lastBumpAtMs < staleMs) {
    return null;
  }
  return opts.isNostrTransport
    ? 'Still exchanging data…'
    : 'Still waiting on peers…';
}

export function processMpcHookMessage(
  message: string,
  backend: TssBackend,
  opts: {
    isTrio: boolean;
    isSendBitcoin: boolean;
    isSignPSBT?: boolean;
    isNostrTransport?: boolean;
    refs: MpcHookHandlerRefs;
    onTrace?: (payload: MpcHookTracePayload) => void;
  },
): MpcHookHandlerResult | null {
  let msg: MpcHookMessage;
  try {
    msg = JSON.parse(message) as MpcHookMessage;
  } catch {
    return null;
  }

  if (!hookMatchesActiveSession(msg, opts.refs.activeSessionRef)) {
    return null;
  }

  if (msg.type === 'transport') {
    const transportSubprogress = mapTransportHookToSubprogress(msg);
    return {
      percent: null,
      statusLabel: null,
      sessionShort: captureHookSessionForUi(msg, opts.refs.activeSessionRef),
      mpcDone: false,
      transportSubprogress,
    };
  }

  const result: MpcProgressResult = mapMpcHookToPercent(msg, backend, {
    isTrio: opts.isTrio,
    isSendBitcoin: opts.isSendBitcoin,
    isSignPSBT: opts.isSignPSBT,
    utxo: opts.refs.utxoRef.current,
    currentProgress: opts.refs.progressRef.current,
  });

  if (result.utxoState) {
    opts.refs.utxoRef.current = result.utxoState;
  }

  let percent: number | null = result.percent;
  if (percent !== null) {
    opts.refs.progressRef.current = Math.max(
      opts.refs.progressRef.current,
      percent,
    );
    percent = opts.refs.progressRef.current;
  }

  const handlerResult = {
    percent,
    statusLabel: formatMpcPhaseLabel(msg, {
      isSendBitcoin: opts.isSendBitcoin,
      isSignPSBT: opts.isSignPSBT,
      utxo: opts.refs.utxoRef.current,
      isNostrTransport: opts.isNostrTransport,
    }),
    sessionShort: captureHookSessionForUi(msg, opts.refs.activeSessionRef),
    mpcDone: result.mpcDone === true,
    utxoState: result.utxoState,
    transportLiveness: result.transportLiveness,
  };

  opts.onTrace?.({
    backend,
    msg,
    mappedPercent: percent,
    displayProgress: opts.refs.progressRef.current,
  });

  return handlerResult;
}

/** Backend for hooks: prefer resolved state; while MPC is active, fall back so early hooks are not dropped. */
export function resolveMpcHookBackend(opts: {
  isSpendFlow: boolean;
  spendBackend: TssBackend | null;
  keygenBackend: TssBackend | null;
  mpcActive: boolean;
}): TssBackend | null {
  const primary = resolveHookProgressBackend({
    isSpendFlow: opts.isSpendFlow,
    spendBackend: opts.spendBackend,
    keygenBackend: opts.keygenBackend,
  });
  if (primary) {
    return primary;
  }
  if (!opts.mpcActive) {
    return null;
  }
  if (opts.isSpendFlow) {
    return resolveTssBackendFromCachedMeta() ?? 'gg18';
  }
  return getKeygenTssBackendPreference();
}
