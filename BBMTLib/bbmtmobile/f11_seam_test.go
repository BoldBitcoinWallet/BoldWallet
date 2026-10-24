//go:build bbmt_test

// F11: Go //export seam validation — nil/length/bounds + panic recovery.
// Every *C.char-returning export defers recoverBridge and converts args
// via mustGoStr; violations surface as typed "error:..." instead of
// crashing the host process.
//
// Run: go test -tags bbmt_test ./bbmtmobile/
package main

import (
	"strings"
	"testing"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func TestF11_MustGoStr(t *testing.T) {
	if res, perr := testMustGoStr("abc", false, false); perr != "" || res != "abc" {
		t.Fatalf("plain = %q,%q", res, perr)
	}
	if res, perr := testMustGoStr("", false, false); perr != "" || res != "" {
		t.Fatalf("empty must pass through, got %q,%q", res, perr)
	}
	if _, perr := testMustGoStr("", true, false); !strings.Contains(perr, "null x") {
		t.Fatalf("nil want f11 null error, got %q", perr)
	}
	if _, perr := testMustGoStr("", false, true); !strings.Contains(perr, "exceeds") {
		t.Fatalf("oversize want f11 exceeds error, got %q", perr)
	}
}

func TestF11_RecoverBridge(t *testing.T) {
	if got := testRecoverShape(); !strings.HasPrefix(got, "error:internal: boom") {
		t.Fatalf("unexpected panic shape %q", got)
	}
}

func TestF11_ExportNullRejects(t *testing.T) {
	if got := testSha256Null(); !strings.HasPrefix(got, "error:f11: null") {
		t.Fatalf("null arg want typed error, got %q", got)
	}
}

func TestF11_ExportOversizeRejects(t *testing.T) {
	got := testSha256Big(maxBridgeString + 1)
	if !strings.HasPrefix(got, "error:f11:") || !strings.Contains(got, "exceeds") {
		t.Fatalf("oversize want typed error, got %q", got[:64])
	}
}

func TestF11_SecureRandomBounds(t *testing.T) {
	for _, n := range []int{-1, 0, tss.MaxSecureRandomLen + 1, 100000} {
		if _, err := tss.SecureRandom(n); err == nil {
			t.Fatalf("SecureRandom(%d) want error", n)
		}
	}
	for _, n := range []int{1, 64, 1024, tss.MaxSecureRandomLen} {
		out, err := tss.SecureRandom(n)
		if err != nil {
			t.Fatalf("SecureRandom(%d): %v", n, err)
		}
		if len(out) != n {
			t.Fatalf("SecureRandom(%d) len = %d", n, len(out))
		}
	}
	// Export seam: previously panicked the process (no recover); now typed.
	if got := testSecureRandom(-1); !strings.HasPrefix(got, "error:") {
		t.Fatalf("BbmtSecureRandom(-1) want error, got %q", got)
	}
	if got := testSecureRandom(64); len(got) != 64 {
		t.Fatalf("BbmtSecureRandom(64) len = %d", len(got))
	}
}

func TestF11_ExportIntBounds(t *testing.T) {
	if got := testSpendingHashNeg(); !strings.HasPrefix(got, "error:f11:") {
		t.Fatalf("negative amount want typed error, got %q", got)
	}
	if got := testDerivedPubKeyBadFlag(); !strings.HasPrefix(got, "error:f11:") {
		t.Fatalf("isEdDSA=2 want typed error, got %q", got)
	}
	if got := testPreParamsNegTimeout(); !strings.HasPrefix(got, "error:f11:") {
		t.Fatalf("negative timeout want typed error, got %q", got)
	}
}
