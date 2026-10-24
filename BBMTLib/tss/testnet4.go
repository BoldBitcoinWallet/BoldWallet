package tss

// Testnet4 network parameters for BBMTLib.
//
// Local btcd is v0.24.2, which predates upstream TestNet4Params
// (introduced in btcd v0.25.0). Rather than dragging a btcd/btcec/
// btcutil upgrade (plus tss-lib and gomobile rebuild risk) for
// fields this codebase never reads, testnet4 params are derived
// here from TestNet3Params with the true testnet4 identity
// overlaid.
//
// This is behaviorally exact for every read path in this repo:
//   - Address-layer fields are byte-identical between testnet3 and
//     testnet4 upstream (verified against btcd v0.25.0
//     chaincfg/params.go): Bech32HRPSegwit "tb", PubKeyHashAddrID
//     0x6f, ScriptHashAddrID 0xc4, PrivateKeyID 0xef, tprv/tpub
//     HD magics, HDCoinType 1. A unit test pins this.
//   - The differing upstream fields (Net magic 0x283f161c, port
//     48333, DNS seeds, genesis, checkpoints, deployments,
//     EnforceBIP94) belong to Bitcoin P2P / chain validation.
//     This codebase does no P2P (no Dial, no port/magic/DNS use;
//     transport is mempool HTTP + LAN/nostr relay) and never reads
//     those fields. Name/Net/DefaultPort below carry the TRUE
//     testnet4 values; consensus leftovers are inherited
//     placeholders.
//
// WARNING: if Bitcoin P2P is ever added, replace this with a real
// btcd upgrade (>= v0.25.0) instead of extending the shim.

import (
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/wire"
)

// wireTestNet4 is wire.TestNet4 from btcd >= v0.25.0, spelled as a
// literal because v0.24.2's wire package lacks the constant.
const wireTestNet4 = wire.BitcoinNet(0x283f161c)

// TestNet4Params is the chaincfg parameter set used for all
// testnet4 address/tx/PSBT work. See the package note above.
var TestNet4Params = func() chaincfg.Params {
	p := chaincfg.TestNet3Params
	p.Name = "testnet4"
	p.Net = wireTestNet4
	p.DefaultPort = "48333"
	return p
}()

// normalizeNetwork maps legacy testnet key spellings to the
// canonical "testnet4". Callers pass the result to network switches
// so persisted 'testnet3' prefs and bare 'testnet' aliases keep
// working after the migration.
func normalizeNetwork(network string) string {
	switch network {
	case "testnet", "testnet3":
		return "testnet4"
	default:
		return network
	}
}
