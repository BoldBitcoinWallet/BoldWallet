# Bitcoin display convention (Cash App–style)

## Rule

- **&lt; 1 BTC** → show in sats with **₿** prefix, e.g. `₿100`, `₿50,000`
- **≥ 1 BTC** → show in BTC, e.g. `1 BTC`, `100 BTC`

When the user selects **BTC** via the toggle on Wallet Home, **all** amounts app-wide use BTC (e.g. `0.0005 BTC`, `1.5 BTC`), overriding the above for &lt; 1 BTC.

## Global toggles

- **UserContext** exposes:
  - **`showSats` / `setShowSats`**: unit (₿ sats vs BTC). Persisted to EncryptedStorage `bitcoin_display_sats`. Toggle in WalletHome; all surfaces follow.
  - **`balanceFormattingEnabled` / `setBalanceFormattingEnabled`**: Raw Numbers vs Formatted (Settings > Display Format). Persisted to EncryptedStorage `balance_formatting_enabled`. When **false** (Raw): no thousand separators, e.g. `₿50000`, `0.00050000 BTC`. When **true** (Formatted): thousand separators, e.g. `₿50,000`, `0.0005 BTC`.

## Central formatter

**`formatBitcoinDisplay(amountBtc, options)`** in `utils.js`:

- **`inSats: true`** (default): &lt; 1 BTC → `₿` + sats; ≥ 1 BTC → number + `" BTC"`
- **`inSats: false`**: always BTC + `" BTC"` (e.g. `0.0005 BTC`, `1.5 BTC`)
- **`formatted: true`** (default): thousand separators / compact formatting. **`formatted: false`**: raw numbers (no separators), follows Settings “Raw Numbers”.

Use this for all **user-facing** Bitcoin amounts, passing **`inSats: showSats`** and **`formatted: balanceFormattingEnabled`** from `useUser()`. Keep `formatBTC` and `formatSats` for internal/calculation use.

---

## Implementation status

| Area | Status | What changed |
|------|--------|----------------|
| **UserContext** | Done | `showSats`, `setShowSats`; `balanceFormattingEnabled`, `setBalanceFormattingEnabled`; load/save from EncryptedStorage. |
| **utils.js** | Done | `formatBitcoinDisplay(amountBtc, { inSats, formatted })` — formatted = false → raw numbers. |
| **WalletHome** | Done | Balance: `formatBitcoinDisplay(..., { inSats: showSats, formatted: balanceFormattingEnabled })`. Unit toggle; fiat uses balanceFormattingEnabled. |
| **WalletSettings** | Done | Raw Numbers / Formatted switch uses `balanceFormattingEnabled` and `setBalanceFormattingEnabled` from context. |
| **TransactionList** | Done | `formatBitcoinDisplay(..., { inSats: showSats, formatted: balanceFormattingEnabled })` |
| **TransactionDetailsModal** | Done | Sent / Received / address / Fee: `formatBitcoinDisplay(..., { inSats: showSats, formatted: balanceFormattingEnabled })` |
| **SendBitcoinModal** | Done | QR alert, fee, balance, error: `formatBitcoinDisplay(..., { inSats: showSats, formatted: balanceFormattingEnabled })` |
| **PSBTModal** | Done | `formatBtcDisplay(sats)` → `formatBitcoinDisplay(..., { inSats: showSats, formatted: balanceFormattingEnabled })` |
| **WalletSkeleton** | N/A | No BTC/sats text (only style comment) |
| **TransactionListSkeleton** | N/A | No BTC/sats text |

---

## Edge cases

- **Zero:** `₿0` (sats mode) or `0 BTC` (BTC mode).
- **≥ 1 BTC in sats mode:** still show as `X BTC` (not ₿100,000,000).
- **Accessibility:** Where we show `₿100`, use `accessibilityLabel` like "100 sats" so screen readers are clear.

## Optional (not implemented)

- **MobileNostrPairing** / **MobilesPairing** any BTC/sats copy
