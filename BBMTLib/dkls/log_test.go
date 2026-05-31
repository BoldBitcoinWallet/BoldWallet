package dkls

import "testing"

func TestDklsDebugLogsDefaultOn(t *testing.T) {
	t.Setenv("DKLS_DEBUG", "")
	if !dklsDebugLogs() {
		t.Fatal("expected dkls debug logs on by default")
	}
}

func TestDklsDebugLogsExplicitOff(t *testing.T) {
	t.Setenv("DKLS_DEBUG", "0")
	if dklsDebugLogs() {
		t.Fatal("expected dkls debug logs off when DKLS_DEBUG=0")
	}
}

func TestDklsDebugLogsExplicitOn(t *testing.T) {
	t.Setenv("DKLS_DEBUG", "1")
	if !dklsDebugLogs() {
		t.Fatal("expected dkls debug logs on when DKLS_DEBUG=1")
	}
}

func TestDklsLogErrorfIgnoresDebugGate(t *testing.T) {
	t.Setenv("DKLS_DEBUG", "0")
	if dklsDebugLogs() {
		t.Fatal("test precondition: debug logs should be off")
	}
	// Must not panic; always routes to tss.Logf regardless of DKLS_DEBUG.
	dklsLogErrorf("test error path: %s", "ok")
}

func TestDklsLogPanicDoesNotPanic(t *testing.T) {
	t.Setenv("DKLS_DEBUG", "0")
	// Must not panic; always routes to tss.Logf regardless of DKLS_DEBUG.
	dklsLogPanic("TestDklsLogPanic", "synthetic")
}
