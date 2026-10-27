/**
 * App-wide offline sandbox sheet. Same host pattern as appPrompt:
 * one modal, opened from guardOnlineAction and from refresh gates.
 */

export type WalletOfflineSandboxRequest = {
  /** Optional body copy; default explains the sandbox. */
  message?: string;
  /** Runs after the user chooses Go online (wallet already set online). */
  onGoOnline?: () => void;
};

type Subscriber = (current: WalletOfflineSandboxRequest | null) => void;

let active: WalletOfflineSandboxRequest | null = null;
const listeners = new Set<Subscriber>();

function emit() {
  listeners.forEach(listener => {
    try {
      listener(active);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function subscribeWalletOfflineSandbox(listener: Subscriber): () => void {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}

export function currentWalletOfflineSandbox(): WalletOfflineSandboxRequest | null {
  return active;
}

/** Open (or replace) the offline sandbox sheet. */
export function openWalletOfflineSandbox(
  request: WalletOfflineSandboxRequest = {},
): void {
  active = request;
  emit();
}

export function dismissWalletOfflineSandbox(): void {
  if (!active) {
    return;
  }
  active = null;
  emit();
}

/**
 * Close the sheet. When goOnline is true, caller should already have
 * flipped the wallet online and may run onGoOnline from the request.
 */
export function respondWalletOfflineSandbox(goOnline: boolean): void {
  const current = active;
  if (!current) {
    return;
  }
  active = null;
  emit();
  if (goOnline) {
    current.onGoOnline?.();
  }
}
