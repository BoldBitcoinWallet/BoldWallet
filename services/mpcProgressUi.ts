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

export type MpcHookHandlerRefs = {
  progressRef: {current: number};
  utxoRef: {current: MpcProgressUtxoState};
  activeSessionRef?: {current: string | null};
};

export type MpcHookHandlerResult = {
  percent: number | null;
  statusLabel: string | null;
  mpcDone: boolean;
  utxoState?: MpcProgressUtxoState;
};

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
    utxo: MpcProgressUtxoState;
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
      opts.isSendBitcoin &&
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
    return opts.isSendBitcoin ? 'Signing transaction…' : 'Signing PSBT…';
  }

  if (msg.type === 'btc_send') {
    return 'Building transaction…';
  }

  return 'Processing cryptographic operations…';
}

function hookMatchesActiveSession(
  msg: MpcHookMessage,
  activeSession: string | null | undefined,
): boolean {
  if (!activeSession || activeSession.length === 0) {
    return true;
  }
  const hookSession = msg.session;
  if (!hookSession || hookSession.length === 0) {
    return true;
  }
  return hookSession === activeSession;
}

/**
 * Parse native TssHook JSON and map to UI progress (monotonic, optional session filter).
 */
export function processMpcHookMessage(
  message: string,
  backend: TssBackend,
  opts: {
    isTrio: boolean;
    isSendBitcoin: boolean;
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

  if (!hookMatchesActiveSession(msg, opts.refs.activeSessionRef?.current)) {
    return null;
  }

  const result: MpcProgressResult = mapMpcHookToPercent(msg, backend, {
    isTrio: opts.isTrio,
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
      utxo: opts.refs.utxoRef.current,
    }),
    mpcDone: result.mpcDone === true,
    utxoState: result.utxoState,
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
