/**
 * Raw fetch to mempool endpoints that are not JSON (tip hash, etc.).
 * Records into the Calls tab the same way MempoolClient does.
 */
import {
  appendMempoolRequest,
  type MempoolRequestSource,
} from './mempoolRequestLog';

function isAbortOrTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const name = (err as {name?: string}).name ?? '';
  const message = (err as {message?: string}).message ?? '';
  return name === 'AbortError' || /timeout|aborted/i.test(message);
}

export async function tracedMempoolFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const startedAt = Date.now();
  const method = (init?.method || 'GET').toUpperCase();
  try {
    const res = await fetch(url, init);
    let bodyText = '';
    try {
      bodyText = await res.clone().text();
    } catch {
      bodyText = '';
    }
    appendMempoolRequest({
      url,
      method,
      status: res.status,
      source: 'live',
      durationMs: Date.now() - startedAt,
      body: bodyText,
    });
    return res;
  } catch (err) {
    const timedOut = isAbortOrTimeout(err);
    const source: MempoolRequestSource = timedOut ? 'timeout' : 'live';
    appendMempoolRequest({
      url,
      method,
      status: 0,
      source,
      durationMs: Date.now() - startedAt,
      body:
        timedOut
          ? 'timeout'
          : err instanceof Error
            ? err.message
            : String(err),
    });
    throw err;
  }
}
