# Bitcoin Wallet Recovery Guide

This guide explains how to recover and spend Bitcoin from your keyshares using the BBMTLib CLI tools, even if the mobile app is unavailable.

## ⚠️ CRITICAL SECURITY WARNING

**IMPORTANT: Using these recovery tools requires loading BOTH keyshares on the same computer.**

### Security Risks

When using the CLI recovery tools (`bold-spend` or `spend-bitcoin.sh`), **both keyshares are loaded into memory on the same machine**. This creates a significant security risk because:

1. **Both keyshares are present on one system** - This defeats the security model of multi-device threshold signatures
2. **The computer must be fully trusted** - Any malware, keyloggers, or compromised system can access both keyshares
3. **Memory exposure** - Both keyshares exist in memory simultaneously during the signing process
4. **Persistence risk** - Keyshare data may be written to disk (swap files, temp files, etc.)

### Required Actions After Recovery

**After using these recovery tools, you MUST:**

1. ✅ **Move ALL funds immediately** - Transfer your entire balance to a new, secure wallet
2. ✅ **Do NOT reuse the keyshares** - Consider the keyshares compromised after CLI recovery
3. ✅ **Create a new wallet** - Generate new keyshares using the mobile app for future use
4. ✅ **Secure the recovery machine** - Ensure the computer is clean, trusted, and free from malware
5. ✅ **Delete keyshare files** - Securely delete keyshare files from the recovery machine after use

### When to Use Recovery Tools

These tools should **ONLY** be used when:
- The mobile app is permanently unavailable
- You need emergency access to funds
- You are prepared to move all funds to a new wallet immediately
- You understand and accept the security risks

**If the mobile app is working, always use it instead of CLI recovery tools.**

---

## DKLs23 (libtss)

