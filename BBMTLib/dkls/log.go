package dkls

import (
	"fmt"
	"os"
	"runtime/debug"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// dklsDebugLogs is true unless DKLS_DEBUG=0 or false (verbose profiling on by default).
func dklsDebugLogs() bool {
	v := os.Getenv("DKLS_DEBUG")
	if v == "0" || v == "false" {
		return false
	}
	return true
}

// dklsLogf logs verbose DKLs profiling (round waits, heartbeats). Gated by DKLS_DEBUG.
// Prefix matches other MPC logs so device exports grep BBMTLog / dbg('TSS:', …).
func dklsLogf(format string, args ...any) {
	if !dklsDebugLogs() {
		return
	}
	tss.Logf("BBMTLog: dkls "+format, args...)
}

// dklsLogErrorf logs failures (timeouts, decrypt, recv errors). Never gated by DKLS_DEBUG.
func dklsLogErrorf(format string, args ...any) {
	tss.Logf("BBMTLog: dkls "+format, args...)
}

// dklsLogPanic logs panic + stack via tss.Logf (same pattern as BBMTLib/tss). Never gated.
func dklsLogPanic(where string, r any) {
	errMsg := fmt.Sprintf("PANIC in %s: %v", where, r)
	tss.Logf("BBMTLog: dkls %s", errMsg)
	tss.Logf("BBMTLog: dkls Stack trace: %s", string(debug.Stack()))
}

// recoverAsError converts a recovered panic into err (mirrors BBMTLib/tss defer recover pattern).
func recoverAsError(where string, err *error, result *string) {
	if r := recover(); r != nil {
		dklsLogPanic(where, r)
		*err = tss.PanicError(r)
		if result != nil {
			*result = ""
		}
	}
}

// recoverAsErrorClear sets err on panic and runs clear for non-string result types.
func recoverAsErrorClear(where string, err *error, clear func()) {
	if r := recover(); r != nil {
		dklsLogPanic(where, r)
		*err = tss.PanicError(r)
		if clear != nil {
			clear()
		}
	}
}

// recoverGoroutine logs a panic in a dkls goroutine without converting to error.
func recoverGoroutine(where string) {
	if r := recover(); r != nil {
		dklsLogPanic(where, r)
	}
}
