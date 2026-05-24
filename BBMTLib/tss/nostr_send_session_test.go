package tss

import (
	"fmt"
	"testing"
)

func TestNostrSendBtcSessionFlagScopedByAttemptID(t *testing.T) {
	npubs := "npub1aaa,npub1bbb"
	recv := "tb1qreceiver"
	amount := int64(50_000)
	attemptA := "a" + repeatHex("a", 63)
	attemptB := "b" + repeatHex("b", 63)

	a, err := nostrSendBtcSessionFlag(npubs, recv, attemptA, amount)
	if err != nil {
		t.Fatal(err)
	}
	b, err := nostrSendBtcSessionFlag(npubs, recv, attemptA, amount)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("session flag should be deterministic: %s vs %s", a, b)
	}

	otherAttempt, err := nostrSendBtcSessionFlag(npubs, recv, attemptB, amount)
	if err != nil {
		t.Fatal(err)
	}
	if a == otherAttempt {
		t.Fatal("different attempt id should change session flag")
	}

	otherAmount, err := nostrSendBtcSessionFlag(npubs, recv, attemptA, amount+1)
	if err != nil {
		t.Fatal(err)
	}
	if a == otherAmount {
		t.Fatal("different amount should change session flag")
	}
}

func TestNostrAttemptHandshakeRoomStable(t *testing.T) {
	key := "npub1aaa,npub1bbb,50000,tb1qrecv"
	a, err := nostrAttemptHandshakeRoom(key)
	if err != nil {
		t.Fatal(err)
	}
	b, err := nostrAttemptHandshakeRoom(key)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatal("handshake room should be stable")
	}
}

func TestInitiatorNpubFromParties(t *testing.T) {
	initiator, err := initiatorNpubFromParties("npub1zzz,npub1aaa")
	if err != nil {
		t.Fatal(err)
	}
	if initiator != "npub1aaa" {
		t.Fatalf("expected npub1aaa, got %s", initiator)
	}
}

func TestNostrPsbtSessionFlagScopedByAttemptID(t *testing.T) {
	npubs := "npub1aaa,npub1bbb"
	psbtHash := repeatHex("d", 64)
	attemptA := "a" + repeatHex("a", 63)
	attemptB := "b" + repeatHex("b", 63)

	a, err := Sha256(fmt.Sprintf("%s,%s,%s", npubs, psbtHash, attemptA))
	if err != nil {
		t.Fatal(err)
	}
	b, err := Sha256(fmt.Sprintf("%s,%s,%s", npubs, psbtHash, attemptA))
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("session flag should be deterministic: %s vs %s", a, b)
	}

	otherAttempt, err := Sha256(fmt.Sprintf("%s,%s,%s", npubs, psbtHash, attemptB))
	if err != nil {
		t.Fatal(err)
	}
	if a == otherAttempt {
		t.Fatal("different attempt id should change PSBT session flag")
	}
}

func repeatHex(ch string, n int) string {
	out := make([]byte, n)
	for i := range out {
		out[i] = ch[0]
	}
	return string(out)
}
