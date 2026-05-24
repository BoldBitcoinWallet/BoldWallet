import {Alert} from 'react-native';

export type MpcFlowAlertGate = {
  /** User tapped Abort on this flow. */
  aborted?: boolean;
  /** Screen is still focused (default true when omitted). */
  focused?: boolean;
  /** Flow UI is still active (modal/pairing in progress). */
  flowActive?: boolean;
};

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
  return /aborted|canceled|cancelled|context canceled/i.test(msg);
}
