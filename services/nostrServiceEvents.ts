import {DeviceEventEmitter} from 'react-native';
import {dbg} from '../utils';

export type NostrServiceEvent = {
  roomHash: string;
  type: string;
  traceId?: string;
  txId?: string;
  senderNpub?: string;
  payload?: unknown;
  receivedAt?: number;
};

const ROOT_EVENT = 'nostr-service:event';

function normalizeType(typeValue: unknown): string {
  if (typeof typeValue !== 'string') return 'message';
  const trimmed = typeValue.trim();
  if (!trimmed) return 'message';
  return trimmed;
}

function sanitize(event: Partial<NostrServiceEvent>): NostrServiceEvent | null {
  if (!event || typeof event !== 'object') return null;
  const roomHash = typeof event.roomHash === 'string' ? event.roomHash.trim() : '';
  if (!roomHash) return null;
  return {
    roomHash,
    type: normalizeType(event.type),
    traceId: typeof event.traceId === 'string' ? event.traceId : undefined,
    txId: typeof event.txId === 'string' ? event.txId : undefined,
    senderNpub: typeof event.senderNpub === 'string' ? event.senderNpub : undefined,
    payload: event.payload,
    receivedAt: typeof event.receivedAt === 'number' ? event.receivedAt : Date.now(),
  };
}

export function routeNostrServiceEvent(event: NostrServiceEvent): void {
  DeviceEventEmitter.emit(ROOT_EVENT, event);
  DeviceEventEmitter.emit(`${ROOT_EVENT}:${event.type.toLowerCase()}`, event);
}

export function consumeNativeNostrServiceEvent(nativeEvent: any): NostrServiceEvent | null {
  if (!nativeEvent || nativeEvent.tag !== 'NostrServiceEvent') {
    return null;
  }

  const raw = typeof nativeEvent.message === 'string' ? nativeEvent.message : '';
  if (!raw) {
    dbg('[NostrServiceEvent] empty message payload');
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<NostrServiceEvent>;
    const event = sanitize(parsed);
    if (!event) {
      dbg('[NostrServiceEvent] dropped malformed payload', raw);
      return null;
    }
    routeNostrServiceEvent(event);
    dbg('[NostrServiceEvent]', event.type, event.roomHash, event.txId || '', event.traceId || '');
    return event;
  } catch (error) {
    dbg('[NostrServiceEvent] parse failure', String(error), raw);
    return null;
  }
}
