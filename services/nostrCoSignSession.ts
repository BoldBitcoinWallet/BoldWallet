import type { CoSignRequestPayload } from './nostrMessaging';

export interface PendingCoSignRequest {
  senderNpub: string;
  senderFingerprint: string;
  recipientFingerprint: string;
  request: CoSignRequestPayload;
  envelopeId: string;
  receivedAt: number;
}

let pending: PendingCoSignRequest | null = null;

export function setPendingCoSignRequest(value: PendingCoSignRequest): void {
  pending = value;
}

export function getPendingCoSignRequest(): PendingCoSignRequest | null {
  return pending;
}

export function clearPendingCoSignRequest(): void {
  pending = null;
}
