package tss

import "testing"

func TestParseTssBackend(t *testing.T) {
	cases := []struct {
		in   string
		want TssBackend
	}{
		{"gg18", BackendGG18},
		{"GG18", BackendGG18},
		{"", BackendGG18},
		{"dkls23", BackendDKLs23},
		{"dkls", BackendDKLs23},
	}
	for _, tc := range cases {
		got, err := ParseTssBackend(tc.in)
		if err != nil {
			t.Fatalf("ParseTssBackend(%q): %v", tc.in, err)
		}
		if got != tc.want {
			t.Fatalf("ParseTssBackend(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
	if _, err := ParseTssBackend("bogus"); err == nil {
		t.Fatal("expected error for bogus backend")
	}
}
