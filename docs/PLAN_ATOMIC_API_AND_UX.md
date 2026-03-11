# Plan: Atomic HD Operations, Central API, CacheIndicator Status & Failure Toasts

## Goals

1. **Atomic HD operations** — Balance, UTXO, and Transaction fetches either all succeed (and we write to DB) or all roll back (no partial data on UI).
2. **HD indexes** — Already effectively atomic (discovery only commits when `discoveryStatus === 'ok'`); clarify and document; no change required unless we want to tighten.
3. **UTXO confirmed/unconfirmed** — Fix cases where UTXOs still show as unconfirmed (use mempoolClient, preserve block_time, avoid overwriting with null).
4. **Central API** — Only one “logical” API operation at a time app-wide (e.g. one refresh = balance then UTXOs then txs then price, serialized); and in CacheIndicator show **which** operation is running (e.g. “Fetching balance…”, “Fetching UTXOs…”).
5. **Failure toasts** — On any API failure that affects the user-visible data, show an informative Toast (e.g. “Could not fetch balance. Using cached data.”).

---

## 1. Atomic HD operations

### 1.1 Balance (all addresses must succeed)

**Current:** `BalanceSyncer.syncAddresses` and `WalletService.getWalletBalanceAggregate` loop over addresses; on per-address failure they continue and either skip that address or use DB fallback. UI can show a mix of fresh + stale.

**Target:**  
- **Option A (strict):** Fetch all addresses in memory first; only if **every** address returns `res.ok` then run a single DB transaction that writes all balances + aggregate; otherwise write nothing (leave previous DB state).  
- **Option B (softer):** Same “all or nothing” for the **current refresh**: if any address fails, discard all new data for this run and keep previous DB state; optionally show Toast “Could not fetch balance. Using cached data.”

**Implementation:**

- **BalanceSyncer**  
  - Change `syncAddresses` to:  
    - Build array of results in memory (one entry per address: `{ address, network, balanceSats, pendingSats, ... }`).  
    - Loop: for each address call `mempoolClient.get(...)`. If any call throws or `!res.ok`, set a `failed = true` and break (or collect failures).  
    - If `!failed` and all ok: run a single `database.transaction` that for each result calls `balanceRepository.setBalance(...)` and at the end set the aggregate row.  
    - If `failed`: do not write anything; return (caller can Toast).  
  - Callers: WalletSettings `runRestoreIndexing` already expects sync to succeed; if we make BalanceSyncer throw on any failure, that fits. For SyncCoordinator background sync, we can either (a) keep current “best effort” for background and only use atomic in “user-triggered” refresh, or (b) make all sync atomic and Toast on failure.

- **getWalletBalanceAggregate**  
  - Same idea: loop all addresses, collect results in memory; if any `!res.ok` or throw, do not update any per-address or aggregate in DB; return cached aggregate if available. If all ok, write all per-address + aggregate in one go (or via existing per-address writes then aggregate, but only when `successCount === addresses.length`).

**Files:**  
`services/sync/BalanceSyncer.ts`, `services/WalletService.ts` (getWalletBalanceAggregate).

---

### 1.2 UTXO (all addresses must succeed)

**Current:**  
- UtxosScreen uses raw `fetch(utxoUrl)` in a loop; on failure it skips that address but still writes others via `replaceUtxosForAddress`.  
- Partial failures lead to mixed state and sometimes “unconfirmed” due to missing or overwritten `block_time`.

**Target:**  
- All UTXO requests go through **mempoolClient.get** (central cache + single place for errors).  
- Atomic: fetch all addresses’ UTXOs into memory; only if **every** address returns `res.ok` and valid array, then run one transaction that replaces UTXOs for all addresses (or clear + insert all); otherwise do not change DB (or keep previous state).  
- Ensure `block_time` / `status.block_time` is always persisted when API sends it, and never overwrite a stored confirmed `blockTime` with null when API omits it for a known-confirmed tx.

