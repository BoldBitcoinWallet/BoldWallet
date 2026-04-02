/**
 * DB-first cache for LoadingScreen rolling quotes (remote QUOTES.md, one line per quote).
 */
import {dbg} from '../utils';
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';

export const LOADING_QUOTES_URL =
  'https://raw.githubusercontent.com/BoldBitcoinWallet/mempool-space-hosts/refs/heads/main/QUOTES.md';

const LOG = 'LoadingQuotes:';

export type LoadingQuotesCachePayload = {
  quotes: string[];
  fetchedAt: number;
};

export function parseQuotesMarkdown(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let skippedBlank = 0;
  let skippedComment = 0;
  for (const line of lines) {
    const raw = line.replace(/\r$/, '');
    // Skip blank lines only; keep leading/trailing spaces and punctuation (e.g. … or ') as in the file.
    if (!raw.trim()) {
      skippedBlank += 1;
      continue;
    }
    if (/^\s*#/.test(raw)) {
      skippedComment += 1;
      continue;
    }
    out.push(raw);
  }
  dbg(
    `${LOG} parse`,
    `lines=${lines.length}`,
    `quotes=${out.length}`,
    `skipBlank=${skippedBlank}`,
    `skipComment=${skippedComment}`,
    `bytes=${text.length}`,
  );
  dbg(`${LOG} quotes (full, ${out.length})`, out);
  return out;
}

export function getCachedQuotes(options?: {silent?: boolean}): string[] | null {
  const silent = options?.silent === true;
  const log = (msg: string, ...rest: unknown[]) => {
    if (!silent) {
      dbg(msg, ...rest);
    }
  };
  const raw = appConfigRepository.get(CONFIG_KEYS.LOADING_QUOTES_JSON);
  if (!raw) {
    if (!silent) {
      dbg(`${LOG} cache miss (no DB row)`);
    }
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LoadingQuotesCachePayload>;
    const quotes = parsed.quotes;
    const fetchedAt = parsed.fetchedAt;
    if (!Array.isArray(quotes) || quotes.length === 0) {
      dbg(`${LOG} cache invalid (empty or missing quotes array)`);
      return null;
    }
    const cleaned = quotes.filter(
      q => typeof q === 'string' && q.length > 0 && q.trim().length > 0,
    );
    if (cleaned.length === 0) {
      dbg(`${LOG} cache invalid (all entries empty after filter)`);
      return null;
    }
    const ageMs =
      typeof fetchedAt === 'number' ? Date.now() - fetchedAt : null;
    log(
      `${LOG} cache hit`,
      `count=${cleaned.length}`,
      typeof fetchedAt === 'number'
        ? `fetchedAt=${new Date(fetchedAt).toISOString()} ageMs=${ageMs}`
        : 'fetchedAt=(unknown)',
    );
    if (!silent) {
      dbg(`${LOG} cached quotes (full, ${cleaned.length})`, cleaned);
    }
    return cleaned;
  } catch (e) {
    dbg(`${LOG} cache read JSON error`, e);
    return null;
  }
}

export function saveCachedQuotes(quotes: string[], fetchedAt: number): void {
  const payload: LoadingQuotesCachePayload = {quotes, fetchedAt};
  try {
    appConfigRepository.set(
      CONFIG_KEYS.LOADING_QUOTES_JSON,
      JSON.stringify(payload),
    );
    const approxBytes = JSON.stringify(payload).length;
    dbg(
      `${LOG} saved`,
      `count=${quotes.length}`,
      `fetchedAt=${new Date(fetchedAt).toISOString()}`,
      `approxJsonBytes=${approxBytes}`,
    );
    dbg(`${LOG} saved quotes (full, ${quotes.length})`, quotes);
  } catch (e) {
    dbg(`${LOG} save failed`, e);
  }
}

export async function fetchQuotesFromRemote(): Promise<string[]> {
  const t0 = Date.now();
  dbg(`${LOG} fetch start`, LOADING_QUOTES_URL);
  const res = await fetch(LOADING_QUOTES_URL, {
    headers: {'Accept': 'text/plain'},
  });
  if (!res.ok) {
    dbg(`${LOG} fetch HTTP error`, res.status, res.statusText);
    throw new Error(`QUOTES fetch failed: ${res.status}`);
  }
  const text = await res.text();
  const ms = Date.now() - t0;
  dbg(`${LOG} fetch body`, `bytes=${text.length}`, `networkMs=${ms}`);
  const quotes = parseQuotesMarkdown(text);
  if (quotes.length === 0) {
    dbg(`${LOG} fetch parse produced zero quotes`);
    throw new Error('QUOTES empty after parse');
  }
  dbg(`${LOG} fetch OK`, `quotes=${quotes.length}`, `totalMs=${Date.now() - t0}`);
  return quotes;
}

/**
 * Returns cached quotes immediately (sync read); updates cache from network in background when possible.
 * Resolves with the latest list after background fetch completes (or cached if fetch fails).
 */
export async function syncLoadingQuotes(): Promise<string[]> {
  dbg(`${LOG} sync`);
  const cached = getCachedQuotes({silent: true});
  if (cached?.length) {
    dbg(`${LOG} sync using cached snapshot`, `count=${cached.length}`);
  } else {
    dbg(`${LOG} sync no cache; will fetch remote`);
  }
  try {
    const remote = await fetchQuotesFromRemote();
    const now = Date.now();
    saveCachedQuotes(remote, now);
    dbg(
      `${LOG} sync done (remote)`,
      `returning=${remote.length}`,
      `wasCached=${cached != null}`,
    );
    return remote;
  } catch (e) {
    dbg(
      `${LOG} sync remote failed; using cache if any`,
      e instanceof Error ? e.message : e,
    );
    const fallback = cached ?? [];
    dbg(`${LOG} sync fallback`, `returning=${fallback.length}`);
    dbg(`${LOG} sync fallback quotes (full, ${fallback.length})`, fallback);
    return fallback;
  }
}
