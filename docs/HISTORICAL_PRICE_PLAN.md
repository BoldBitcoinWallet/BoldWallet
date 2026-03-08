# Historical price for transaction list & details

## Goal

Use **historical BTC price at the time of each transaction** for fiat display in the transaction list and transaction details, instead of the current spot rate. If the historical rate is not available yet, do **not** show a fiat equivalent for that transaction (no fallback to “rate of now”).

## API

- **Endpoint:** `GET /api/v1/historical-price?currency={CUR}&timestamp={UNIX_SEC}`
- **Example:** `https://mempool.space/api/v1/historical-price?currency=EUR&timestamp=1500000000`
- **Response:** `{ prices: [ { time: number, EUR?: number, USD?: number, ... } ], exchangeRates?: object }`
  - Use the requested currency key from `prices[0]` (e.g. `prices[0].EUR`) as the rate (price per 1 BTC at that timestamp).

## Data we have per transaction

- **Confirmed:** `item.status.block_time` (Unix seconds).
- **Pending (our cache):** `item.sentAt` (ms). Convert to seconds for the API; for “pending” we may treat as “no historical rate” and hide fiat, or use current time (optional later).
- **Rule:** Only show fiat when we have a **confirmed** tx and a **cached or fetched** historical rate for that timestamp (and currency). Pending: no fiat, or keep current-rate behaviour as a separate decision.

## Efficient, persistent cache

1. **Cache key:** `historical_price_${currency}_${timestamp}`  
   Optionally **round timestamp to day** (e.g. `timestamp - (timestamp % 86400)`) to reduce keys and reuse the same rate for all txs that day. Trade-off: fewer API calls vs. slightly less precise “that day” price.
2. **Storage:** Use existing **LocalCache** (persistent on disk). Value: stringified number (rate) or a small JSON `{ rate: number, ts: number }` if we want metadata.
3. **In-memory layer (optional):** A small `Map<key, rate>` in a service so we don’t hit disk on every list render. Populate from LocalCache on first use and when we fetch new rates; write through to LocalCache when we get a new rate from the API.
4. **TTL:** Historical data is immutable. Cache **forever** (no expiry). Only eviction could be LRU/size limit if we ever have too many keys.

## Where to implement

1. **HistoricalPriceService (new)**  
   - `getHistoricalRate(currency: string, timestampUnixSec: number, baseApi: string): Promise<number | null>`  
     - Check in-memory cache then LocalCache; if miss, call `GET .../v1/historical-price?currency=...&timestamp=...` via **MempoolClient**, parse rate, store in LocalCache + in-memory, return rate. On API failure return `null`.
   - Use **MempoolClient** for the HTTP call so we get dedup + timeout. Add a long TTL for this URL pattern in MempoolClient (e.g. 24h or “forever” via a very large TTL) so repeated requests for the same (currency, timestamp) are served from cache.
2. **Transaction list (TransactionList.tsx)**  
   - For each visible (or rendered) tx that has `status?.block_time` and is confirmed:
     - Resolve `currency` from `selectedCurrency`, `timestamp` = `status.block_time` (already Unix sec).
     - Call `HistoricalPriceService.getHistoricalRate(currency, timestamp, baseApi)`.
     - If `null`: show no fiat (or “—”).
     - If number: show fiat as `btcAmount * rate` (same formatting as today).
   - To avoid N requests per list: **batch** unique `(currency, timestamp)` from the current page (or visible set), fetch missing rates once, then render. So: collect set of needed (currency, timestamp), fetch only missing, store in cache, then in render use cache (sync) so we don’t show fiat until we have the rate.
3. **Transaction details (TransactionDetailsModal.tsx)**  
   - Same idea: get `transaction.status.block_time` and `selectedCurrency`, call `getHistoricalRate(...)`. If we have a rate, show fiat; otherwise hide fiat. Reuse the same cache so opening details after list often hits cache.
4. **WalletHome / parents**  
   - Keep passing `selectedCurrency` and `baseApi`. We can keep passing a **current** `btcRate` for balance/summary (or other screens that explicitly want “now”); for **transaction list and details** the UI will ignore that for per-tx fiat and use only historical rate when available.

## Flow (transaction list)

1. When we have a list of transactions, extract unique `(currency, timestamp)` for confirmed txs (timestamp = `status.block_time`). Optionally round timestamp to day.
2. For each key not in cache, call historical-price API (or batch in one pass: one request per unique (currency, timestamp) with dedup via MempoolClient).
3. Persist new rates in LocalCache + in-memory.
4. Re-render: for each tx, look up rate from cache; if present show fiat, else show nothing for that row.
5. Same for details modal: one (currency, timestamp), fetch if missing, show fiat only when rate exists.

## Pending transactions

- **Recommendation:** For pending txs (no `block_time`), **do not show fiat** with historical API (no timestamp). Optionally we could keep showing “current” rate only for pending in a second phase; the plan above focuses on “historical only when we have it, else hide.”

## Summary checklist

- [ ] Add **HistoricalPriceService**: in-memory + LocalCache, `getHistoricalRate(currency, timestamp, baseApi)`.
- [ ] Use **MempoolClient** for `GET .../v1/historical-price?currency=...&timestamp=...`; add TTL rule (long or “forever”) for this path.
- [ ] **TransactionList**: collect (currency, timestamp) for confirmed txs → fetch missing rates → store → in render use cache and show fiat only when rate exists.
- [ ] **TransactionDetailsModal**: same for single tx; show fiat only when historical rate is available.
- [ ] Optional: round timestamp to day to reduce cache size and API calls.
- [ ] Pending: no fiat (or later: optional current-rate for pending only).
