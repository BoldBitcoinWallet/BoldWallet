import { DeviceEventEmitter } from 'react-native';
import { dbg } from '../utils';

export type NostrMpcState =
  | 'idle'
  | 'awaiting_peer'
  | 'computing_nonces'
  | 'signing'
  | 'broadcasting'
  | 'completed'
  | 'failed';

type Waiter = {
  expectedTraceId?: string;
  resolve: (ready: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type SessionRecord = {
  txId: string;
  traceId?: string;
  state: NostrMpcState;
  updatedAt: number;
};

const READY_TTL_MS = 2 * 60 * 1000;
const MAX_RECENT_READY = 300;

class NostrMpcSessionService {
  private sessions = new Map<string, SessionRecord>();
  private waiters = new Map<string, Waiter[]>();
  private recentReadyByTxId = new Map<string, { ts: number; traceId?: string }>();
  private recentReadyByCoord = new Map<string, number>();

  private coordKey(txId: string, traceId: string): string {
    return `${txId}::${traceId}`;
  }

  private emitState(
    txId: string,
    state: NostrMpcState,
    extra?: Record<string, unknown>,
  ): void {
    const existing = this.sessions.get(txId);
    const next: SessionRecord = {
      txId,
      traceId:
        typeof extra?.traceId === 'string'
          ? extra.traceId
          : existing?.traceId,
      state,
      updatedAt: Date.now(),
    };
    this.sessions.set(txId, next);
    DeviceEventEmitter.emit('nostr-mpc:state', {
      txId,
      state,
      traceId: next.traceId,
      ts: next.updatedAt,
      ...(extra || {}),
    });
  }

  private addRecentReady(txId: string, traceId?: string): void {
    const ts = Date.now();
    this.recentReadyByTxId.set(txId, {
      ts,
      traceId: typeof traceId === 'string' && traceId.trim() ? traceId.trim() : undefined,
    });
    if (traceId && traceId.trim()) {
      this.recentReadyByCoord.set(this.coordKey(txId, traceId.trim()), ts);
    }
    if (this.recentReadyByTxId.size > MAX_RECENT_READY) {
      const oldest = this.recentReadyByTxId.keys().next().value;
      if (typeof oldest === 'string') this.recentReadyByTxId.delete(oldest);
    }
    if (this.recentReadyByCoord.size > MAX_RECENT_READY * 2) {
      const oldest = this.recentReadyByCoord.keys().next().value;
      if (typeof oldest === 'string') this.recentReadyByCoord.delete(oldest);
    }
  }

  private hasFreshRecentReady(txId: string, expectedTraceId?: string): boolean {
    const byTx = this.recentReadyByTxId.get(txId);
    if (!byTx) return false;
    if (Date.now() - byTx.ts > READY_TTL_MS) {
      this.recentReadyByTxId.delete(txId);
      if (byTx.traceId) {
        this.recentReadyByCoord.delete(this.coordKey(txId, byTx.traceId));
      }
      return false;
    }

    const expected = String(expectedTraceId || '').trim();
    if (!expected) return true;

    const exactKey = this.coordKey(txId, expected);
    const exactTs = this.recentReadyByCoord.get(exactKey);
    if (exactTs) {
      if (Date.now() - exactTs <= READY_TTL_MS) {
        return true;
      }
      this.recentReadyByCoord.delete(exactKey);
    }

    // Backward compatibility: older peers may omit traceId entirely.
    if (!byTx.traceId) return true;
    if (byTx.traceId === expected) return true;
    return false;
  }

  private resolveWaiters(txId: string, ready: boolean): void {
    const entries = this.waiters.get(txId) || [];
    this.waiters.delete(txId);
    entries.forEach(entry => {
      clearTimeout(entry.timeout);
      entry.resolve(ready);
    });
  }

  private resolveWaitersForReady(txId: string, traceId?: string): void {
    const entries = this.waiters.get(txId) || [];
    if (entries.length === 0) return;

    const pending: Waiter[] = [];
    for (const entry of entries) {
      const expected = String(entry.expectedTraceId || '').trim();
      const incoming = String(traceId || '').trim();
      const isMatch =
        !expected ||
        !incoming ||
        expected === incoming;
      if (isMatch) {
        clearTimeout(entry.timeout);
        entry.resolve(true);
      } else {
        pending.push(entry);
      }
    }

    if (pending.length > 0) {
      this.waiters.set(txId, pending);
      return;
    }
    this.waiters.delete(txId);
  }

  startSession(txId: string, traceId?: string): void {
    if (!txId) return;
    this.emitState(txId, 'awaiting_peer', {
      source: 'session-start',
      traceId,
    });
  }

  setState(txId: string, state: NostrMpcState, extra?: Record<string, unknown>): void {
    if (!txId) return;
    this.emitState(txId, state, extra);
  }

  markPeerReady(
    txId: string,
    extra?: { traceId?: string; senderNpub?: string },
  ): void {
    if (!txId) return;
    this.addRecentReady(txId, extra?.traceId);
    this.emitState(txId, 'computing_nonces', {
      source: 'peer-ready',
      ...(extra || {}),
    });
    this.resolveWaitersForReady(txId, extra?.traceId);
  }

  markPayloadReceived(
    txId: string,
    payloadType: string,
    extra?: { traceId?: string; senderNpub?: string },
  ): void {
    if (!txId) return;
    this.emitState(txId, 'signing', {
      source: 'mpc-payload',
      payloadType,
      ...(extra || {}),
    });
  }

  waitForPeerReady(
    txId: string,
    expectedTraceId?: string,
    timeoutMs = 45000,
  ): Promise<boolean> {
    if (!txId) return Promise.resolve(false);

    const expected = String(expectedTraceId || '').trim();
    if (this.hasFreshRecentReady(txId, expected)) {
      dbg('[NIP46-TLM][MpcSession] fast-path peer-ready hit from cache', {
        txId,
        expectedTraceId: expected || undefined,
      });
      this.emitState(txId, 'computing_nonces', {
        source: 'peer-ready-cache-hit',
        traceId: expected || undefined,
      });
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        const list = this.waiters.get(txId) || [];
        const kept = list.filter(item => item.resolve !== resolve);
        if (kept.length > 0) {
          this.waiters.set(txId, kept);
        } else {
          this.waiters.delete(txId);
        }
        this.emitState(txId, 'failed', {
          source: 'peer-ready-timeout',
        });
        resolve(false);
      }, timeoutMs);

      const entry: Waiter = {
        expectedTraceId: expected || undefined,
        resolve,
        timeout,
      };
      const list = this.waiters.get(txId) || [];
      list.push(entry);
      this.waiters.set(txId, list);
    });
  }

  hasPeerReady(txId: string, expectedTraceId?: string): boolean {
    if (!txId) return false;
    const expected = String(expectedTraceId || '').trim();
    return this.hasFreshRecentReady(txId, expected);
  }

  endSession(txId: string, success: boolean): void {
    if (!txId) return;
    this.emitState(txId, success ? 'completed' : 'failed', {
      source: 'session-end',
    });
    this.resolveWaiters(txId, false);
  }
}

const nostrMpcSession = new NostrMpcSessionService();

export default nostrMpcSession;
