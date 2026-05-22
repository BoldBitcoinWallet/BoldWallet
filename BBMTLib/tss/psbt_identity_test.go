package tss

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/wire"
)

func validTestPSBTBase64(t *testing.T) string {
	t.Helper()
	tx := wire.NewMsgTx(2)
	tx.AddTxIn(wire.NewTxIn(wire.NewOutPoint(&chainhash.Hash{}, 0), nil, nil))
	tx.AddTxOut(wire.NewTxOut(1000, []byte{0x51}))
	pkt, err := psbt.NewFromUnsignedTx(tx)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := pkt.Serialize(&buf); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	if _, err := psbt.NewFromRawBytes(bytes.NewReader(raw), false); err != nil {
		t.Fatalf("serialized PSBT not parseable: %v", err)
	}
	return base64.StdEncoding.EncodeToString(raw)
}

func TestCanonicalPsbtBase64NormalizesPadding(t *testing.T) {
	// Minimal PSBT header: psbt\xff + empty global map
	raw := []byte{0x70, 0x73, 0x62, 0x74, 0xff, 0x00}
	withPad := base64.StdEncoding.EncodeToString(raw)
	noPad := strings.TrimRight(withPad, "=")

	canonPad, err := canonicalPsbtBase64(withPad)
	if err != nil {
		t.Fatal(err)
	}
	canonNoPad, err := canonicalPsbtBase64(noPad)
	if err != nil {
		t.Fatal(err)
	}
	if canonPad != canonNoPad {
		t.Fatalf("canonical mismatch: %q vs %q", canonPad, canonNoPad)
	}
}

func TestPsbtIdentityHashStableAcrossBase64Variants(t *testing.T) {
	a := validTestPSBTBase64(t)
	b := strings.TrimRight(a, "=")

	ha, err := PsbtIdentityHash(a)
	if err != nil {
		t.Fatal(err)
	}
	hb, err := PsbtIdentityHash(b)
	if err != nil {
		t.Fatal(err)
	}
	if ha != hb {
		t.Fatalf("identity hash mismatch: %s vs %s", ha, hb)
	}
}
