package dkls

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
)

// F39: post-DKG group-key cross-check (nostr transport). Publishes
// this party's group public key hex as a keygen-groupkey phase and
// collects peers' via the pump. Every ARRIVED hash must equal ours
// or setup fails closed with DKG_GROUP_KEY_MISMATCH before the
// keyshare is returned or persisted. Peers that never publish
// (old versions) warn and proceed after a bounded wait — the check
// guards honest divergence (lockout), and mixed-version ceremonies
// must keep working (same downgrade rule as the LAN path).
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
	ownGK := strings.ToLower(hex.EncodeToString(groupKey))

	ownHex, err := npubToHexKey(localNpub)
	if err != nil {
		return fmt.Errorf("F39 local npub decode failed: %w", err)
	}
	ownHex = strings.ToLower(ownHex)
	want := map[string]bool{}
	for _, p := range allParties {
		h, err := npubToHexKey(p)
		if err != nil {
			continue
		}
		if strings.ToLower(h) != ownHex {
			want[strings.ToLower(h)] = true
		}
	}
	if len(want) == 0 {
		return nil
	}

	var mu sync.Mutex
	arrived := map[string]string{}
	pump.SetOnGroupKey(func(senderHex, h string) {
		mu.Lock()
		arrived[strings.ToLower(senderHex)] = strings.ToLower(strings.TrimSpace(h))
		mu.Unlock()
	})

	if pubErr := coordinator.PublishGroupKey(ctx, ownGK); pubErr != nil {
		dklsLogf("nostr DKG: group-key publish failed (peers may warn): %v", pubErr)
	}

	waitFor := nostrGroupKeyCollectTimeout()
	deadline := time.NewTimer(waitFor)
	defer deadline.Stop()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		mu.Lock()
		complete := true
		for peer := range want {
			if _, ok := arrived[peer]; !ok {
				complete = false
				break
			}
		}
		snapshot := make(map[string]string, len(arrived))
		for k, v := range arrived {
			snapshot[k] = v
		}
		mu.Unlock()

		if complete {
			if err := checkGroupKeyUnanimity(want, snapshot, ownGK); err != nil {
				return err
			}
			dklsLogf("nostr DKG: group-key consensus across %d peers", len(want))
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("F39 group-key collect aborted: %w", ctx.Err())
		case <-deadline.C:
			dklsLogf("nostr DKG: group-key wait timed out; proceeding without full consensus")
			return nil
		case <-tick.C:
		}
	}
}

// checkGroupKeyUnanimity fails closed on any arrived hash that
// differs from ours (shared by the LAN path's inline compare and
// the nostr collector). Unknown senders in the map are ignored —
// only expected peers constrain consensus.
func checkGroupKeyUnanimity(want map[string]bool, arrived map[string]string, ownGK string) error {
	for peer, h := range arrived {
		if want[peer] && !strings.EqualFold(h, ownGK) {
			return fmt.Errorf("DKG_GROUP_KEY_MISMATCH: party %s derived a different group key — aborting before first use (divergent DKG results lock funds)", peer)
		}
	}
	return nil
}

// nostrGroupKeyCollectTimeout bounds the post-DKG wait. Tests
// shrink it via F39_GROUPKEY_SEC (same pattern as
// DKLS_TEST_AWAIT_SEC for the LAN barrier).
func nostrGroupKeyCollectTimeout() time.Duration {
	if s := os.Getenv("F39_GROUPKEY_SEC"); s != "" {
		if sec, err := strconv.Atoi(s); err == nil && sec > 0 {
			return time.Duration(sec) * time.Second
		}
	}
	return 30 * time.Second
}
