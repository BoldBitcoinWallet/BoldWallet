import type { CoSignRequestPayload } from './nostrMessaging';

export interface PendingCoSignRequest {
  mode?: 'legacy' | 'nip46';
  senderNpub: string;
  senderFingerprint: string;
  recipientFingerprint: string;
  request: CoSignRequestPayload;
  envelopeId: string;
  receivedAt: number;
  nip46RequestId?: string;
  nip46SenderPubHex?: string;
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
