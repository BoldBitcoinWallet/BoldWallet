package tss

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/wire"
)

func testF20PsbtWithAmount(t *testing.T, amount int64) string {
	t.Helper()
	tx := wire.NewMsgTx(2)
	tx.AddTxIn(wire.NewTxIn(wire.NewOutPoint(&chainhash.Hash{}, 0), nil, nil))
	tx.AddTxOut(wire.NewTxOut(amount, []byte{0x51}))
	pkt, err := psbt.NewFromUnsignedTx(tx)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := pkt.Serialize(&buf); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestF20_DigestDeterministicAcrossEncodings(t *testing.T) {
	// Cross-platform vector: sha256("psbt\xff\x00" decoded bytes).
	raw := []byte{0x70, 0x73, 0x62, 0x74, 0xff, 0x00}
	withPad := base64.StdEncoding.EncodeToString(raw)
	noPad := strings.TrimRight(withPad, "=")
	withSpace := withPad[:4] + " \n" + withPad[4:]

	want, err := Sha256Bytes(raw)
	if err != nil {
		t.Fatal(err)
	}
	for name, in := range map[string]string{"pad": withPad, "nopad": noPad, "space": withSpace} {
		got, err := PsbtConfirmationDigest(in)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got != want {
			t.Fatalf("%s: digest %q != %q", name, got, want)
		}
	}

	// Full PSBT: whitespace variant must not change the digest.
	full := validTestPSBTBase64(t)
	d1, err := PsbtConfirmationDigest(full)
	if err != nil {
		t.Fatal(err)
	}
	d2, err := PsbtConfirmationDigest(full[:8] + "\n" + full[8:])
	if err != nil {
		t.Fatal(err)
	}
	if d1 != d2 {
		t.Fatalf("whitespace changed digest: %q vs %q", d1, d2)
	}
}

func TestF20_DigestBindsFullArtifact(t *testing.T) {
	a, err := PsbtConfirmationDigest(testF20PsbtWithAmount(t, 1000))
	if err != nil {
		t.Fatal(err)
	}
	b, err := PsbtConfirmationDigest(testF20PsbtWithAmount(t, 2000))
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("different outputs must produce different digests")
	}
}

func TestF20_ConfirmationJSON(t *testing.T) {
	out, err := PsbtConfirmation(testF20PsbtWithAmount(t, 1000))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatal(err)
	}
	digest, _ := m["digest"].(string)
	if len(digest) != 64 {
		t.Fatalf("digest missing/short: %v", m["digest"])
	}
	if _, ok := m["outputs"]; !ok {
		t.Fatalf("outputs missing: %v", m)
	}
	if _, ok := m["fee"]; !ok {
		t.Fatalf("fee missing: %v", m)
	}
	network, _ := m["network"].(string)
	if network != "testnet4" && network != "mainnet" {
		t.Fatalf("network missing/unknown: %v", m["network"])
	}
}

func TestF20_ConfirmationRejectsGarbage(t *testing.T) {
	for _, in := range []string{"", "not-base64!!!", "aGVsbG8="} {
		if _, err := PsbtConfirmation(in); err == nil {
			t.Fatalf("input %q must reject", in)
		}
		if _, err := PsbtConfirmationDigest(in); err == nil {
			t.Fatalf("digest input %q must reject", in)
		}
	}
}
