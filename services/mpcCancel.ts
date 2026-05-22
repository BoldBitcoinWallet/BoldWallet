import {getHardeningFlags} from './hardening';

export type MpcCancelKind = 'session' | 'nostr';

export type MpcCancelOutcome =
  | 'cancelled'
  | 'noop'
  | 'already_requested'
  | 'unavailable';

export type MpcCancelResult = {
  outcome: MpcCancelOutcome;
  /** Preserved for callers that logged raw native messages */
  detail?: string;
};

type CancelState = 'idle' | 'in_progress' | 'abort_requested' | 'aborted';

/** Wait this long after a Nostr abort before starting another Nostr MPC flow. */
export const NOSTR_ABORT_COOLDOWN_MS = 15_000;

const state: Record<MpcCancelKind, CancelState> = {
  session: 'idle',
  nostr: 'idle',
};

let nostrAbortedAtMs = 0;

function logCancel(kind: MpcCancelKind, outcome: MpcCancelOutcome, detail?: string) {
  const flags = getHardeningFlags();
  if (!flags.cancelTelemetry) {
    return;
  }
  const msg = detail ? ` [${detail}]` : '';
  console.log(`[mpcCancel] ${kind} -> ${outcome}${msg}`);
}

/** Reset cancel FSM when starting a new MPC flow. */
export function resetMpcCancelState(kind: MpcCancelKind): void {
  state[kind] = 'idle';
}

/** Record that the user aborted a Nostr MPC flow (starts cooldown timer). */
export function markNostrMpcAborted(): void {
  nostrAbortedAtMs = Date.now();
  state.nostr = 'aborted';
}

/** Whether a new Nostr MPC flow may start (15s after last abort). */
export function canStartNostrMpc(): {ok: boolean; waitMs: number} {
  if (!nostrAbortedAtMs) {
    return {ok: true, waitMs: 0};
  }
  const elapsed = Date.now() - nostrAbortedAtMs;
  if (elapsed >= NOSTR_ABORT_COOLDOWN_MS) {
    nostrAbortedAtMs = 0;
    return {ok: true, waitMs: 0};
  }
  return {ok: false, waitMs: NOSTR_ABORT_COOLDOWN_MS - elapsed};
}

/** Seconds until another Nostr MPC round may start (0 if no cooldown). */
export function nostrMpcCooldownSecondsRemaining(): number {
  const {ok, waitMs} = canStartNostrMpc();
  if (ok) {
    return 0;
  }
  return Math.max(1, Math.ceil(waitMs / 1000));
}

/** User-facing cooldown line with remaining seconds. */
export function formatNostrMpcCooldownMessage(waitMs?: number): string {
  const sec =
    waitMs !== undefined
      ? Math.max(1, Math.ceil(waitMs / 1000))
      : nostrMpcCooldownSecondsRemaining();
  return `Wait ${sec} seconds after abort before retrying.`;
}

/** User-facing message when retrying too soon after abort; null if OK to start. */
export function nostrMpcCooldownMessage(): string | null {
  const {ok, waitMs} = canStartNostrMpc();
  if (ok) {
    return null;
  }
  return formatNostrMpcCooldownMessage(waitMs);
}

/** Thrown when starting Nostr MPC during the post-abort cooldown window. */
export class NostrMpcCooldownError extends Error {
  readonly waitSeconds: number;

  constructor(waitMs: number) {
    const waitSeconds = Math.max(1, Math.ceil(waitMs / 1000));
    super(formatNostrMpcCooldownMessage(waitMs));
    this.name = 'NostrMpcCooldownError';
    this.waitSeconds = waitSeconds;
  }
}

/** Throws {@link NostrMpcCooldownError} with remaining seconds if cooldown is active. */
export function assertCanStartNostrMpc(): void {
  const {ok, waitMs} = canStartNostrMpc();
  if (!ok) {
    throw new NostrMpcCooldownError(waitMs);
  }
}

const NOSTR_COOLDOWN_MSG_RE =
  /wait\s+(\d+)\s+seconds?\s+before\s+retrying/i;

/** Map native/JS errors to a cooldown message with seconds, or null. */
export function nostrMpcCooldownMessageFromError(err: unknown): string | null {
  if (err instanceof NostrMpcCooldownError) {
    return err.message;
  }
  const msg =
    err &&
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as {message?: unknown}).message === 'string'
      ? (err as {message: string}).message
      : typeof err === 'string'
        ? err
        : '';
  const m = msg.match(NOSTR_COOLDOWN_MSG_RE);
  if (m) {
    return formatNostrMpcCooldownMessage(Number(m[1]) * 1000);
  }
  return null;
}

export function getMpcCancelState(kind: MpcCancelKind): CancelState {
  return state[kind];
}

export function markMpcInProgress(kind: MpcCancelKind): void {
  if (state[kind] === 'idle' || state[kind] === 'aborted') {
    state[kind] = 'in_progress';
  }
}

function isNoActiveNostrError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('no active nostr mpc') ||
    m.includes('no active nostr') ||
    m.includes('no active mpc operation')
  );
}

/**
 * Wrap native cancel with idempotency and optional noop for inactive Nostr MPC.
 * Does not change successful cancel semantics when hardening is off.
 */
export async function safeCancelMpc(
  kind: MpcCancelKind,
  invoke: () => Promise<void>,
): Promise<MpcCancelResult> {
  const flags = getHardeningFlags();

  if (!flags.safeCancel) {
    await invoke();
    return {outcome: 'cancelled'};
  }

  if (state[kind] === 'abort_requested' || state[kind] === 'aborted') {
    logCancel(kind, 'already_requested');
    return {outcome: 'already_requested'};
  }

  state[kind] = 'abort_requested';

  try {
    await invoke();
    state[kind] = 'aborted';
    if (kind === 'nostr') {
      markNostrMpcAborted();
    }
    logCancel(kind, 'cancelled');
    return {outcome: 'cancelled'};
  } catch (e: unknown) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === 'string'
          ? e
          : 'cancel failed';

    if (kind === 'nostr' && flags.nostrCancelNoopOk && isNoActiveNostrError(msg)) {
      markNostrMpcAborted();
      logCancel(kind, 'noop', msg);
      return {outcome: 'noop', detail: msg};
    }

    if (
      msg.includes('BBMT_NATIVE_REQUIRED') ||
      msg.includes('libbbmtmobile not loaded') ||
      msg.includes('DKLS_NATIVE_REQUIRED')
    ) {
      state[kind] = 'idle';
      logCancel(kind, 'unavailable', msg);
      return {outcome: 'unavailable', detail: msg};
    }

    state[kind] = 'in_progress';
    throw e;
  }
}
