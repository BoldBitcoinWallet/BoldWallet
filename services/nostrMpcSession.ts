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
  createdAt: number;
  deadlineAt: number;
  maxDeadlineAt: number;
  timeoutMs: number;
  timeout: ReturnType<typeof setTimeout> | null;
};

type SessionRecord = {
  txId: string;
  traceId?: string;
  state: NostrMpcState;
  updatedAt: number;
};

type SessionLockRecord = {
  txId: string;
  traceId?: string;
  acquiredAt: number;
};

type SignerGuardRecord = {
  signers: Set<string>;
  requiredReadyCount: number;
  readySigners: Set<string>;
  committeeSize?: number;
};

const READY_TTL_MS = 2 * 60 * 1000;
const MAX_RECENT_READY = 300;
const LOCK_TTL_MS = 3 * 60 * 1000;
const WAITER_EXTENSION_STEP_MS = 15 * 1000;
const WAITER_MAX_EXTENSION_MS = 45 * 1000;

const STATE_RANK: Record<NostrMpcState, number> = {
  idle: 0,
  awaiting_peer: 1,
  computing_nonces: 2,
  signing: 3,
  broadcasting: 4,
  completed: 5,
  failed: 5,
};

function isTerminalState(state: NostrMpcState): boolean {
  return state === 'completed' || state === 'failed';
}

class NostrMpcSessionService {
  private sessions = new Map<string, SessionRecord>();
  private waiters = new Map<string, Waiter[]>();
  private recentReadyByTxId = new Map<string, { ts: number; traceId?: string }>();
  private recentReadyByCoord = new Map<string, number>();
  private signerGuards = new Map<string, SignerGuardRecord>();
  private sessionLocks = new Map<string, SessionLockRecord>();

  private coordKey(txId: string, traceId: string): string {
    return `${txId}::${traceId}`;
  }

