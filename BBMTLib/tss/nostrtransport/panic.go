package nostrtransport

import (
	"fmt"
	"os"
	"runtime/debug"
)

func logPanic(where string, r any) {
	errMsg := fmt.Sprintf("PANIC in %s: %v", where, r)
	fmt.Fprintf(os.Stderr, "BBMTLog: %s\n", errMsg)
	fmt.Fprintf(os.Stderr, "BBMTLog: Stack trace: %s\n", string(debug.Stack()))
}

func panicError(r any) error {
	return fmt.Errorf("internal error (panic): %v", r)
}

func recoverAsError(where string, err *error, result *string) {
	if r := recover(); r != nil {
		logPanic(where, r)
		*err = panicError(r)
		if result != nil {
			*result = ""
		}
	}
}

func recoverAsErrorClear(where string, err *error, clear func()) {
	if r := recover(); r != nil {
		logPanic(where, r)
		*err = panicError(r)
		if clear != nil {
			clear()
		}
	}
}

