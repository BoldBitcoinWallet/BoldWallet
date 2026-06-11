# Deep links (BoldWallet)

BoldWallet accepts external payment URLs via standard **BIP-21** `bitcoin:` URIs only. There is no HTTPS pay page or App Links association for payments (privacy-first).

## Payment links

```
bitcoin:<address>?amount=<btc-decimal>&label=<optional>
```

Handled in `incomingUrlRouter` → `IncomingUrlHandler` → Send screen prefill (`sendAddress`, `sendAmountBtc`).

## Keyshare import

```
boldwallet://import-keyshare
```

Opens the keyshare import flow (not a payment link).

## Platform registration

- **Android:** `bitcoin` and `boldwallet` schemes in `AndroidManifest.xml` (no verified HTTPS `/pay` intent filters).
- **iOS:** `bitcoin` and `boldwallet` URL schemes in `Info.plist` (no Associated Domains for pay).

## Verification

- **Android:** `adb shell am start -a android.intent.action.VIEW -d "bitcoin:bc1qtest?amount=0.001"`
- **iOS:** Open `bitcoin:bc1qtest?amount=0.001` from Notes or Safari.
- **Keyshare:** `adb shell am start -a android.intent.action.VIEW -d "boldwallet://import-keyshare"`
