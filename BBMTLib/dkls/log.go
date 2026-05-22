package dkls

import (
	"os"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

// dklsDebugLogs is true when DKLS_DEBUG=1 (default on for device profiling unless explicitly "0").
func dklsDebugLogs() bool {
	v := os.Getenv("DKLS_DEBUG")
	if v == "0" || v == "false" {
		return false
	}
	return true
}

// dklsLogf sends profiling lines to React Native (GoLog) and logcat via tss.Logf.
// Prefix matches other MPC logs so device exports grep BBMTLog / dbg('TSS:', …).
func dklsLogf(format string, args ...any) {
	if !dklsDebugLogs() {
		return
	}
	tss.Logf("BBMTLog: dkls "+format, args...)
}
