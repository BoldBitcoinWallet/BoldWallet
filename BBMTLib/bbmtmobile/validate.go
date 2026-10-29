package main

import "C"
import "fmt"

// F11 bridge input validation at the Go //export seam — the single choke
// point both platforms funnel through. Platform seams (JNI/ObjC) enforce
// memory safety (null); this seam enforces shape (nil/length/bounds) and
// converts every panic into a typed "error:..." return instead of aborting
// the process.

const (
	// maxBridgeString caps any single C string bridge argument (8 MiB).
	// The largest legitimate payloads (PSBT, keyshare JSON, QR chunks)
	// are ~100KB; anything larger is attack or bug.
	maxBridgeString = 8 << 20
	// maxSecureRandom caps SecureRandom output (4 KiB hex chars). The
	// largest in-repo caller needs 64.
	maxSecureRandom = 4 << 10
	// maxBridgeSats bounds bridge amount args (21M BTC in sats).
	maxBridgeSats = 2100000000000000
	// maxPreParamsTimeout bounds BbmtLocalPreParams (24h in minutes).
	maxPreParamsTimeout = 24 * 60
)

// f11Error marks bridge input-validation failures. Raised via panic from
// mustGoStr / mustInt so call sites stay one-liners; recoverBridge turns
// it into a typed "error:f11: ..." return.
type f11Error struct{ msg string }

func (e *f11Error) Error() string { return "f11: " + e.msg }

// mustGoStr converts a C bridge string. Nil and over-cap are always
// rejected; empty is allowed — domain code owns requiredness, and several
// methods take legitimate empty strings (unset optionals).
func mustGoStr(p *C.char, what string) string {
	if p == nil {
		panic(&f11Error{msg: "null " + what})
	}
	s := C.GoString(p)
	if len(s) > maxBridgeString {
		panic(&f11Error{msg: fmt.Sprintf("%s exceeds %d bytes", what, maxBridgeString)})
	}
	return s
}

// mustNonNegative bounds a C integer bridge argument to [0, max].
func mustNonNegative(v int64, max int64, what string) int64 {
	if v < 0 || v > max {
		panic(&f11Error{msg: fmt.Sprintf("%s out of range [0,%d]: %d", what, max, v)})
	}
	return v
}

// recoverBridge converts panics (validation + unexpected) into typed
// "error:..." C string returns. Every *C.char-returning export defers it.
func recoverBridge(out **C.char) {
	if r := recover(); r != nil {
		var msg string
		switch e := r.(type) {
		case *f11Error:
			msg = e.Error()
		case error:
			msg = "internal: " + e.Error()
		default:
			msg = fmt.Sprintf("internal: %v", r)
		}
		*out = trackCString("error:" + msg)
	}
}