**Implementation:**

- **UtxosScreen**  
  - Replace `fetch(utxoUrl)` with `mempoolClient.get<ApiUtxo[]>(utxoUrl, { signal: controller.signal })`.  
  - Collect results: `Map<address, ApiUtxo[]>` (or array of `{ address, list }`).  
  - If any address fails (throw or `!res.ok` or !Array.isArray): do not call `replaceUtxosForAddress` for any address; optionally show Toast “Could not fetch UTXOs. Using cached data.”  
  - If all ok: in one `database.transaction` (or a single batch) call `replaceUtxosForAddress` for each address with the parsed list (including `blockTime: u.status?.block_time ?? null` and `isConfirmed: u.status?.confirmed ?? true`).  
  - When reading from DB, ensure `storedToUtxoWithPath` uses `u.blockTime` so confirmed/unconfirmed matches; do not overwrite stored `blockTime` with null when re-persisting if we already have a value (or ensure API response is the single source only when we do a full replace).

- **UtxoSyncer** (used by SyncCoordinator / WalletSettings)  
  - Same contract: collect all addresses’ responses; only if all succeed, write all; otherwise write nothing and optionally throw so caller can Toast.

**Files:**  
`screens/UtxosScreen.tsx`, `services/sync/UtxoSyncer.ts`, `services/repositories/UtxoRepository.ts` (if we need a batch “replace all for these addresses” helper).

---

### 1.3 Transactions (all addresses must succeed)

**Current:**  
- TransactionSyncer syncs one address at a time; per-address failure is logged but others are still written.  
- TransactionList fetches per-address and merges; partial failure can lead to incomplete list.

**Target:**  
- For a “full refresh” (e.g. pull-to-refresh or post-unlock): fetch transactions for **all** addresses; only if **every** address returns ok (or ok + empty array), then persist all and update UI from DB; otherwise persist nothing new and keep previous DB state, show Toast.

**Implementation:**

- **TransactionSyncer**  
  - Add (or use) a method that takes `addresses[]` and apiBase:  
    - For each address, call mempoolClient (cursor-based as today).  
    - Collect all results in memory.  
    - If any address fails: return without writing.  
    - If all ok: run one transaction that inserts/upserts all tx rows for all addresses.  
  - Keep existing `syncAddress` for single-address use if needed, but “full sync” entry point should be atomic.

- **TransactionList**  
  - When doing the initial load or “refresh all”, request txs for all addresses; if the syncer/API layer returns “partial failure”, do not merge partial into state; keep previous list and show Toast “Could not fetch transactions. Using cached data.”

**Files:**  
`services/sync/TransactionSyncer.ts`, `components/TransactionList.tsx`.

---

### 1.4 HD indexes (receive / change)

**Current:**  
`discoverHdIndexesForNetwork` only commits indexes and sets `restoreDone` when `discoveryStatus === 'ok'`. On `partial` or `failed` it does not update external/change indexes (only discovery status). So it is already “all or nothing” for index updates.

**Action:**  
- No code change required.  
- Optionally: add a one-line comment in code and in this doc: “HD index discovery is atomic: indexes are only written when the full external + internal scan succeeds.”

---

## 2. UTXO confirmed/unconfirmed fix

**Causes:**  
- UtxosScreen uses raw `fetch` (no mempoolClient) and per-address partial writes; one failing address can leave others with stale or missing `block_time`.  
- If API sometimes omits `block_time` for a confirmed tx, we must not overwrite a previously stored `blockTime` with null when we do a full replace (or we must derive confirmed from `block_height` when `block_time` is missing).

**Changes:**  
1. Use **mempoolClient.get** in UtxosScreen (and UtxoSyncer) for all UTXO URLs (see 1.2).  
2. When mapping API → StoredUtxo:  
   - Set `blockTime: u.status?.block_time ?? null`, `isConfirmed: u.status?.confirmed ?? true`.  
   - If we later add “merge with existing DB” for confirmed status: when API omits `block_time` but we have it in DB for that txid+vout, keep the existing `blockTime` (don’t overwrite with null).  
