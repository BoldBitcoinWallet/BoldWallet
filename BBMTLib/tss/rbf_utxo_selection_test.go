package tss

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"testing"
)

func utxo(txid string, vout uint32, value int64, required bool) UTXOWithPath {
	return UTXOWithPath{
		UTXO:     UTXO{TxID: txid, Vout: vout, Value: value},
		Required: required,
	}
}

func TestSelectUTXOsWithPathsPinsRequiredThenTopsUp(t *testing.T) {
	pool := []UTXOWithPath{
		utxo("aa", 0, 50_000, false),
		utxo("bb", 1, 200_000, true),
		utxo("cc", 0, 10_000, false),
		utxo("dd", 0, 80_000, true),
	}
	selected, total, err := SelectUTXOsWithPaths(pool, 100_000, "smallest")
	if err != nil {
		t.Fatal(err)
	}
	if total != 280_000 || len(selected) != 2 {
		t.Fatalf("got %d coins totaling %d", len(selected), total)
	}
	if selected[0].TxID != "bb" || selected[1].TxID != "dd" {
		t.Fatalf("required order: %+v", selected)
	}

	selected, total, err = SelectUTXOsWithPaths(pool, 300_000, "smallest")
	if err != nil {
		t.Fatal(err)
	}
	// 200k+80k required, then smallest optional 10k (still short), then 50k.
	if total != 340_000 || len(selected) != 4 {
		t.Fatalf("top-up got %d coins totaling %d, want 4 / 340000", len(selected), total)
	}
	if !selected[2].Required && selected[2].Value != 10_000 {
		t.Fatalf("first top-up should be the 10k coin, got %+v", selected[2])
	}
}

func TestSpendingHashWithUTXOsIncludesRequired(t *testing.T) {
	raw := `[
		{"txid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","vout":0,"value":50000,"required":false},
		{"txid":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","vout":1,"value":200000,"required":true,"derivation_path":"m/84'/0'/0'/0/0"}
	]`
	hash, err := SpendingHashWithUTXOs(raw, "bc1qexample", "1000")
	if err != nil {
		t.Fatal(err)
	}
	if len(hash) != 64 {
		t.Fatalf("hash %q", hash)
	}
	again, err := SpendingHashWithUTXOs(raw, "bc1qexample", "1000")
	if err != nil || again != hash {
		t.Fatalf("hash not stable: %s vs %s (%v)", hash, again, err)
	}
}

func legacySmallest(utxos []UTXOWithPath, totalAmount int64) []string {
	sort.Slice(utxos, func(i, j int) bool {
		if utxos[i].TxID != utxos[j].TxID {
			return utxos[i].TxID < utxos[j].TxID
		}
		return utxos[i].Vout < utxos[j].Vout
	})
	sort.Slice(utxos, func(i, j int) bool { return utxos[i].Value < utxos[j].Value })
	var ids []string
	var total int64
	for _, u := range utxos {
		ids = append(ids, u.TxID)
		total += u.Value
		if total >= totalAmount {
			break
		}
	}
	return ids
}

func TestSelectWithoutRequiredMatchesLegacy(t *testing.T) {
	pool := []UTXOWithPath{
		utxo("cc", 0, 10_000, false),
		utxo("aa", 1, 50_000, false),
		utxo("bb", 0, 50_000, false),
		utxo("dd", 0, 80_000, false),
	}
	selected, _, err := SelectUTXOsWithPaths(append([]UTXOWithPath(nil), pool...), 60_000, "smallest")
	if err != nil {
		t.Fatal(err)
	}
	want := legacySmallest(pool, 60_000)
	if len(selected) != len(want) {
		t.Fatalf("got %d coins, legacy %d", len(selected), len(want))
	}
	for i := range want {
		if selected[i].TxID != want[i] {
			t.Fatalf("coin %d: got %s want %s", i, selected[i].TxID, want[i])
		}
	}
}

func TestRequiredOnlyShortfallErrors(t *testing.T) {
	_, _, err := SelectUTXOsWithPaths([]UTXOWithPath{utxo("aa", 0, 1_000, true)}, 5_000, "smallest")
	if err == nil {
		t.Fatal("expected insufficient funds")
	}
}

func TestSpendingHashIsRequiredOutpoints(t *testing.T) {
	const id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	raw := `[
		{"txid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","vout":0,"value":50000,"required":false},
		{"txid":"` + id + `","vout":1,"value":200000,"required":true,"derivation_path":"m/84'/0'/0'/0/0"}
	]`
	hash, err := SpendingHashWithUTXOs(raw, "bc1qexample", "1000")
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(id + ":1"))
	if hash != hex.EncodeToString(sum[:]) {
		t.Fatalf("hash %s", hash)
	}
}

func TestBuildSpendTxPinsInputsAndDropsDust(t *testing.T) {
	prev := _btc_net
	_btc_net = "testnet4"
	t.Cleanup(func() { _btc_net = prev })
	const (
		a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		b = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	)
	addr := "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
	tx, selected, _, err := buildSpendTx(
		[]UTXOWithPath{utxo(a, 0, 10_000, true), utxo(b, 1, 10_500, true)},
		20_000, 100, addr, addr,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 2 || len(tx.TxIn) != 2 || len(tx.TxOut) != 1 {
		t.Fatalf("inputs %d outputs %d", len(tx.TxIn), len(tx.TxOut))
	}
	for _, in := range tx.TxIn {
		if in.Sequence != 0xfffffffd {
			t.Fatalf("sequence %x", in.Sequence)
		}
	}
	if tx.TxOut[0].Value != 20_000 {
		t.Fatalf("payment %d", tx.TxOut[0].Value)
	}
}
