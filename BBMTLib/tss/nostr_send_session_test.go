package tss

import "testing"

func TestNostrSendBtcSessionFlagStableWithoutBalance(t *testing.T) {
	npubs := "npub1aaa,npub1bbb"
	recv := "tb1qreceiver"
	amount := int64(50_000)

	a, err := nostrSendBtcSessionFlag(npubs, recv, amount)
	if err != nil {
		t.Fatal(err)
	}
	b, err := nostrSendBtcSessionFlag(npubs, recv, amount)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("session flag should be deterministic: %s vs %s", a, b)
	}

	other, err := nostrSendBtcSessionFlag(npubs, recv, amount+1)
	if err != nil {
		t.Fatal(err)
	}
	if a == other {
		t.Fatal("different amount should change session flag")
	}
}