3. Ensure `storedToUtxoWithPath` and the UI use `u.blockTime` / `status.block_time` consistently so the summary card and list row agree.

**Files:**  
`screens/UtxosScreen.tsx`, `services/sync/UtxoSyncer.ts`, `services/repositories/UtxoRepository.ts` (and any place that does replaceUtxosForAddress).

---

## 3. Central API: one logical operation at a time + status

**Idea:**  
- App-wide, only one “logical” API operation runs at a time (e.g. “balance”, “UTXOs”, “transactions”, “price”).  
- Each logical operation can do multiple HTTP requests **sequentially** (e.g. balance for 25 addresses = 25 calls one after another).  
- So we need a **global queue (mutex)** in the API layer: e.g. “ApiQueue” or “MempoolClient.runExclusive(job)” that runs jobs one at a time.  
- Each job has a **label** (“balance” | “utxo” | “transactions” | “price”) so the UI can show “Fetching balance…”, “Fetching UTXOs…”, etc.

**Implementation:**

- **ApiQueue (or MempoolClient extension)**  
  - New module or extend MempoolClient:  
    - A queue of jobs. Each job is `() => Promise<T>` and has a `label: string`.  
    - Only one job runs at a time. When a job is running, its label is the “current operation”.  
    - Expose `getCurrentOperation(): string | null` (or a small object `{ label, startedAt }`) and a way to subscribe (e.g. callback or React context) so UI can show it.  
  - All balance, UTXO, transaction, and price fetches that are part of “refresh” go through this queue: e.g. `apiQueue.enqueue('balance', () => getWalletBalanceAggregate(...))`, etc.

- **WalletHome refresh flow**  
  - When user taps refresh (or CacheIndicator triggers refresh):  
    - Enqueue four jobs in order: balance → UTXOs → transactions → price (or a single “fullRefresh” job that runs them sequentially and sets “current operation” for each step).  
  - So at any time only one of these is running; no parallel balance + UTXO + tx fetches.

- **UtxosScreen refresh**  
  - When user refreshes UTXO screen only: enqueue one job with label “utxo” (or “Fetching UTXOs…”).  
  - Same queue so if WalletHome is already running “balance”, UTxosScreen’s refresh waits until the queue is free, then runs.

**Files:**  
- New: `services/ApiQueue.ts` (or `services/MempoolClient.ts` extension) with queue + current operation label + optional subscriber.  
- `screens/WalletHome.tsx`: trigger refresh via queue; pass current operation to CacheIndicator.  
- `screens/UtxosScreen.tsx`: trigger UTXO fetch via queue; pass current operation to CacheIndicator.

---

## 4. CacheIndicator: informative status text

**Current:**  
When `isRefreshing` is true, CacheIndicator shows “Refreshing...”.

**Target:**  
When refreshing, show **which** operation is running, e.g.:  
- “Fetching balance…”  
- “Fetching UTXOs…”  
- “Fetching transactions…”  
- “Fetching fiat rate…”

**Implementation:**

- **CacheIndicator**  
  - Add optional prop: `statusMessage?: string`.  
  - When `isRefreshing` is true, display `statusMessage ?? 'Refreshing...'` instead of the hardcoded “Refreshing...”.  
  - So parent is responsible for setting the message (from ApiQueue’s current operation or from local state that tracks the step).

- **WalletHome**  
  - Get “current operation” from ApiQueue (or from the callback that runs balance → utxo → txs → price and sets a state like `refreshStatusMessage`).  
  - Pass to CacheIndicator: `statusMessage={refreshStatusMessage}` (e.g. “Fetching balance…”, “Fetching UTXOs…”, …).

