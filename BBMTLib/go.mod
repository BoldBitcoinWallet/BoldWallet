module github.com/BoldBitcoinWallet/BBMTLib

go 1.23.3

require (
	github.com/bnb-chain/tss-lib/v2 v2.0.2
	github.com/btcsuite/btcd v0.24.0
	github.com/btcsuite/btcd/btcec/v2 v2.3.4
	github.com/btcsuite/btcd/btcutil v1.1.5
	github.com/decred/dcrd/dcrec/edwards/v2 v2.0.3
	github.com/gorilla/mux v1.8.1
	github.com/ipfs/go-log/v2 v2.1.3
	github.com/patrickmn/go-cache v2.1.0+incompatible
)

require (
	github.com/btcsuite/btclog v0.0.0-20170628155309-84c8d2346e9f // indirect
	github.com/decred/dcrd/crypto/blake256 v1.0.1 // indirect
	github.com/fomichev/secp256k1 v0.0.0-20180413221153-00116ff8c62f // indirect
	github.com/stretchr/testify v1.10.0 // indirect
	golang.org/x/mobile v0.0.0-20250408133729-978277e7eaf7 // indirect
	golang.org/x/mod v0.24.0 // indirect
	golang.org/x/sync v0.13.0 // indirect
	golang.org/x/tools v0.32.0 // indirect
)

require (
	github.com/agl/ed25519 v0.0.0-20200225211852-fd4d107ace12 // indirect
	github.com/btcsuite/btcd/chaincfg/chainhash v1.1.0
	github.com/btcsuite/btcutil v1.0.3-0.20201208143702-a53e38424cce // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.3.0
	github.com/ecies/go/v2 v2.0.3
	github.com/gogo/protobuf v1.3.3 // indirect
	github.com/google/go-cmp v0.6.0 // indirect
	github.com/hashicorp/errwrap v1.1.0 // indirect
	github.com/hashicorp/go-multierror v1.1.1 // indirect
	github.com/ipfs/go-log v1.0.5 // indirect
	github.com/opentracing/opentracing-go v1.2.0 // indirect
	github.com/otiai10/primes v0.0.0-20210501021515-f1b2be525a11 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	go.uber.org/atomic v1.10.0 // indirect
	go.uber.org/multierr v1.10.0 // indirect
	go.uber.org/zap v1.24.0 // indirect
	golang.org/x/crypto v0.31.0 // indirect
	golang.org/x/sys v0.32.0 // indirect
	google.golang.org/protobuf v1.32.0 // indirect
)

replace (
	github.com/agl/ed25519 => github.com/binance-chain/edwards25519 v0.0.0-20200305024217-f36fc4b53d43
	github.com/bnb-chain/tss-lib/v2 => github.com/bnb-chain/tss-lib/v2 v2.0.2
	github.com/gogo/protobuf => github.com/regen-network/protobuf v1.3.2-alpha.regen.4
)
