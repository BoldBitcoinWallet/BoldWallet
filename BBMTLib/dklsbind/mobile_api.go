// Package dklsbind exposes DKLs23 entry points for gomobile (delegates to dkls on desktop builds).
package dklsbind

import "github.com/BoldBitcoinWallet/BBMTLib/dklsstub"

// HelloDkg smoke-tests DKLs23 linkage (desktop: full DKG; mobile: stub unless JNI linked).
func HelloDkg() string {
	return dklsstub.HelloDkg()
}

// BackendName identifies the DKLs23 MPC backend in keyshare metadata.
func BackendName() string {
	return "dkls23"
}
