package dkls

import (
	"errors"
	"fmt"
	"strings"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
	"golang.org/x/sys/unix"
)

var ErrNonceReuseDetected = errors.New("dkls nonce reuse detected")

// raiseMemlockLimit lifts the soft memlock cap up to the hard cap, at most
// 8 MiB. Phones often start at 64KB. mlockall of the whole app then fails
// the share export with "could not acquire lock … cannot allocate memory".
func raiseMemlockLimit() {
	var lim unix.Rlimit
	if err := unix.Getrlimit(unix.RLIMIT_MEMLOCK, &lim); err != nil {
		return
	}
	const want uint64 = 8 * 1024 * 1024
	target := lim.Max
	if lim.Max > want {
		target = want
	}
	if lim.Cur >= target && target != 0 {
		return
	}
	lim.Cur = target
	if err := unix.Setrlimit(unix.RLIMIT_MEMLOCK, &lim); err != nil {
		dklsLogf("memlock limit unchanged: %v", err)
	}
}

func initLibtss() error {
	raiseMemlockLimit()
	// Do not mlockall. Locking every page of the React Native process
	// spends the phone's memlock budget during 3-party DKG, and the
	// device that hits the cap panics while saving its share. The share
	// itself is locked by SecureBytes.
	return libtss.Init()
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
