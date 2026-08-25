/**
 * ApiQueue — app-wide serialization of logical API operations.
 *
 * Only one job runs at a time. Each job has a label (e.g. "Fetching balance…")
 * so the UI can show what is currently running. Used by WalletHome and
 * UtxosScreen to avoid parallel balance/UTXO/tx/price fetches and to drive
 * CacheIndicator status text.
 */
import {dbg} from '../utils';

export type ApiQueueLabel =
  | 'Syncing balance…'
  | 'Syncing UTXOs…'
  | 'Syncing transactions…'
  | 'Syncing fiat rate…'
  | string;

export interface ApiQueueState {
  label: ApiQueueLabel | null;
  startedAt: number;
  /** When set, show address progress e.g. "3 of 5 addresses" next to the label. */
  progress?: { current: number; total: number };
}

export type SetProgressFn = (current: number, total: number) => void;

type Subscriber = (state: ApiQueueState) => void;

interface QueuedJob {
  label: ApiQueueLabel;
  /** Receives setProgress to report current/total during the job. */
  job: (setProgress: SetProgressFn) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

class ApiQueue {
  private _queue: QueuedJob[] = [];
  private _running: ApiQueueState | null = null;
  private _subscribers = new Set<Subscriber>();

  /** Current operation, or null if idle. */
  getCurrentState(): ApiQueueState | null {
    return this._running;
  }

  /** Subscribe to current operation changes (e.g. for CacheIndicator). */
  subscribe(fn: Subscriber): () => void {
    this._subscribers.add(fn);
    if (this._running) fn(this._running);
    return () => {
      this._subscribers.delete(fn);
    };
  }

  private _notify(state: ApiQueueState | null): void {
    this._running = state;
    this._subscribers.forEach(fn => {
      try {
        if (state) fn(state);
        else fn({label: null, startedAt: 0});
      } catch (e) {
        dbg('ApiQueue: subscriber error', e);
      }
    });
  }

  /**
   * Enqueue a job. It runs when its turn comes (after previous jobs finish).
   * The job receives setProgress(current, total) to report progress (e.g. 3/5 addresses).
   * Returns a promise that resolves with the job result or rejects with the job error.
   */
  enqueue<T>(
    label: ApiQueueLabel,
    job: (setProgress: SetProgressFn) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this._queue.push({
        label,
        job: job as (setProgress: SetProgressFn) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this._drain();
    });
  }

  /**
   * Drop all pending jobs and reject them. The currently running job (if any)
   * is NOT aborted — it will finish naturally but its result is discarded by
   * the caller since the network/context has changed.
   */
  clear(): void {
    const pending = this._queue.splice(0);
    for (const {label, reject} of pending) {
      reject(new Error(`ApiQueue cleared — job "${label}" dropped`));
    }
    dbg('ApiQueue: cleared', pending.length, 'pending jobs');
  }

  private _drain(): void {
    if (this._running || this._queue.length === 0) return;

    const next = this._queue.shift()!;
    const {label, job, resolve, reject} = next;
    const state: ApiQueueState = {label, startedAt: Date.now()};
    this._notify(state);
    dbg('ApiQueue: running', label);

    const setProgress: SetProgressFn = (current, total) => {
      if (this._running)
        this._notify({...this._running, progress: {current, total}});
    };

    job(setProgress)
      .then(result => {
        this._notify(null);
        dbg('ApiQueue: finished', label);
        resolve(result);
        this._drain();
      })
      .catch(err => {
        this._notify(null);
        dbg('ApiQueue: failed', label, err);
        reject(err);
        this._drain();
      });
  }
}

export const apiQueue = new ApiQueue();
export default apiQueue;