Wallets created with `tss_backend: "dkls23"` use **DKLs23 ECDSA** via [libtss](https://github.com/0xCarbon/libtss), not BNB GG18. Recovery uses `BBMTLib/scripts-dkls/`:

```bash
cd BBMTLib
export CGO_LDFLAGS="-L../../libtss/target/release -llibtss_ffi -ldl -lm"
./scripts-dkls/dkls-local-keygen.sh   # smoke / local 2-of-2
# Nostr 2-party: ./scripts-dkls/dkls-nostr-keygen.sh
```

See [scripts-dkls/TESTING.md](scripts-dkls/TESTING.md) and [docs/DKLS_MOBILE.md](docs/DKLS_MOBILE.md). **GG18 and DKLs23 keyshares are not interchangeable.**

---

## Available Tools

You have two options for spending Bitcoin from keyshares:

1. **`bold-spend` binary** (Recommended for cross-platform use)
   - Pre-compiled binary for Windows, Linux, and macOS
   - No shell script dependencies
   - Works on all platforms including Windows
   - Self-contained - spawns itself as separate processes

2. **`spend-bitcoin.sh` shell script** (Unix/Linux/macOS only)
   - Requires bash shell
   - Works on Linux and macOS
   - Uses Go binary (`bbmt`) internally

Both tools provide identical functionality. Choose based on your platform preference.

## Prerequisites

1. **Keyshare files**: You need both keyshare backup files from your mobile devices
   - **Mobile app naming convention**: Files are named like `KeyShare1.Dec19.2025.1257.share` or `peer1.Dec19.2025.1257.share`
     - Format: `<shareName>.<Month><Day>.<Year>.<Hours><Minutes>.share`
     - Example: `KeyShare1.Dec19.2025.1257.share` (KeyShare1, backed up on Dec 19, 2025 at 12:57)
     - Example: `peer1.Dec19.2025.1257.share` (peer1, backed up on Dec 19, 2025 at 12:57)
   - **Default CLI naming**: The CLI tools expect `peer1.ks` and `peer2.ks` by default
   - **Using mobile backups directly**: You can use the `.share` files directly with `--keyshare1` and `--keyshare2` flags
   - **Renaming (optional)**: You can rename mobile backup files to `peer1.ks` and `peer2.ks` if you prefer
2. **Passphrases** (if encrypted): If your keyshares are encrypted, you'll need:
   - `--passphrase1` for the first keyshare (KeyShare1 or peer1)
   - `--passphrase2` for the second keyshare (KeyShare2 or peer2)
   - Each keyshare can have its own passphrase
3. **Network information**: Know which network your funds are on (`mainnet` or `testnet3`)
4. **Derivation path**: The BIP32 path used for your wallet:
   - **Legacy (P2PKH)**: `m/44'/0'/0'/0/0` (mainnet) or `m/44'/1'/0'/0/0` (testnet)
   - **SegWit Native (P2WPKH)**: `m/84'/0'/0'/0/0` (mainnet) or `m/84'/1'/0'/0/0` (testnet)
   - **SegWit Compatible (P2SH-P2WPKH)**: `m/49'/0'/0'/0/0` (mainnet) or `m/49'/1'/0'/0/0` (testnet)
   - **Taproot (P2TR)**: `m/86'/0'/0'/0/0` (mainnet) or `m/86'/1'/0'/0/0` (testnet)

## Quick Start

### Option A: Using `bold-spend` Binary (Recommended)

#### Building the Binary

First, build the binary for your platform:

```bash
cd BBMTLib
./build-bold-spend.sh
```

This creates binaries in the `bin/` directory:
- `bold-spend-linux-amd64` - Linux 64-bit
- `bold-spend-linux-arm64` - Linux ARM64
- `bold-spend-darwin-amd64` - macOS Intel
- `bold-spend-darwin-arm64` - macOS Apple Silicon
- `bold-spend-windows-amd64.exe` - Windows 64-bit
- `bold-spend-windows-arm64.exe` - Windows ARM64

Or build for a specific platform:
```bash
# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o bin/bold-spend-darwin-arm64 ./tss/cmd/bold-spend

# Linux
GOOS=linux GOARCH=amd64 go build -o bin/bold-spend-linux-amd64 ./tss/cmd/bold-spend

# Windows
GOOS=windows GOARCH=amd64 go build -o bin/bold-spend-windows-amd64.exe ./tss/cmd/bold-spend
```

#### 1. Estimate Transaction Fee (Preview Mode)

Before sending, always preview the transaction to estimate fees:

**macOS/Linux:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient_address> \
  --amount-sats <amount_in_satoshis> \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --preview
```

**Windows:**
```cmd
bin\bold-spend-windows-amd64.exe ^
  --to-address <recipient_address> ^
  --amount-sats <amount_in_satoshis> ^
  --network testnet3 ^
  --mempool-url https://mempool.space/testnet/api ^
  --derivation-path "m/44'/0'/0'/0/0" ^
  --address-type p2pkh ^
  --preview
```

**Example:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address mq3WboPaYTvFygYByGL1xKNiqDwrcDYgxa \
  --amount-sats 200000 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --preview
```

**Output:**
```
Estimated fee (satoshis): 226
```

#### 2. Send Bitcoin Transaction

Once you have the fee estimate, send the transaction (remove `--preview` and use the estimated fee):

**macOS/Linux:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient_address> \
  --amount-sats <amount_in_satoshis> \
  --fee-sats <estimated_fee> \
  --network <mainnet|testnet3> \
  --mempool-url <mempool_api_url> \
  --derivation-path "<bip32_path>" \
  --address-type <p2pkh|p2wpkh|p2sh-p2wpkh|p2tr>
```

**Windows:**
```cmd
bin\bold-spend-windows-amd64.exe ^
  --to-address <recipient_address> ^
  --amount-sats <amount_in_satoshis> ^
  --fee-sats <estimated_fee> ^
  --network <mainnet|testnet3> ^
  --mempool-url <mempool_api_url> ^
  --derivation-path "<bip32_path>" ^
  --address-type <p2pkh|p2wpkh|p2sh-p2wpkh|p2tr>
```

**Example:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address mq3WboPaYTvFygYByGL1xKNiqDwrcDYgxa \
  --amount-sats 200000 \
  --fee-sats 226 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh
```

### Option B: Using `spend-bitcoin.sh` Shell Script (Unix/Linux/macOS)

#### 1. Estimate Transaction Fee (Preview Mode)

```bash
cd BBMTLib
./scripts/spend-bitcoin.sh \
  --to-address <recipient_address> \
  --amount-sats <amount_in_satoshis> \
  --fee-sats 1 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --preview
```

#### 2. Send Bitcoin Transaction

```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient_address> \
  --amount-sats <amount_in_satoshis> \
  --fee-sats <estimated_fee> \
  --network <mainnet|testnet3> \
  --mempool-url <mempool_api_url> \
  --derivation-path "<bip32_path>" \
  --address-type <p2pkh|p2wpkh|p2sh-p2wpkh|p2tr>
```

## Common Scenarios

### Scenario 1: Unencrypted Keyshares (Testnet)

If your keyshares are stored as plaintext/base64 files:

**Using `bold-spend` binary:**

**Legacy (P2PKH):**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/1'/0'/0/0" \
  --address-type p2pkh
```

**SegWit Native (P2WPKH):**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh
```

**SegWit Compatible (P2SH-P2WPKH):**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/49'/1'/0'/0/0" \
  --address-type p2sh-p2wpkh
```

**Using `spend-bitcoin.sh` script:**

**Legacy (P2PKH):**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/1'/0'/0/0" \
  --address-type p2pkh
```

**SegWit Native (P2WPKH):**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh
```

**SegWit Compatible (P2SH-P2WPKH):**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/49'/1'/0'/0/0" \
  --address-type p2sh-p2wpkh
```

### Scenario 2: Encrypted Keyshares (Same Passphrase)

If both keyshares use the same passphrase:

**Using `bold-spend` binary:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh \
  --passphrase1 "your-secret-passphrase" \
  --passphrase2 "your-secret-passphrase"
```

**Using `spend-bitcoin.sh` script:**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh \
  --passphrase1 "your-secret-passphrase" \
  --passphrase2 "your-secret-passphrase"
```

### Scenario 3: Encrypted Keyshares (Different Passphrases)

If each keyshare has its own passphrase:

**Using `bold-spend` binary:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/49'/1'/0'/0/0" \
  --address-type p2sh-p2wpkh \
  --passphrase1 "party1-secret" \
  --passphrase2 "party2-secret"
```

**Using `spend-bitcoin.sh` script:**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/49'/1'/0'/0/0" \
  --address-type p2sh-p2wpkh \
  --passphrase1 "party1-secret" \
  --passphrase2 "party2-secret"
```

### Scenario 4: Using Mobile App Backup Files Directly

If you have backup files from the mobile app (with `.share` extension):

**Using `bold-spend` binary:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh \
  --keyshare1 "/path/to/KeyShare1.Dec19.2025.1257.share" \
  --keyshare2 "/path/to/KeyShare2.Dec19.2025.1257.share" \
  --passphrase1 "secret1" \
  --passphrase2 "secret2"
```

**Using `spend-bitcoin.sh` script:**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh \
  --keyshare1 "/path/to/KeyShare1.Dec19.2025.1257.share" \
  --keyshare2 "/path/to/KeyShare2.Dec19.2025.1257.share" \
  --passphrase1 "secret1" \
  --passphrase2 "secret2"
```

**Note**: The mobile app creates files with names like:
- `KeyShare1.Dec19.2025.1257.share` (KeyShare1, backed up on Dec 19, 2025 at 12:57)
- `KeyShare2.Dec19.2025.1257.share` (KeyShare2, backed up on Dec 19, 2025 at 12:57)
- `peer1.Dec19.2025.1257.share` (peer1, backed up on Dec 19, 2025 at 12:57)

You can use these files directly with `--keyshare1` and `--keyshare2`, or rename them to `peer1.ks` and `peer2.ks` if you prefer.

### Scenario 5: Custom Keyshare Paths

If your keyshares are in different locations or have custom names:

**Using `bold-spend` binary:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh \
  --keyshare1 /path/to/backup1.ks \
  --keyshare2 /path/to/backup2.ks \
  --passphrase1 "secret1" \
  --passphrase2 "secret2"
```

**Using `spend-bitcoin.sh` script:**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 300 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" \
  --address-type p2wpkh \
  --keyshare1 /path/to/backup1.ks \
  --keyshare2 /path/to/backup2.ks \
  --passphrase1 "secret1" \
  --passphrase2 "secret2"
```

### Scenario 6: Mainnet Transaction

For mainnet, use mainnet parameters:

**Using `bold-spend` binary:**

**Legacy (P2PKH):**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 500 \
  --network mainnet \
  --mempool-url https://mempool.space/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --passphrase1 "mainnet-secret1" \
  --passphrase2 "mainnet-secret2"
```

**SegWit Native (P2WPKH) - Recommended for lower fees:**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 400 \
  --network mainnet \
  --mempool-url https://mempool.space/api \
  --derivation-path "m/84'/0'/0'/0/0" \
  --address-type p2wpkh \
  --passphrase1 "mainnet-secret1" \
  --passphrase2 "mainnet-secret2"
```

**SegWit Compatible (P2SH-P2WPKH):**
```bash
./bin/bold-spend-darwin-arm64 \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 450 \
  --network mainnet \
  --mempool-url https://mempool.space/api \
  --derivation-path "m/49'/0'/0'/0/0" \
  --address-type p2sh-p2wpkh \
  --passphrase1 "mainnet-secret1" \
  --passphrase2 "mainnet-secret2"
```

**Using `spend-bitcoin.sh` script:**

**Legacy (P2PKH):**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 500 \
  --network mainnet \
  --mempool-url https://mempool.space/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --passphrase1 "mainnet-secret1" \
  --passphrase2 "mainnet-secret2"
```

**SegWit Native (P2WPKH) - Recommended for lower fees:**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 400 \
  --network mainnet \
  --mempool-url https://mempool.space/api \
  --derivation-path "m/84'/0'/0'/0/0" \
  --address-type p2wpkh \
  --passphrase1 "mainnet-secret1" \
  --passphrase2 "mainnet-secret2"
```

**SegWit Compatible (P2SH-P2WPKH):**
```bash
./scripts/spend-bitcoin.sh \
  --to-address <recipient> \
  --amount-sats 100000 \
  --fee-sats 450 \
  --network mainnet \
  --mempool-url https://mempool.space/api \
  --derivation-path "m/49'/0'/0'/0/0" \
  --address-type p2sh-p2wpkh \
  --passphrase1 "mainnet-secret1" \
  --passphrase2 "mainnet-secret2"
```

## Address Types

Choose the correct `--address-type` based on your wallet's address format:

- **`p2pkh`** or **`legacy`**: Legacy addresses starting with `1` (mainnet) or `m/n` (testnet)
- **`p2wpkh`**, **`segwit`**, or **`bech32`**: Native SegWit addresses starting with `bc1` (mainnet) or `tb1` (testnet)
- **`p2sh-p2wpkh`** or **`p2sh`**: Nested SegWit addresses starting with `3` (mainnet) or `2` (testnet)
- **`p2tr`** or **`taproot`**: Taproot addresses starting with `bc1p` (mainnet) or `tb1p` (testnet)

## Derivation Paths

Common derivation paths based on address type and network:

### Legacy (P2PKH)
- **Mainnet**: `m/44'/0'/0'/0/0` (addresses start with `1`)
- **Testnet**: `m/44'/1'/0'/0/0` (addresses start with `m` or `n`)
- **Address Type Flag**: `--address-type p2pkh` or `--address-type legacy`

### SegWit Native (P2WPKH) - Recommended
- **Mainnet**: `m/84'/0'/0'/0/0` (addresses start with `bc1`)
- **Testnet**: `m/84'/1'/0'/0/0` (addresses start with `tb1`)
- **Address Type Flag**: `--address-type p2wpkh`, `--address-type segwit`, or `--address-type bech32`
- **Benefits**: Lower fees, better scalability, native SegWit support

### SegWit Compatible (P2SH-P2WPKH)
- **Mainnet**: `m/49'/0'/0'/0/0` (addresses start with `3`)
- **Testnet**: `m/49'/1'/0'/0/0` (addresses start with `2`)
- **Address Type Flag**: `--address-type p2sh-p2wpkh` or `--address-type p2sh`
- **Benefits**: SegWit benefits with legacy address format compatibility

### Taproot (P2TR)
- **Mainnet**: `m/86'/0'/0'/0/0` (addresses start with `bc1p`)
- **Testnet**: `m/86'/1'/0'/0/0` (addresses start with `tb1p`)
- **Address Type Flag**: `--address-type p2tr` or `--address-type taproot`
- **Benefits**: Most efficient, privacy improvements, advanced scripting

**Note**: The last two numbers (`/0/0`) represent the account and address index. Most wallets use `0/0` for the first address, but you may need to try different indices if your funds are in a different address.

## Mempool API URLs

- **Mainnet**: `https://mempool.space/api`
- **Testnet**: `https://mempool.space/testnet/api`
- **Alternative mainnet**: `https://benpool.space/api`

## Fee Estimation

The `--preview` mode uses the **30-minute fee policy** (HalfHourFee) to estimate transaction fees. This provides a conservative estimate. For faster confirmation, you may want to use a higher fee.

**Fee estimation process:**
1. Derives sender address from keyshare + derivation path
2. Fetches UTXOs from mempool API
3. Selects UTXOs needed for the transaction
4. Calculates transaction size (vbytes)
5. Estimates fee using current 30m fee rate

## Transaction Process

When you run the spend command (without `--preview`):

1. **Setup**: 
   - **`bold-spend`**: Self-contained binary, generates ephemeral transport keys
   - **`spend-bitcoin.sh`**: Builds Go binary (`bbmt`), generates ephemeral transport keys
2. **Keyshare Loading**: Loads and decrypts keyshares (if passphrases provided)
   - Keyshares are passed directly as file paths (no temporary files created)
3. **Relay Start**: Starts local relay server for MPC communication
4. **MPC Spend**: Both parties (peer1 and peer2) run in separate processes:
   - Each process has isolated memory (avoids race conditions)
   - Both parties participate in:
     - UTXO selection
     - Transaction construction
     - Multi-party signing (2-of-2)
     - Transaction broadcast
5. **Completion**: Returns transaction ID (txid) when successful

**Note**: The MPC signing process may take 1-2 minutes. Do not interrupt the process.

**Key Differences:**
- **`bold-spend`**: Spawns itself as separate processes, works on Windows/Linux/macOS
- **`spend-bitcoin.sh`**: Spawns `bbmt` binary processes, works on Unix/Linux/macOS only

## Troubleshooting

### Error: "insufficient funds: needed X, got 0"

- **Cause**: The derived address has no UTXOs or wrong derivation path
- **Solution**: 
  - Verify the derivation path matches your wallet
  - Check the address on a block explorer to confirm balance
  - Try different derivation paths if unsure

### Error: "Failed to read keyshare files"

- **Cause**: Keyshare files not found or empty
- **Solution**:
  - Verify keyshare files exist (default: `peer1.ks` and `peer2.ks` in current directory)
  - If using mobile app backups (`.share` files), use `--keyshare1` and `--keyshare2` to specify full paths
  - Example: `--keyshare1 "/path/to/KeyShare1.Dec19.2025.1257.share"`
  - Ensure files are readable
  - Check that file paths are correct (use absolute paths if needed)

### Error: "Error in aes-decrypt" or "Wrong Password"

- **Cause**: Incorrect passphrase or keyshare not encrypted
- **Solution**:
  - Verify passphrases are correct
  - If keyshares are unencrypted, don't use `--passphrase1`/`--passphrase2`
  - Check if keyshares use different encryption schemes

### Error: "Failed to derive sender address"

- **Cause**: Invalid address type or derivation path
- **Solution**:
  - Verify `--address-type` matches your wallet's address format
  - Check derivation path is correct for the address type
  - Ensure network matches (mainnet vs testnet)

### Transaction Stuck or Process Hanging

- **Cause**: Network issues, relay problems, or MPC protocol timeout
- **Solution**:
  - Check internet connection
  - Verify mempool API is accessible
  - Ensure both keyshares are valid and from the same keygen session
  - Try again with a fresh session

## Security Notes

⚠️ **CRITICAL: Both Keyshares Loaded on Same Machine**

**When using CLI recovery tools, both keyshares are loaded on the same computer. This is a significant security risk.**

### Mandatory Post-Recovery Actions

**After using recovery tools, you MUST:**

1. **🚨 Move ALL funds immediately** - Transfer your entire balance to a new, secure wallet address
2. **🚨 Do NOT reuse these keyshares** - Consider them compromised after CLI recovery
3. **🚨 Create a new wallet** - Generate fresh keyshares using the mobile app for future use
4. **🚨 Secure the recovery machine** - Ensure the computer is trusted, clean, and free from malware
5. **🚨 Delete keyshare files** - Securely delete keyshare files from the recovery machine after use

### Additional Security Considerations

1. **Passphrase Storage**: Never store passphrases in scripts or command history
2. **Keyshare Backup**: Keep encrypted backups of keyshares in secure locations
3. **Network**: Use testnet for testing; double-check network before mainnet transactions
4. **Amount Verification**: Always preview transactions first to verify amounts and fees
5. **Address Verification**: Double-check recipient addresses before sending
6. **Trusted Environment**: Only use recovery tools on a trusted, secure computer
7. **No Future Use**: Never use the same keyshares again after CLI recovery - create a new wallet

## Example: Complete Recovery Workflow

### Using `bold-spend` Binary with Mobile App Backups

```bash
# Step 1: Navigate to BBMTLib directory
cd BBMTLib

# Step 2: Build binary (if not already built)
./build-bold-spend.sh
# Or build for your specific platform:
# GOOS=darwin GOARCH=arm64 go build -o bin/bold-spend-darwin-arm64 ./tss/cmd/bold-spend

# Step 3: Copy your mobile app backup files to the current directory
# Mobile app creates files like: KeyShare1.Dec19.2025.1257.share
# You can use them directly or rename to peer1.ks and peer2.ks

# Step 4: Preview transaction (estimate fee)
# Option A: Using mobile backup files directly
./bin/bold-spend-darwin-arm64 \
  --to-address mq3WboPaYTvFygYByGL1xKNiqDwrcDYgxa \
  --amount-sats 200000 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --keyshare1 "KeyShare1.Dec19.2025.1257.share" \
  --keyshare2 "KeyShare2.Dec19.2025.1257.share" \
  --passphrase1 "my-secret-1" \
  --passphrase2 "my-secret-2" \
  --preview

# Option B: If you renamed files to peer1.ks and peer2.ks
# ./bin/bold-spend-darwin-arm64 \
#   --to-address mq3WboPaYTvFygYByGL1xKNiqDwrcDYgxa \
#   --amount-sats 200000 \
#   --network testnet3 \
#   --mempool-url https://mempool.space/testnet/api \
#   --derivation-path "m/44'/0'/0'/0/0" \
#   --address-type p2pkh \
#   --passphrase1 "my-secret-1" \
#   --passphrase2 "my-secret-2" \
#   --preview

# Step 5: Send transaction (using estimated fee)
./bin/bold-spend-darwin-arm64 \
  --to-address mq3WboPaYTvFygYByGL1xKNiqDwrcDYgxa \
  --amount-sats 200000 \
  --fee-sats 226 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --keyshare1 "KeyShare1.Dec19.2025.1257.share" \
  --keyshare2 "KeyShare2.Dec19.2025.1257.share" \
  --passphrase1 "my-secret-1" \
  --passphrase2 "my-secret-2"

# Step 6: Wait for transaction to complete (~1+ minutes)
# Step 7: Check transaction on block explorer using returned txid
```

### Using `spend-bitcoin.sh` Script with Mobile App Backups

```bash
# Step 1: Navigate to BBMTLib directory
cd BBMTLib

# Step 2: Copy your mobile app backup files to the current directory
# Mobile app creates files like: KeyShare1.Dec19.2025.1257.share
# You can use them directly or rename to peer1.ks and peer2.ks

# Step 3: Preview transaction (estimate fee)
# Option A: Using mobile backup files directly
./scripts/spend-bitcoin.sh \
  --to-address mq3WboPaYTvFygYByGL1xKNiqDwrcDYgxa \
  --amount-sats 200000 \
  --fee-sats 1 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --keyshare1 "KeyShare1.Dec19.2025.1257.share" \
  --keyshare2 "KeyShare2.Dec19.2025.1257.share" \
  --passphrase1 "my-secret-1" \
  --passphrase2 "my-secret-2" \
  --preview

# Option B: If you renamed files to peer1.ks and peer2.ks
# ./scripts/spend-bitcoin.sh \
#   --to-address mq3WboPaYTvFygYByGL1xKNiqDwrcDYgxa \
#   --amount-sats 200000 \
#   --fee-sats 1 \
#   --network testnet3 \
#   --mempool-url https://mempool.space/testnet/api \
#   --derivation-path "m/44'/0'/0'/0/0" \
#   --address-type p2pkh \
#   --passphrase1 "my-secret-1" \
#   --passphrase2 "my-secret-2" \
#   --preview

# Step 4: Send transaction (using estimated fee)
./scripts/spend-bitcoin.sh \
  --to-address mq3WboPaYTvFygYByGL1xKNiqDwrcDYgxa \
  --amount-sats 200000 \
  --fee-sats 226 \
  --network testnet3 \
  --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/44'/0'/0'/0/0" \
  --address-type p2pkh \
  --keyshare1 "KeyShare1.Dec19.2025.1257.share" \
  --keyshare2 "KeyShare2.Dec19.2025.1257.share" \
  --passphrase1 "my-secret-1" \
  --passphrase2 "my-secret-2"

# Step 5: Wait for transaction to complete (~1+ minutes)
# Step 6: Check transaction on block explorer using returned txid
```

## Getting Help

If you encounter issues:

1. Check that all required arguments are provided
2. Verify keyshare files are valid (from the same keygen session)
3. Ensure network and derivation path match your wallet setup
4. Review error messages carefully - they often indicate the specific issue
5. Test with `--preview` first to validate parameters

## Additional Resources

- **Mempool Explorer**: https://mempool.space (mainnet) or https://mempool.space/testnet (testnet)
- **BIP32 Derivation**: https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
- **Address Formats**: https://en.bitcoin.it/wiki/Address

## Platform-Specific Notes

### Windows Users

- Use `bold-spend-windows-amd64.exe` or `bold-spend-windows-arm64.exe`
- The shell script (`spend-bitcoin.sh`) does not work on Windows
- Use PowerShell or Command Prompt
- Example PowerShell command:
  ```powershell
  .\bin\bold-spend-windows-amd64.exe `
    --to-address <address> `
    --amount-sats 100000 `
    --fee-sats 300 `
    --network testnet3 `
    --mempool-url https://mempool.space/testnet/api `
    --derivation-path "m/44'/1'/0'/0/0" `
    --address-type p2pkh
  ```

### Linux Users

- Use `bold-spend-linux-amd64` or `bold-spend-linux-arm64`
- Both `bold-spend` binary and `spend-bitcoin.sh` script work
- Make sure the binary is executable: `chmod +x bin/bold-spend-linux-amd64`

### macOS Users

- Use `bold-spend-darwin-amd64` (Intel) or `bold-spend-darwin-arm64` (Apple Silicon)
- Both `bold-spend` binary and `spend-bitcoin.sh` script work
- Make sure the binary is executable: `chmod +x bin/bold-spend-darwin-arm64`

---

**Last Updated**: December 2025
