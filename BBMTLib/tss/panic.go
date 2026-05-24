package tss

import (
	"fmt"
	"runtime/debug"
)

// LogPanic logs panic + stack via Logf (never gated). Used by defer recover guards.
func LogPanic(where string, r any) {
	errMsg := fmt.Sprintf("PANIC in %s: %v", where, r)
	Logf("BBMTLog: %s", errMsg)
	Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
}

// PanicError is the standard error returned after recovering a panic.
func PanicError(r any) error {
	return fmt.Errorf("internal error (panic): %v", r)
}

// RecoverAsError converts a recovered panic into err (and clears result when non-nil).
// Must be deferred directly: defer RecoverAsError("Fn", &err, &result).
func RecoverAsError(where string, err *error, result *string) {
	if r := recover(); r != nil {
		LogPanic(where, r)
		*err = PanicError(r)
		if result != nil {
			*result = ""
		}
	}
}

// RecoverAsErrorClear sets err on panic and runs clear (e.g. result = nil, result = false).
func RecoverAsErrorClear(where string, err *error, clear func()) {
	if r := recover(); r != nil {
		LogPanic(where, r)
		*err = PanicError(r)
		if clear != nil {
			clear()
		}
	}
}

// RecoverAsErrorf sets err using msgFmt on panic (for domain-specific panic messages).
func RecoverAsErrorf(where string, err *error, msgFmt string, clear func()) {
	if r := recover(); r != nil {
		LogPanic(where, r)
		*err = fmt.Errorf(msgFmt, r)
		if clear != nil {
			clear()
		}
	}
}

// RecoverGoroutine logs a panic in a goroutine without converting to error.
func RecoverGoroutine(where string) {
	if r := recover(); r != nil {
		LogPanic(where, r)
	}
}
