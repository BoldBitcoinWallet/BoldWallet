package tss

import (
	"context"
	"errors"
	"fmt"
)

// NostrMpcContextErr maps context cancellation/deadline errors to user-facing messages.
func NostrMpcContextErr(phase string, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return fmt.Errorf("nostr mpc aborted during %s: %w", phase, err)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%s timed out: %w", phase, err)
	}
	return fmt.Errorf("%s failed: %w", phase, err)
}
