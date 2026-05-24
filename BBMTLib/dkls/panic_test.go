package dkls

import (
	"strings"
	"testing"
)

func panicWithRecoverAsError(where string) (result string, err error) {
	defer recoverAsError(where, &err, &result)
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
	if !strings.Contains(err.Error(), "synthetic test panic") {
		t.Fatalf("expected panic value in error, got: %v", err)
	}
	if result != "" {
		t.Fatalf("expected empty result, got %q", result)
	}
}

func TestRecoverAsErrorNilResult(t *testing.T) {
	var err error
	func() {
		defer recoverAsError("TestRecoverAsErrorNilResult", &err, nil)
		panic("nil result pointer")
	}()
	if err == nil || !strings.Contains(err.Error(), "internal error (panic)") {
		t.Fatalf("expected panic error, got: %v", err)
	}
}

func TestHelloDkgSmoke(t *testing.T) {
	result, err := HelloDkg()
	if err != nil {
		t.Fatalf("HelloDkg: %v", err)
	}
	if result == "" {
		t.Fatal("HelloDkg returned empty result")
	}
	if !strings.Contains(result, "dkls23 ok") {
		t.Fatalf("unexpected HelloDkg result: %q", result)
	}
}