- **UtxosScreen**  
  - When its own refresh runs, set a local status message “Fetching UTXOs…” (or get it from queue label) and pass to CacheIndicator.

**Files:**  
`components/CacheIndicator.tsx`, `screens/WalletHome.tsx`, `screens/UtxosScreen.tsx`.

---

## 5. Informative Toast on API failure

**Places to show Toast:**  
- After atomic balance run: if any address failed, Toast “Could not fetch balance. Using cached data.”  
- After atomic UTXO run: if any address failed, Toast “Could not fetch UTXOs. Using cached data.”  
- After atomic transaction run: if any address failed, Toast “Could not fetch transactions. Using cached data.”  
- Price fetch failure: “Could not fetch fiat rate. Using cached rate.”  
- Optionally: generic “Sync failed. Using cached data.” when the central “full refresh” fails.

**Implementation:**  
- In the same places we implement “all or nothing” (BalanceSyncer, UtxosScreen fetch, TransactionSyncer, WalletHome fetchData price path), when we detect failure (partial or full), call `Toast.show({ type: 'error', text1: '...', text2: 'Using cached data.', ... })`.  
- Use a small helper if desired: `showApiFailureToast(feature: 'balance' | 'utxo' | 'transactions' | 'price')` to keep copy consistent.

**Files:**  
`screens/WalletHome.tsx`, `screens/UtxosScreen.tsx`, `services/sync/BalanceSyncer.ts`, `services/sync/TransactionSyncer.ts`, `services/sync/UtxoSyncer.ts` (and optionally a shared `utils/showApiFailureToast.ts`).

---

## 6. Implementation order (recommended)

1. **ApiQueue + current operation label**  
   - Add `services/ApiQueue.ts` (queue, run one job at a time, expose current label).  
   - No UI change yet; just the queue and a way to run “balance”, “utxo”, “transactions”, “price” as separate jobs.

2. **CacheIndicator status message**  
   - Add `statusMessage?: string` to CacheIndicator; WalletHome and UtxosScreen pass a string (e.g. from local state first, then later from ApiQueue).  
   - Wire WalletHome refresh to set message per step (balance → utxo → txs → price) and pass to CacheIndicator.

3. **Atomic balance**  
   - BalanceSyncer: collect all, write all or nothing; throw or return success boolean.  
   - getWalletBalanceAggregate: same; only write when all addresses ok.  
   - Run balance refresh through ApiQueue with label “Fetching balance…”.  
   - On failure: Toast “Could not fetch balance. Using cached data.”

4. **Atomic UTXO**  
   - UtxosScreen: use mempoolClient.get; collect all addresses; write all or nothing; set status message “Fetching UTXOs…”.  
   - UtxoSyncer: same contract for sync path.  
   - On failure: Toast “Could not fetch UTXOs. Using cached data.”  
   - Confirm block_time handling so confirmed/unconfirmed is stable (no “refresh many times” to get confirmed).

5. **Atomic transactions**  
   - TransactionSyncer: full sync = collect all addresses’ txs, then one transaction write or nothing.  
   - TransactionList: when refresh fails (partial), don’t merge partial; show Toast “Could not fetch transactions. Using cached data.”  
   - Run through ApiQueue with label “Fetching transactions…”.

6. **Price**  
   - Run price fetch through ApiQueue (“Fetching fiat rate…”).  
   - On failure: Toast “Could not fetch fiat rate. Using cached rate.”

7. **Integration**  
   - WalletHome: single “refresh” = enqueue sequence [balance, utxo, transactions, price] (or one job that does all four and updates status message).  
   - UtxosScreen: refresh = enqueue one “utxo” job.  
   - Ensure only one job runs app-wide at a time; CacheIndicator in both screens shows the current job’s label.

---

## 7. 429 (rate limit) handling

