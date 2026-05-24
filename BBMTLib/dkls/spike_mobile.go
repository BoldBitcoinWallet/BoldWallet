//go:build ios || android

package dkls

import (
	"fmt"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// HelloDkg verifies libtss linkage on device. Do not run in-process DKG here:
// the app also embeds gomobile Tss (second Go runtime); a full DKG smoke test can
// corrupt the heap on iOS ("bad sweepgen"). Real DKG runs via LAN/Nostr keygen.
func HelloDkg() (result string, err error) {
	defer recoverAsError("HelloDkg", &err, &result)
	ver := libtss.Version()
	if ver == "" {
		return "", fmt.Errorf("libtss version unavailable")
	}
	return fmt.Sprintf("dkls23 ok libtss=%s", ver), nil
}
