# Background sync

## SyncCoordinator

[`SyncCoordinator.ts`](./SyncCoordinator.ts) runs balance, UTXO, transaction, price, and HD-discovery workers on a schedule and when the app returns to the foreground. It fetches from the configured Mempool REST base and writes results into SQLite via repositories and `WalletService`. Failed runs record status for retry; they are not meant to crash the app.

## SQLite as source of truth for most UI

Screens typically **read** balances, UTXOs, and metadata from SQLite (through repositories). Background sync keeps those tables fresh without requiring the user to open a given screen.

## Transaction list: background sync plus interactive refresh

The home transaction list ([`components/TransactionList.tsx`](../../components/TransactionList.tsx)) is a deliberate exception:

- It **pre-populates** from the local cache / DB so rows appear immediately.
- Home owns the initial live tx sync (`deferInitialFetch`) via `runWalletRefreshSession`. Pull-to-refresh waits for that session then reloads SQLite.
- Pagination and non-Home callers may still call Mempool REST (via `MempoolClient`, `TransactionSyncer`, or `WalletService`) to fetch newer pages, merge with pending sends, and update the cache. On errors they **fall back** to cached data instead of clearing the list.

So the statement “UI reads only from SQLite” describes the **default** data path and **SyncCoordinator’s** role; it does not apply to every interactive code path in the transaction list. Do not remove those API calls without a product decision and regression testing around pull-to-refresh and pagination.