  private emitState(
    txId: string,
    state: NostrMpcState,
    extra?: Record<string, unknown>,
  ): void {
    const existing = this.sessions.get(txId);
    const nextTraceId =
      typeof extra?.traceId === 'string'
        ? extra.traceId
        : existing?.traceId;

    if (existing) {
      const currentRank = STATE_RANK[existing.state];
      const nextRank = STATE_RANK[state];
      const traceMatches =
        !existing.traceId ||
        !nextTraceId ||
        existing.traceId === nextTraceId;

      if (traceMatches && nextRank < currentRank) {
        dbg('[NIP46-TLM][MpcSession] ignoring regressive transition', {
          txId,
          from: existing.state,
          to: state,
          traceId: existing.traceId,
        });
        return;
      }

      if (
        traceMatches &&
        state === existing.state &&
        !isTerminalState(existing.state)
      ) {
        // Idempotent duplicate transition for in-flight states.
        return;
      }

      if (isTerminalState(existing.state) && state !== existing.state) {
        dbg('[NIP46-TLM][MpcSession] ignoring transition from terminal state', {
          txId,
          from: existing.state,
          to: state,
          traceId: existing.traceId,
        });
        return;
      }
    }

    const next: SessionRecord = {
      txId,
      traceId: nextTraceId,
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

    if (isTerminalState(state)) {
      this.releaseLock(txId, next.traceId);
    }
  }

  private normalizeTraceId(traceId?: string): string | undefined {
    const trace = String(traceId || '').trim();
    return trace || undefined;
  }

  private hasFreshLock(lock: SessionLockRecord): boolean {
    return Date.now() - lock.acquiredAt <= LOCK_TTL_MS;
  }

  private acquireLock(txId: string, traceId?: string): boolean {
    const normalizedTrace = this.normalizeTraceId(traceId);
    const existing = this.sessionLocks.get(txId);
    if (!existing) {
      this.sessionLocks.set(txId, {
        txId,
        traceId: normalizedTrace,
        acquiredAt: Date.now(),
      });
      return true;
    }

    const sameTrace =
      !existing.traceId ||
      !normalizedTrace ||
      existing.traceId === normalizedTrace;
    if (sameTrace) {
      existing.acquiredAt = Date.now();
      if (normalizedTrace && !existing.traceId) {
        existing.traceId = normalizedTrace;
      }
      this.sessionLocks.set(txId, existing);
      return true;
    }

    if (!this.hasFreshLock(existing)) {
      this.sessionLocks.set(txId, {
        txId,
        traceId: normalizedTrace,
        acquiredAt: Date.now(),
      });
      return true;
    }

    dbg('[NIP46-TLM][MpcSession] lock contention, rejecting conflicting trace', {
      txId,
      lockTraceId: existing.traceId,
      incomingTraceId: normalizedTrace,
    });
    return false;
  }

  private releaseLock(txId: string, traceId?: string): void {
    const existing = this.sessionLocks.get(txId);
    if (!existing) return;
    const normalizedTrace = this.normalizeTraceId(traceId);
    const canRelease =
      !existing.traceId ||
      !normalizedTrace ||
      existing.traceId === normalizedTrace;
    if (!canRelease) return;
    this.sessionLocks.delete(txId);
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
      if (entry.timeout) clearTimeout(entry.timeout);
      entry.resolve(ready);
    });
  }

  private traceMatches(expectedTraceId?: string, incomingTraceId?: string): boolean {
    const expected = String(expectedTraceId || '').trim();
    const incoming = String(incomingTraceId || '').trim();
    return !expected || !incoming || expected === incoming;
  }

  private scheduleWaiterTimeout(txId: string, entry: Waiter): void {
    const remaining = Math.max(1, entry.deadlineAt - Date.now());
    entry.timeout = setTimeout(() => {
      const list = this.waiters.get(txId) || [];
      const kept = list.filter(item => item.resolve !== entry.resolve);
      if (kept.length > 0) {
        this.waiters.set(txId, kept);
      } else {
        this.waiters.delete(txId);
      }
      this.emitState(txId, 'failed', {
        source: 'peer-ready-timeout',
        traceId: entry.expectedTraceId,
      });
      entry.resolve(false);
    }, remaining);
  }

  private extendWaitersOnProgress(
    txId: string,
    traceId?: string,
    source?: string,
  ): void {
    const entries = this.waiters.get(txId) || [];
    if (entries.length === 0) return;

    const now = Date.now();
    let changed = false;
    for (const entry of entries) {
      if (!this.traceMatches(entry.expectedTraceId, traceId)) {
        continue;
      }

      const nextDeadline = Math.min(
        entry.maxDeadlineAt,
        Math.max(entry.deadlineAt, now) + WAITER_EXTENSION_STEP_MS,
      );
      if (nextDeadline <= entry.deadlineAt) {
        continue;
      }

      if (entry.timeout) clearTimeout(entry.timeout);
      entry.deadlineAt = nextDeadline;
      this.scheduleWaiterTimeout(txId, entry);
      changed = true;
    }

    if (changed) {
      dbg('[NIP46-TLM][MpcSession] extended peer-ready waiter on related traffic', {
        txId,
        traceId,
        source,
      });
    }
  }

  private resolveWaitersForReady(txId: string, traceId?: string): void {
    const entries = this.waiters.get(txId) || [];
    if (entries.length === 0) return;

    const pending: Waiter[] = [];
    for (const entry of entries) {
      const isMatch = this.traceMatches(entry.expectedTraceId, traceId);
      if (isMatch) {
        if (entry.timeout) clearTimeout(entry.timeout);
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
    if (!this.acquireLock(txId, traceId)) {
      return;
    }
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
    if (!this.acquireLock(txId, extra?.traceId)) {
      return;
    }
    const existing = this.sessions.get(txId);
    if (existing && STATE_RANK[existing.state] >= STATE_RANK.computing_nonces) {
      this.addRecentReady(txId, extra?.traceId);
      this.extendWaitersOnProgress(txId, extra?.traceId, 'peer-ready-late');
      this.resolveWaitersForReady(txId, extra?.traceId);
      return;
    }
    const senderNpub = String(extra?.senderNpub || '').trim();
    const guard = this.signerGuards.get(txId);
    if (guard && guard.signers.size > 0) {
      if (!senderNpub || !guard.signers.has(senderNpub)) {
        dbg('[NIP46-TLM][MpcSession] ignoring ready from non-designated signer', {
          txId,
          senderNpub,
          allowedSigners: Array.from(guard.signers),
        });
        return;
      }
      guard.readySigners.add(senderNpub);
      const needed = Math.max(1, guard.requiredReadyCount);
      if (guard.readySigners.size < needed) {
        dbg('[NIP46-TLM][MpcSession] waiting for more designated signers', {
          txId,
          ready: guard.readySigners.size,
          required: needed,
        });
        return;
      }
    }
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
    if (!this.acquireLock(txId, extra?.traceId)) {
      return;
    }
    const existing = this.sessions.get(txId);
    if (existing && STATE_RANK[existing.state] >= STATE_RANK.signing) {
      this.extendWaitersOnProgress(txId, extra?.traceId, `payload:${payloadType}:already-signing`);
      return;
    }
    this.extendWaitersOnProgress(txId, extra?.traceId, `payload:${payloadType}`);
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
    if (!this.acquireLock(txId, expectedTraceId)) {
      return Promise.resolve(false);
    }

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
      const entry: Waiter = {
        expectedTraceId: expected || undefined,
        resolve,
        createdAt: Date.now(),
        deadlineAt: Date.now() + timeoutMs,
        maxDeadlineAt: Date.now() + timeoutMs + WAITER_MAX_EXTENSION_MS,
        timeoutMs,
        timeout: null,
      };
      this.scheduleWaiterTimeout(txId, entry);
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

  getSessionState(txId: string): NostrMpcState | null {
    const id = String(txId || '').trim();
    if (!id) return null;
    return this.sessions.get(id)?.state || null;
  }

  registerSignerSubset(
    txId: string,
    signerNpubs: string[],
    requiredReadyCount = 1,
    committeeSize?: number,
  ): void {
    const id = String(txId || '').trim();
    if (!id) return;
    const normalized = Array.from(
      new Set(
        (signerNpubs || [])
          .map(v => String(v || '').trim())
          .filter(Boolean),
      ),
    );
    if (normalized.length === 0) {
      this.signerGuards.delete(id);
      return;
    }
    this.signerGuards.set(id, {
      signers: new Set(normalized),
      requiredReadyCount: Math.max(1, Math.min(requiredReadyCount, normalized.length)),
      readySigners: new Set<string>(),
      committeeSize:
        typeof committeeSize === 'number' && Number.isFinite(committeeSize)
          ? Math.max(2, Math.trunc(committeeSize))
          : undefined,
    });
  }

  getRegisteredSigners(txId: string): string[] {
    const id = String(txId || '').trim();
    if (!id) return [];
    const guard = this.signerGuards.get(id);
    if (!guard || guard.signers.size === 0) return [];
    return Array.from(guard.signers);
  }

  isStrictDuoSession(txId: string): boolean {
    const id = String(txId || '').trim();
    if (!id) return false;
    const guard = this.signerGuards.get(id);
    return !!guard && guard.committeeSize === 2;
  }

  clearSignerSubset(txId: string): void {
    const id = String(txId || '').trim();
    if (!id) return;
    this.signerGuards.delete(id);
  }

  endSession(txId: string, success: boolean): void {
    if (!txId) return;
    this.emitState(txId, success ? 'completed' : 'failed', {
      source: 'session-end',
    });
    this.resolveWaiters(txId, false);
    this.signerGuards.delete(txId);
    this.releaseLock(txId, this.sessions.get(txId)?.traceId);
  }
}

const nostrMpcSession = new NostrMpcSessionService();

export default nostrMpcSession;
