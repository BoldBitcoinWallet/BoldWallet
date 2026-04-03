/**
 * DB-first cache for LoadingScreen rolling quotes (remote QUOTES.md, one line per quote).
 *
 * Optional expiry metadata per line: `{DD/MM/YYYY}` (e.g. `{25/05/2026}`). If `Date.now()`
 * is after **end of that local calendar day**, the line is omitted. Tokens are stripped from
 * surviving lines for display. Multiple dates on one line: the quote stays until the **latest**
 * date’s day ends.
 */
import {dbg} from '../utils';
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';

export const LOADING_QUOTES_URL =
  'https://raw.githubusercontent.com/BoldBitcoinWallet/mempool-space-hosts/refs/heads/main/QUOTES.md';

const LOG = 'LoadingQuotes:';

/** Matches `{25/05/2026}`-style day/month/year (local timezone for expiry). */
const QUOTE_EXPIRY_TOKEN_RE = /\{(\d{1,2})\/(\d{1,2})\/(\d{4})\}/g;

function parseExpiryEndOfLocalDayMs(
  day: number,
  month: number,
  year: number,
): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

/** Remove all `{DD/MM/YYYY}` tokens; collapse whitespace. */
export function stripQuoteExpiryTokens(line: string): string {
  return line
    .replace(QUOTE_EXPIRY_TOKEN_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drops expired lines (by `{DD/MM/YYYY}`) and strips tokens from the rest.
 * @param nowMs - defaults to `Date.now()` (injectable for tests).
 */
export function filterExpiredQuotes(
  quotes: string[],
  nowMs: number = Date.now(),
): string[] {
  const out: string[] = [];
  for (const q of quotes) {
    if (typeof q !== 'string' || q.trim().length === 0) {
      continue;
    }
    let latestEndMs: number | null = null;
    for (const m of q.matchAll(QUOTE_EXPIRY_TOKEN_RE)) {
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      const endMs = parseExpiryEndOfLocalDayMs(day, month, year);
      if (endMs != null) {
        latestEndMs =
          latestEndMs == null ? endMs : Math.max(latestEndMs, endMs);
      }
    }
    if (latestEndMs != null && nowMs > latestEndMs) {
      dbg(`${LOG} skip expired quote`, q.slice(0, 120));
      continue;
    }
    const stripped = stripQuoteExpiryTokens(q);
    if (!stripped.length) {
      continue;
    }
    out.push(stripped);
  }
  return out;
}

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
    const active = filterExpiredQuotes(cleaned);
    if (active.length === 0) {
      dbg(`${LOG} cache invalid (all quotes expired by {DD/MM/YYYY})`);
      return null;
    }
    const ageMs =
      typeof fetchedAt === 'number' ? Date.now() - fetchedAt : null;
    log(
      `${LOG} cache hit`,
      `count=${active.length}`,
      typeof fetchedAt === 'number'
        ? `fetchedAt=${new Date(fetchedAt).toISOString()} ageMs=${ageMs}`
        : 'fetchedAt=(unknown)',
    );
    if (!silent) {
      dbg(`${LOG} cached quotes (full, ${active.length})`, active);
    }
    return active;
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
    const active = filterExpiredQuotes(remote, now);
    dbg(
      `${LOG} sync done (remote)`,
      `raw=${remote.length} active=${active.length}`,
      `wasCached=${cached != null}`,
    );
    return active;
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
