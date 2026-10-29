package dkls

import (
	"context"
	"encoding/hex"
	"fmt"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
)

// F39: post-DKG group-key cross-check (nostr transport). Thin wrapper
// over the shared nostrtransport core (also used by GG18 setup): reads
// our group key from the libtss handle and delegates.
func collectGroupKeyConsensus(
	ctx context.Context,
	cfg nostrtransport.Config,
	coordinator *nostrtransport.SessionCoordinator,
	pump *nostrtransport.MessagePump,
	share *libtss.KeyShareHandle,
	localNpub string,
	allParties []string,
) error {
	groupKey, err := share.GroupKey()
	if err != nil {
		return fmt.Errorf("F39 group-key read failed: %w", err)
	}
	ownGK := hex.EncodeToString(groupKey)
	return nostrtransport.CollectGroupKeyConsensus(ctx, cfg, coordinator, pump, ownGK, localNpub, allParties)
}

// checkGroupKeyUnanimity fails closed on any arrived hash that
// differs from ours (shared by the LAN path's inline compare and
// the nostr collector). Unknown senders in the map are ignored —
// only expected peers constrain consensus.
func checkGroupKeyUnanimity(want map[string]bool, arrived map[string]string, ownGK string) error {
	return nostrtransport.CheckGroupKeyUnanimity(want, arrived, ownGK)
}

// nostrGroupKeyCollectTimeout bounds the post-DKG wait. Tests
// shrink it via F39_GROUPKEY_SEC (same pattern as
// DKLS_TEST_AWAIT_SEC for the LAN barrier).
func nostrGroupKeyCollectTimeout() time.Duration {
	return nostrtransport.GroupKeyCollectTimeout()
}
