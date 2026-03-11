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
  | 'Fetching balance…'
  | 'Fetching UTXOs…'
  | 'Fetching transactions…'
  | 'Fetching fiat rate…'
  | string;

export interface ApiQueueState {
  label: ApiQueueLabel | null;
  startedAt: number;
}

type Subscriber = (state: ApiQueueState) => void;

interface QueuedJob {
  label: ApiQueueLabel;
  job: () => Promise<unknown>;
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
   * Returns a promise that resolves with the job result or rejects with the job error.
   */
  enqueue<T>(label: ApiQueueLabel, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this._queue.push({
        label,
        job: job as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this._drain();
    });
  }

  private _drain(): void {
    if (this._running || this._queue.length === 0) return;

    const next = this._queue.shift()!;
    const {label, job, resolve, reject} = next;
    this._notify({label, startedAt: Date.now()});
    dbg('ApiQueue: running', label);

    job()
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
