//go:build bbmt_test

// F27: the "error:" prefix contract. Every Go export encodes failure as an
// "error:"-prefixed string (cString + recoverBridge); success values never
// carry the prefix. Both native layers discriminate on exactly this.
//
// Run: go test -tags bbmt_test ./bbmtmobile/
package main

import (
	"strings"
	"testing"
)

func TestF27_ErrorPrefixOnFailure(t *testing.T) {
	if got := testCStringError(); got != "error:boom" {
		t.Fatalf("cString error = %q, want error:boom", got)
	}
}

func TestF27_NoPrefixOnSuccess(t *testing.T) {
	if got := testCStringValue(); got != "ok-value" {
		t.Fatalf("cString value = %q, want ok-value", got)
	}
}

func TestF27_RealExportsPrefixErrors(t *testing.T) {
	for name, got := range map[string]string{
		"computeTxId": testComputeTxIdBadHex(),
		"hexToNpub":   testHexToNpubBadHex(),
	} {
		if !strings.HasPrefix(got, "error:") {
			t.Fatalf("%s bad input = %q, want error:-prefixed", name, got)
		}
	}
}
