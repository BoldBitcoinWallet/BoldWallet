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

Wakes a keyshare the share extension already copied into the app group. It does not carry the file itself. The password sheet opens before the file is read.

## Shared files

A `.share` keyshare or `.psbt` can arrive from any app (Files, Telegram, WhatsApp, Signal, or another share sheet). The sender does not matter.

- **Android:** `ACTION_SEND` and `ACTION_VIEW` accept `content://` and `file://` of any MIME type. The file is copied into app cache only after the activity resumes, then JavaScript receives a `file://` URI. Photos and other non-wallet bytes are classified and rejected.
- **iOS:** the share extension stages the file from the suggested name, or from the bytes when the temporary path has no `.share` or `.psbt` extension. Photos, video, PDF, and zip are ignored. Opening a file URL in the host app uses the same staging.

## Platform registration

- **Android:** `bitcoin` and `boldwallet` schemes in `AndroidManifest.xml` (no verified HTTPS `/pay` intent filters). Share and open-in use `ACTION_SEND` / `ACTION_VIEW`.
- **iOS:** `bitcoin` and `boldwallet` URL schemes in `Info.plist` (no Associated Domains for pay). The share extension is `BoldWalletShareExtension`.

## Verification

- **Android:** `adb shell am start -a android.intent.action.VIEW -d "bitcoin:bc1qtest?amount=0.001"`
- **iOS:** Open `bitcoin:bc1qtest?amount=0.001` from Notes or Safari.
- **Keyshare:** `adb shell am start -a android.intent.action.VIEW -d "boldwallet://import-keyshare"`
