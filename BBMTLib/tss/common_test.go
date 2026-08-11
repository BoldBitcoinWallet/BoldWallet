package tss

import "testing"

func TestNormalizeChainCodeHex(t *testing.T) {
	seed := "a" + repeatChar('b', 63)
	attempt := "c" + repeatChar('d', 63)

	got, err := normalizeChainCodeHex(seed)
	if err != nil {
		t.Fatalf("raw hex: %v", err)
	}
	if got != seed {
		t.Fatalf("raw hex: got %q want %q", got, seed)
	}

	payload := attempt + ":" + seed
	got, err = normalizeChainCodeHex(payload)
	if err != nil {
		t.Fatalf("lan payload: %v", err)
	}
	if got != seed {
		t.Fatalf("lan payload: got %q want %q", got, seed)
	}

	if _, err := normalizeChainCodeHex(""); err == nil {
		t.Fatal("expected error for empty")
	}
	if _, err := normalizeChainCodeHex("not-hex"); err == nil {
		t.Fatal("expected error for invalid")
	}
	if _, err := normalizeChainCodeHex(attempt + ":short"); err == nil {
		t.Fatal("expected error for short seed")
	}
	zeros := repeatChar('0', 64)
	if _, err := normalizeChainCodeHex(zeros); err == nil {
		t.Fatal("expected error for all-zero chain code")
	}
	if _, err := normalizeChainCodeHex(attempt + ":" + zeros); err == nil {
		t.Fatal("expected error for all-zero LAN seed")
	}
	if _, err := NormalizeChainCodeHex(seed); err != nil {
		t.Fatalf("NormalizeChainCodeHex: %v", err)
	}
}

func repeatChar(c byte, n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = c
	}
	return string(b)
}
