//go:build dkls_desktop

package dklsstub

import "github.com/BoldBitcoinWallet/BBMTLib/dkls"

func HelloDkg() string {
	result, err := dkls.HelloDkg()
	if err != nil {
		return "error:" + err.Error()
	}
	return result
}
