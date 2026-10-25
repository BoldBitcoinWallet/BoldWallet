package tss

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// F31: mempool-suggested fee rates must be bounded before they
// flow into tx building, and a total fee must never exceed the
// payment itself.

func TestF31_FeeRateSanityBounds(t *testing.T) {
	for _, rate := range []int{1, 2, 100, 2000, MaxFeeRateSatVB} {
		if err := checkFeeRateSanity(rate); err != nil {
			t.Fatalf("rate %d must be accepted: %v", rate, err)
		}
	}
	for _, rate := range []int{0, -1, -500, MaxFeeRateSatVB + 1, 100000} {
		if err := checkFeeRateSanity(rate); err == nil {
			t.Fatalf("rate %d must be rejected", rate)
		}
	}
}

func TestF31_FeeVsAmount(t *testing.T) {
	if err := checkFeeVsAmount(10, 1000); err != nil {
		t.Fatalf("normal fee must pass: %v", err)
	}
	if err := checkFeeVsAmount(1000, 1000); err != nil {
		t.Fatalf("fee == amount must pass: %v", err)
	}
	if err := checkFeeVsAmount(1001, 1000); err == nil {
		t.Fatal("fee exceeding payment must be rejected")
	}
	if err := checkFeeVsAmount(-5, 1000); err == nil {
		t.Fatal("negative fee must be rejected")
	}
	if err := checkFeeVsAmount(10, 0); err == nil {
		t.Fatal("non-positive amount must be rejected")
	}
}

func serveFees(t *testing.T, fastest int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"fastestFee":%d,"halfHourFee":5,"hourFee":3,"economyFee":2,"minimumFee":1}`, fastest)
	}))
}

func withFeeEndpoints(t *testing.T, urls ...string) {
	t.Helper()
	prev := _api_urls
	_api_urls = urls
	t.Cleanup(func() { _api_urls = prev })
}

func TestF31_RecommendedFeesRejectsAbsurdEndpoint(t *testing.T) {
	// Absurd fast tier, sane fallback second: first endpoint is
	// skipped, second serves.
	bad := serveFees(t, 50000)
	defer bad.Close()
	good := serveFees(t, 12)
	defer good.Close()
	withFeeEndpoints(t, bad.URL, good.URL)

	rate, err := RecommendedFees("top")
	if err != nil {
		t.Fatalf("fallback endpoint must serve: %v", err)
	}
	if rate != 12 {
		t.Fatalf("expected fallback rate 12, got %d", rate)
	}
}

func TestF31_RecommendedFeesAllAbsurdFails(t *testing.T) {
	bad := serveFees(t, 0)
	defer bad.Close()
	withFeeEndpoints(t, bad.URL)

	if _, err := RecommendedFees("top"); err == nil {
		t.Fatal("all-absurd endpoints must fail, not return garbage")
	}
}

func TestF31_RecommendedFeesAcceptsSane(t *testing.T) {
	good := serveFees(t, 25)
	defer good.Close()
	withFeeEndpoints(t, good.URL)

	rate, err := RecommendedFees("top")
	if err != nil {
		t.Fatalf("sane endpoint must serve: %v", err)
	}
	if rate != 25 {
		t.Fatalf("expected 25, got %d", rate)
	}
}

func TestF31_SendRejectsFeeExceedingAmount(t *testing.T) {
	// MpcSendBTCWithUTXOs must reject before any network/UTXO
	// work: fee 2000 > amount 1000.
	_, err := MpcSendBTCWithUTXOs(
		"s", "k", "p", "sess", "sk", "ek", "dk", "ks",
		"pub", "tb1qrecv", "1000", "2000", "[]", "tb1qchg",
	)
	if err == nil {
		t.Fatal("fee exceeding amount must be rejected")
	}
	if !strings.Contains(err.Error(), "exceeds payment") {
		t.Fatalf("expected fee-exceeds error, got: %v", err)
	}
}
