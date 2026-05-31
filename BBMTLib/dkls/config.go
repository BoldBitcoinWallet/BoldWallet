package dkls

import (
	"fmt"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// DefaultThreshold is BoldWallet's 2-of-2 DKLs23 configuration (duo).
var DefaultThreshold = ThresholdDuo()

const (
	BackendName = "dkls23"
	SuiteID     = 6
)

// ThresholdDuo returns 2-of-2 DKLs23 settings.
func ThresholdDuo() libtss.ThresholdConfig {
	return libtss.ThresholdConfig{
		MinSigners: 2,
		MaxSigners: 2,
		Suite:      libtss.CiphersuiteSecp256k1ECDSA,
	}
}

// ThresholdTrio returns 2-of-3 DKLs23 settings.
func ThresholdTrio() libtss.ThresholdConfig {
	return libtss.ThresholdConfig{
		MinSigners: 2,
		MaxSigners: 3,
		Suite:      libtss.CiphersuiteSecp256k1ECDSA,
	}
}

// ThresholdFromPartyCount maps duo/trio party count to libtss threshold.
func ThresholdFromPartyCount(n int) (libtss.ThresholdConfig, error) {
	switch n {
	case 2:
		return ThresholdDuo(), nil
	case 3:
		return ThresholdTrio(), nil
	default:
		return libtss.ThresholdConfig{}, fmt.Errorf("dkls: unsupported party count %d (want 2 or 3)", n)
	}
}

// PartyIdentifiers returns router party IDs 1..n.
func PartyIdentifiers(n int) []libtss.Identifier {
	ids := make([]libtss.Identifier, n)
	for i := 0; i < n; i++ {
		ids[i] = libtss.Identifier(i + 1)
	}
	return ids
}
