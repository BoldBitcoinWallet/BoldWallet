import {confirmAppPrompt, showAppNotice} from './appPrompt';

export type MpcFlowAlertGate = {
  /** User tapped Abort on this flow. */
  aborted?: boolean;
  /** Screen is still focused (default true when omitted). */
  focused?: boolean;
  /** Flow UI is still active (modal/pairing in progress). */
  flowActive?: boolean;
  /** Must match the live attempt from beginMpcFlowAttempt. */
  attemptId?: string;
};

let activeAttemptId: string | null = null;

/** Start a new co-sign/keygen attempt; late errors from older runs are ignored. */
export function beginMpcFlowAttempt(): string {
  activeAttemptId = `mpc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return activeAttemptId;
}

export function getActiveMpcFlowAttempt(): string | null {
  return activeAttemptId;
}

/** Clear after success, or when a specific attempt ends. */
export function clearMpcFlowAttempt(id?: string): void {
  if (id == null || id === activeAttemptId) {
    activeAttemptId = null;
  }
}

function mpcErrorMessage(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as {message?: unknown}).message === 'string'
  ) {
    return (err as {message: string}).message;
  }
  return typeof err === 'string' ? err : '';
}

/** True when a late async error should still surface as an alert. */
export function shouldShowMpcFlowAlert(gate: MpcFlowAlertGate): boolean {
  if (gate.aborted) {
    return false;
  }
  if (gate.focused === false) {
    return false;
  }
  if (gate.flowActive === false) {
    return false;
  }
  if (
    gate.attemptId != null &&
    (activeAttemptId == null || gate.attemptId !== activeAttemptId)
  ) {
    return false;
  }
  return true;
}

export function showMpcFlowAlert(
  title: string,
  message?: string,
  gate: MpcFlowAlertGate = {},
): void {
  if (!shouldShowMpcFlowAlert(gate)) {
    return;
  }
  showAppNotice(title, message);
}

/**
 * Fatal keysign failure: full message in an in-app sheet so it is
 * not lost under a short toast or a successful retry.
 */
export function showMpcSignFailure(
  title: string,
  message: string,
  gate: MpcFlowAlertGate = {},
): void {
  if (!shouldShowMpcFlowAlert(gate)) {
    return;
  }
  const text = String(message || '').trim() || 'Signing failed.';
  confirmAppPrompt({
    icon: 'warning',
    title,
    detail: text.slice(0, 400),
    confirmLabel: 'OK',
  });
}

/** Native/Go errors after user abort often include these markers. */
export function isMpcAbortedOrCanceledError(err: unknown): boolean {
  const msg = mpcErrorMessage(err);
  if (
    /timeout waiting for all parties|timeout joining the session|await joiners/i.test(
      msg,
    )
  ) {
    return false;
  }
  return /aborted|canceled|cancelled|context canceled/i.test(msg);
}

/** Peer published phase=abort (not this user tapping Abort). */
export function isPeerAbortedSessionError(err: unknown): boolean {
  return /peer aborted the session/i.test(mpcErrorMessage(err));
}

export function peerAbortUserMessage(
  err: unknown,
  kind: 'keygen' | 'sign' = 'keygen',
): string {
  const msg = mpcErrorMessage(err);
  const reason = msg.replace(/^.*peer aborted the session:?\s*/i, '').trim();
  const head =
    kind === 'keygen'
      ? 'Another device stopped key generation'
      : 'Another device stopped signing';
  if (
    reason &&
    !/^context canceled$/i.test(reason) &&
    !/operation canceled: context canceled/i.test(reason)
  ) {
    return `${head}.\n\n${reason}`;
  }
  return `${head}.`;
}

/** Test-only. */
export function resetMpcFlowAttemptForTests(): void {
  activeAttemptId = null;
}
