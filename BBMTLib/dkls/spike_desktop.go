//go:build !ios && !android

package dkls

import (
	"encoding/hex"
	"fmt"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// HelloDkg runs an in-process 2-of-2 DKLs23 DKG smoke test (host / CI).
func HelloDkg() (result string, err error) {
	defer recoverAsError("HelloDkg", &err, &result)
	sessionID := []byte("boldwallet-dkls-spike")
	shares, pubkeys, err := RunDKGInProcess(sessionID)
	if err != nil {
		return "", err
	}
	defer func() {
		for _, s := range shares {
			if s != nil {
				s.Free()
			}
		}
	}()

	if len(pubkeys.VerifyingKey) == 0 {
		return "", fmt.Errorf("empty group key")
	}

	msg := []byte("boldwallet-dkls-hello")
	hash := HashMessageForDKLs(msg)
	sig, err := RunSignInProcess(shares, hash)
	if err != nil {
		return "", err
	}

	valid, err := libtss.Verify(libtss.CiphersuiteSecp256k1ECDSA, msg, sig.Data, pubkeys.VerifyingKey)
	if err != nil {
		return "", err
	}
	if !valid {
		return "", fmt.Errorf("signature verify failed")
	}

	return fmt.Sprintf("dkls23 ok pubkey=%s sig_len=%d", hex.EncodeToString(pubkeys.VerifyingKey), len(sig.Data)), nil
}
