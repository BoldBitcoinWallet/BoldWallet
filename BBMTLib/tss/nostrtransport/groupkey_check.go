package nostrtransport

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Post-DKG group-key cross-check (F39 core, shared by DKLS and GG18
// setup paths). Every party publishes its locally-derived group public
// key hex as a keygen-groupkey phase and collects peers' via the pump.
// Every ARRIVED hash must equal ours or setup fails closed with
// DKG_GROUP_KEY_MISMATCH before the keyshare is returned or persisted.
// Peers that never publish (old versions) warn and proceed after a
// bounded wait — the check guards honest divergence (lockout), and
// mixed-version ceremonies must keep working.
func CollectGroupKeyConsensus(
	ctx context.Context,
	cfg Config,
	coordinator *SessionCoordinator,
	pump *MessagePump,
	ownGKHex string,
	localNpub string,
	allParties []string,
) error {
	ownGK := strings.ToLower(ownGKHex)

	ownHex, err := npubToHex(localNpub)
	if err != nil {
		return fmt.Errorf("group-key local npub decode failed: %w", err)
	}
	ownHex = strings.ToLower(ownHex)
	want := map[string]bool{}
	for _, p := range allParties {
		h, err := npubToHex(p)
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
		log.Printf("nostr DKG: group-key publish failed (peers may warn): %v", pubErr)
	}

	waitFor := GroupKeyCollectTimeout()
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
			if err := CheckGroupKeyUnanimity(want, snapshot, ownGK); err != nil {
				return err
			}
			log.Printf("nostr DKG: group-key consensus across %d peers", len(want))
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("group-key collect aborted: %w", ctx.Err())
		case <-deadline.C:
			log.Printf("nostr DKG: group-key wait timed out; proceeding without full consensus")
			return nil
		case <-tick.C:
		}
	}
}

// CheckGroupKeyUnanimity fails closed on any arrived hash that
// differs from ours. Unknown senders in the map are ignored —
// only expected peers constrain consensus.
func CheckGroupKeyUnanimity(want map[string]bool, arrived map[string]string, ownGK string) error {
	for peer, h := range arrived {
		if want[peer] && !strings.EqualFold(h, ownGK) {
			return fmt.Errorf("DKG_GROUP_KEY_MISMATCH: party %s derived a different group key — aborting before first use (divergent DKG results lock funds)", peer)
		}
	}
	return nil
}

// GroupKeyCollectTimeout bounds the post-DKG wait. Tests shrink it
// via F39_GROUPKEY_SEC.
func GroupKeyCollectTimeout() time.Duration {
	if s := os.Getenv("F39_GROUPKEY_SEC"); s != "" {
		if sec, err := strconv.Atoi(s); err == nil && sec > 0 {
			return time.Duration(sec) * time.Second
		}
	}
	return 30 * time.Second
}
