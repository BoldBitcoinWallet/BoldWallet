//go:build bbmt_test

// F27 test hooks: pin the "error:" prefix contract the native layers rely
// on (Kotlin unwrap, Swift prefix checks, inline startsWith checks).
package main

import "C"
import "errors"

func testCStringError() string {
	return testFinish(cString("", errors.New("boom")))
}

func testCStringValue() string {
	return testFinish(cString("ok-value", nil))
}

func testComputeTxIdBadHex() string {
	return testFinish(BbmtComputeTxId(C.CString("zz-not-hex")))
}

func testHexToNpubBadHex() string {
	return testFinish(BbmtHexToNpub(C.CString("zz")))
}
