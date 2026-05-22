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