**Current behavior:** We run one logical operation at a time (queue). Within that operation we still issue **multiple requests** (e.g. one per address for balance, then UTXOs, then txs). If any request returns **429 Too Many Requests**, the syncer throws (e.g. `BalanceSyncError`), we write nothing (atomic), and the user sees “Could not fetch balance. Using cached data.” So we stay correct but don’t recover from rate limits.

**Goal:** When the API returns 429, **retry with backoff** so that the same logical operation often succeeds without user action, while keeping **atomicity** (only write when all addresses succeed, possibly after retries).

**Options (before implementing):**

| Approach | Where | Pros | Cons |
|----------|--------|------|------|
| **A. Retry in syncers** | BalanceSyncer, UtxoSyncer, TransactionSyncer | Per-operation policy; can stop after N retries and still throw (atomic). | Same logic in 3 places unless shared helper. |
| **B. Retry in MempoolClient** | MempoolClient.get() | One place; all callers benefit. | Not all callers may want the same delay; 429 responses must not be cached. |
| **C. Throttling only** | Add delay between addresses in each syncer | Reduces chance of 429. | Does not help if we’re already at the limit when we start. |
| **D. Caller retry** | SyncCoordinator / WalletHome | Can show “Rate limited, retrying…” and re-enqueue. | More complex; duplicates “one job at a time” semantics. |

**Recommended:** **A (retry in syncers)** plus optional **C (small delay between addresses)**.

- **A – Retry on 429 in each syncer**
  - When `res.status === 429`: do **not** throw immediately.
  - Wait: use `Retry-After` header (seconds) if present and reasonable (e.g. 1–120 s), else a fixed backoff (e.g. 30 s).
  - Retry **only the same address** (same request). Cap retries (e.g. 2 retries → 3 attempts total).
  - If the retried request succeeds, continue to the next address as today; if it still returns 429 after retries, **then** throw (e.g. `BalanceSyncError`) so we stay atomic and show the existing Toast.
  - Optional: expose `retryAfterSeconds` from MempoolClient (e.g. on a small wrapper or by reading headers in the syncer’s fetch path). If we don’t want to change MempoolClient, use a fixed delay (e.g. 30 s) for 429 in the syncer.
- **C – Throttling (optional)**
  - Add a short delay between addresses (e.g. 200–500 ms) in the balance/UTXO/tx loops to reduce the chance of hitting 429 when many addresses are synced in one run.

**Atomicity:** Unchanged. We still only write when **every** address has succeeded (possibly after retries). If we give up after N 429 retries for one address, we throw and write nothing.

**UX:** User may see “Fetching balance…” for longer when 429 occurs and we’re waiting/retrying. Optionally we could surface “Rate limited, retrying…” in CacheIndicator when we’re in a 429 backoff (nice-to-have; not required for the first version).

---

## 8. Summary table

| Area              | Atomic? | Central API (queue)? | Status text              | Toast on failure      |
|-------------------|--------|-----------------------|---------------------------|------------------------|
| HD indexes        | Yes (already) | N/A (discovery is its own flow) | N/A                       | Already in WalletSettings |
| Balance           | Yes (all or nothing) | Yes, label “Fetching balance…” | CacheIndicator            | “Could not fetch balance. Using cached data.” |
| UTXO              | Yes (all or nothing) | Yes, label “Fetching UTXOs…”   | CacheIndicator            | “Could not fetch UTXOs. Using cached data.”   |
| Transactions      | Yes (all or nothing) | Yes, label “Fetching transactions…” | CacheIndicator            | “Could not fetch transactions. Using cached data.” |
| Price             | Single call   | Yes, label “Fetching fiat rate…”    | CacheIndicator            | “Could not fetch fiat rate. Using cached rate.”   |

This plan gives you atomic HD operations, a single logical API operation at a time, clear status in CacheIndicator, and user-visible Toasts on failure, while fixing the UTXO confirmed/unconfirmed behavior by centralizing on mempoolClient and careful block_time handling.
