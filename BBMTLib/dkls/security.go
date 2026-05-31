package dkls

import (
	"errors"
	"fmt"
	"strings"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

var ErrNonceReuseDetected = errors.New("dkls nonce reuse detected")

func initLibtss() error {
	if err := libtss.Init(libtss.OptMlock); err != nil {
		lower := strings.ToLower(err.Error())
		// Fallback for environments without mlock capability.
		if strings.Contains(lower, "mlock") ||
			strings.Contains(lower, "ipc_lock") ||
			strings.Contains(lower, "operation not permitted") {
			dklsLogf("libtss init with mlock unavailable; falling back to default init")
			return libtss.Init()
		}
		return err
	}
	return nil
}

func wrapNonceReuseError(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "nonce reuse") ||
		strings.Contains(msg, "noncereuse") {
		return fmt.Errorf("%w: %v", ErrNonceReuseDetected, err)
	}
	return err
}
