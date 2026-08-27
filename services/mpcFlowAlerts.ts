import {Alert} from 'react-native';

export type MpcFlowAlertGate = {
  /** User tapped Abort on this flow. */
  aborted?: boolean;
  /** Screen is still focused (default true when omitted). */
  focused?: boolean;
  /** Flow UI is still active (modal/pairing in progress). */
  flowActive?: boolean;
};

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
  Alert.alert(title, message);
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
