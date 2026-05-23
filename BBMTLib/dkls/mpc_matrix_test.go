package dkls

import "testing"

// TestMpcMatrix runs end-to-end DKLS MPC paths used on mobile (LAN HTTP relay + Nostr).
//
// Scenarios:
//   - LAN keygen duo (2-of-2)
//   - LAN keygen trio (2-of-3)
//   - Nostr keygen duo / trio (requires ws://127.0.0.1:7777 — start BBMTLib/scripts/start-local-relay.sh)
//   - LAN keysign duo (2-of-2) and trio subset (2-of-3 spend)
//   - Nostr keysign duo and trio subset
//
// Run:
//
//	export CGO_ENABLED=1
//	export CGO_LDFLAGS="-L../../libtss/target/release -llibtss_ffi -lm -framework Security -framework CoreFoundation"
//	go test ./dkls/ -count=1 -timeout 25m -run '^TestMpcMatrix$' -v
//
// Or: ./scripts-dkls/dkls-mpc-matrix-test.sh
func TestMpcMatrix(t *testing.T) {
	t.Run("LanKeygenDuo", testMpcLanKeygenDuo)
	t.Run("LanKeygenTrio", testMpcLanKeygenTrio)
	t.Run("NostrKeygenDuo", testMpcNostrKeygenDuo)
	t.Run("NostrKeygenTrio", testMpcNostrKeygenTrio)
	t.Run("LanKeysignDuo_2of2", testMpcLanKeysignDuo)
	t.Run("LanKeysignTrioSubset_2of3", testMpcLanKeysignTrioSubset)
	t.Run("NostrKeysignDuo_2of2", testMpcNostrKeysignDuo)
	t.Run("NostrKeysignTrioSubset_2of3", testMpcNostrKeysignTrioSubset)
}
