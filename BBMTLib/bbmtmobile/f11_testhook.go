//go:build bbmt_test

// Test bridge for f11_seam_test.go. _test.go files cannot import "C",
// so these tag-gated helpers perform the cgo calls and return plain Go
// values. Excluded from production builds (build-dkls.sh never sets
// bbmt_test). Run: go test -tags bbmt_test ./bbmtmobile/
package main

import "C"
import "strings"

func testFinish(out *C.char) string {
	if out == nil {
		panic("export returned nil *C.char")
	}
	s := C.GoString(out)
	BbmtFree(out)
	return s
}

func testSha256Of(s string) string {
	return testFinish(BbmtSha256(C.CString(s)))
}

func testSha256Null() string {
	return testFinish(BbmtSha256(nil))
}

func testSha256Big(n int) string {
	return testFinish(BbmtSha256(C.CString(strings.Repeat("z", n))))
}

func testSecureRandom(n int) string {
	return testFinish(BbmtSecureRandom(C.int(n)))
}

func testSpendingHashNeg() string {
	return testFinish(BbmtSpendingHash(C.CString("tb1qtest"), C.CString("tb1qtest2"), -1))
}

func testDerivedPubKeyBadFlag() string {
	return testFinish(BbmtGetDerivedPubKey(C.CString("a"), C.CString("b"), C.CString("c"), 2))
}

func testPreParamsNegTimeout() string {
	return testFinish(BbmtLocalPreParams(C.CString("/tmp/does-not-exist.ppm"), -5))
}

// testMustGoStr exercises mustGoStr and reports a validation panic as a
// string instead of propagating it.
func testMustGoStr(s string, nullArg, over bool) (res string, perr string) {
	defer func() {
		if r := recover(); r != nil {
			if e, ok := r.(*f11Error); ok {
				perr = e.Error()
			} else {
				perr = "non-f11 panic"
			}
		}
	}()
	if nullArg {
		res = mustGoStr(nil, "x")
		return res, ""
	}
	if over {
		res = mustGoStr(C.CString(strings.Repeat("z", maxBridgeString+1)), "x")
		return res, ""
	}
	res = mustGoStr(C.CString(s), "x")
	return res, ""
}

func testRecoverShape() string {
	var out *C.char
	func() {
		defer recoverBridge(&out)
		panic("boom")
	}()
	return testFinish(out)
}
