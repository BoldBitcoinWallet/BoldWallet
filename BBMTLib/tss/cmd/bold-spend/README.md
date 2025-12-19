# bold-spend

Cross-platform binary for spending Bitcoin from MPC keyshares. This is a compiled alternative to `spend-bitcoin.sh` that works on Windows, Linux, and macOS.

## Building

To build for all platforms:

```bash
cd BBMTLib
./build-bold-spend.sh
```

This will create binaries in the `bin/` directory:
- `bold-spend-linux-amd64` - Linux 64-bit
- `bold-spend-linux-arm64` - Linux ARM64
- `bold-spend-darwin-amd64` - macOS Intel
- `bold-spend-darwin-arm64` - macOS Apple Silicon
- `bold-spend-windows-amd64.exe` - Windows 64-bit
- `bold-spend-windows-arm64.exe` - Windows ARM64

To build for a specific platform:

```bash
# Linux
GOOS=linux GOARCH=amd64 go build -o bold-spend-linux ./tss/cmd/bold-spend

# macOS
GOOS=darwin GOARCH=arm64 go build -o bold-spend-mac ./tss/cmd/bold-spend

# Windows
GOOS=windows GOARCH=amd64 go build -o bold-spend.exe ./tss/cmd/bold-spend
```

## Usage

The binary has the same interface as `spend-bitcoin.sh`:

```bash
# Preview fee estimate
./bold-spend --to-address tb1q... --amount-sats 10000 \
  --network testnet3 --mempool-url https://mempool.space/testnet/api --preview

# Send transaction
./bold-spend --to-address tb1q... --amount-sats 10000 --fee-sats 226 \
  --network testnet3 --mempool-url https://mempool.space/testnet/api \
  --derivation-path "m/84'/1'/0'/0/0" --address-type p2wpkh

# With encrypted keyshares
./bold-spend --to-address tb1q... --amount-sats 10000 --fee-sats 226 \
  --network testnet3 --mempool-url https://mempool.space/testnet/api \
  --passphrase1 "secret1" --passphrase2 "secret2"
```

## Features

- ✅ Cross-platform (Windows, Linux, macOS)
- ✅ Preview mode for fee estimation
- ✅ Support for encrypted keyshares (separate passphrases per keyshare)
- ✅ All address types (P2PKH, P2WPKH, P2SH-P2WPKH, P2TR)
- ✅ Mainnet and testnet support
- ✅ Custom derivation paths
- ✅ Same functionality as `spend-bitcoin.sh`

## Differences from spend-bitcoin.sh

- Single binary - no shell script dependencies
- Works on Windows natively
- Slightly faster startup (no script parsing)
- Same command-line interface
