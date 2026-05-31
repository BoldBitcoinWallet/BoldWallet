package tss

import (
	"strings"
	"testing"
)

func panicWithRecoverAsError(where string) (result string, err error) {
	defer RecoverAsError(where, &err, &result)
	panic("synthetic test panic")
}

func TestRecoverAsError(t *testing.T) {
	result, err := panicWithRecoverAsError("TestRecoverAsError")
	if err == nil {
		t.Fatal("expected error from recovered panic")
	}
	if !strings.Contains(err.Error(), "internal error (panic)") {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "" {
		t.Fatalf("expected empty result, got %q", result)
	}
}

func TestPanicErrorFormat(t *testing.T) {
	err := PanicError("boom")
	if err == nil || !strings.Contains(err.Error(), "internal error (panic): boom") {
		t.Fatalf("unexpected: %v", err)
	}
}
