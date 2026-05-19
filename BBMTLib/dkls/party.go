package dkls

import (
	"fmt"
	"strings"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// partyKeyForID returns the LAN relay moniker (KeyShareN) used by the mobile app.
func partyKeyForID(id libtss.Identifier) string {
	return fmt.Sprintf("KeyShare%d", id)
}

// partyIDFromKey maps LAN relay keys or script partyN names to libtss identifiers.
func partyIDFromKey(key string) libtss.Identifier {
	key = strings.TrimSpace(key)
	if strings.HasPrefix(key, "KeyShare") {
		var n int
		if _, err := fmt.Sscanf(key, "KeyShare%d", &n); err == nil && n > 0 {
			return libtss.Identifier(n)
		}
	}
	if strings.HasPrefix(key, "party") {
		var n int
		if _, err := fmt.Sscanf(key, "party%d", &n); err == nil && n > 0 {
			return libtss.Identifier(n)
		}
	}
	return 1
}

// partyIDsFromKeys returns identifiers for each party moniker in order.
func partyIDsFromKeys(parties []string) []libtss.Identifier {
	ids := make([]libtss.Identifier, len(parties))
	for i, p := range parties {
		ids[i] = partyIDFromKey(p)
	}
	return ids
}
