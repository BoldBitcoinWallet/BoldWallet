package dkls

import (
	"bytes"
	"strings"
	"testing"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// F13: post-restart safety. A killed-and-retried ceremony meets relay state
// the app no longer remembers: stale (pre-kill) messages under a reused
// session, or duplicated deliveries. Session IDs are fresh-random per
// ceremony so reuse is unreachable in practice; these tests prove the lib
// layer is safe anyway: stale messages are cryptographically rejected,
// duplicates are absorbed, and every round uses fresh nonces.

func f13DKG(t *testing.T) ([]*libtss.KeyShareHandle, libtss.PublicKeyPackage) {
	t.Helper()
	shares, pubkeys, err := RunDKGInProcess([]byte("f13-session"))
	if err != nil {
		t.Fatalf("RunDKGInProcess: %v", err)
	}
	t.Cleanup(func() {
		for _, s := range shares {
			if s != nil {
				s.Free()
			}
		}
	})
	return shares, pubkeys
}

func f13IDs(t *testing.T, shares []*libtss.KeyShareHandle) []libtss.Identifier {
	t.Helper()
	ids := make([]libtss.Identifier, len(shares))
	for i, s := range shares {
		id, err := s.Identifier()
		if err != nil {
			t.Fatalf("Identifier: %v", err)
		}
		ids[i] = id
	}
	return ids
}

func f13NewSessions(t *testing.T, shares []*libtss.KeyShareHandle, ids []libtss.Identifier, hash []byte) ([]*libtss.SignSession, [][]libtss.Message) {
	t.Helper()
	sessions := make([]*libtss.SignSession, len(shares))
	round := make([][]libtss.Message, len(shares))
	for i, s := range shares {
		sess, msgs, err := libtss.NewSignSession(s, hash, counterpartiesFor(ids[i], ids), []byte("f13-sign"))
		if err != nil {
			t.Fatalf("NewSignSession: %v", err)
		}
		t.Cleanup(sess.Free)
		sessions[i] = sess
		round[i] = msgs
	}
	return sessions, round
}

// f13Drive runs rounds until all sessions complete or an error occurs.
func f13Drive(sessions []*libtss.SignSession, round [][]libtss.Message, ids []libtss.Identifier) (libtss.Signature, error) {
	for k := 0; k < 10; k++ {
		next := make([][]libtss.Message, len(sessions))
		var sig libtss.Signature
		done := 0
		for i := range sessions {
			step, err := sessions[i].Next(collectPeerMessages(round, i, ids[i]))
			if err != nil {
				return libtss.Signature{}, err
			}
			if step.Complete {
				sig = step.Signature
				done++
				continue
			}
			next[i] = step.Messages
		}
		if done == len(sessions) {
			return sig, nil
		}
		round = next
	}
	return libtss.Signature{}, errF13NoProgress
}

var errF13NoProgress = f13Stuck{}

type f13Stuck struct{}

func (f13Stuck) Error() string { return "f13: sessions did not complete in 10 rounds" }

func TestF13_DklsStaleReplayRejected(t *testing.T) {
	shares, _ := f13DKG(t)
	ids := f13IDs(t, shares)
	msg := []byte("f13-stale-replay")
	hash := HashMessageForDKLs(msg)

	// Ceremony 1 completes; record B's round-1 output (the "pre-kill" mail).
	s1, r1 := f13NewSessions(t, shares, ids, hash)
	staleB := append([]libtss.Message(nil), r1[1]...)
	if _, err := f13Drive(s1, r1, ids); err != nil {
		t.Fatalf("ceremony 1: %v", err)
	}

	// Ceremony 2: fresh sessions, but B's round-1 is replaced with the
	// stale recording — exactly a relay redelivering pre-kill messages.
	s2, r2 := f13NewSessions(t, shares, ids, hash)
	r2[1] = staleB
	sig, err := f13Drive(s2, r2, ids)
	if err == nil {
		t.Fatalf("stale replay accepted (sig len %d): want clean rejection", len(sig.Data))
	}
	if len(sig.Data) != 0 {
		t.Fatalf("stale replay produced signature bytes despite error")
	}
	// The rejection must come from the protocol's commitment binding,
	// not from a crash or a hang.
	if !strings.Contains(strings.ToLower(err.Error()), "commitment") {
		t.Fatalf("stale replay error is not the commitment binding: %v", err)
	}
}

func TestF13_DklsDuplicateAbsorbed(t *testing.T) {
	shares, pubkeys := f13DKG(t)
	ids := f13IDs(t, shares)
	msg := []byte("f13-duplicate")
	hash := HashMessageForDKLs(msg)

	sessions, round := f13NewSessions(t, shares, ids, hash)
	// Session 0 receives its round-1 peers twice in one Next (duplicated
	// delivery). Must not error, must still emit its round-2 message.
	peers := collectPeerMessages(round, 0, ids[0])
	dup := append(append([]libtss.Message(nil), peers...), peers...)
	step, err := sessions[0].Next(dup)
	if err != nil {
		t.Fatalf("duplicate delivery errored: %v", err)
	}
	if step.Complete || len(step.Messages) == 0 {
		t.Fatalf("duplicate broke session 0 progress: complete=%v nmsgs=%d", step.Complete, len(step.Messages))
	}
	// Remaining sessions advance normally on round 1, then drive to
	// completion with session 0's post-duplicate output in the mix.
	next := make([][]libtss.Message, len(sessions))
	next[0] = step.Messages
	for i := 1; i < len(sessions); i++ {
		st, err := sessions[i].Next(collectPeerMessages(round, i, ids[i]))
		if err != nil {
			t.Fatalf("session %d: %v", i, err)
		}
		next[i] = st.Messages
	}
	sig, err := f13Drive(sessions, next, ids)
	if err != nil {
		t.Fatalf("ceremony after duplicate: %v", err)
	}
	valid, err := libtss.Verify(libtss.CiphersuiteSecp256k1ECDSA, msg, sig.Data, pubkeys.VerifyingKey)
	if err != nil || !valid {
		t.Fatalf("post-duplicate signature invalid: valid=%v err=%v", valid, err)
	}
}

func TestF13_DklsConsecutiveSignsDiffer(t *testing.T) {
	shares, pubkeys := f13DKG(t)
	hash := HashMessageForDKLs([]byte("f13-same-message"))
	// Same keyshare, same message, two rounds: fresh ephemerals per round
	// (hence across restarts a fortiori) => distinct valid signatures.
	sig1, err := RunSignInProcess(shares, hash)
	if err != nil {
		t.Fatalf("sign 1: %v", err)
	}
	sig2, err := RunSignInProcess(shares, hash)
	if err != nil {
		t.Fatalf("sign 2: %v", err)
	}
	if bytes.Equal(sig1.Data, sig2.Data) {
		t.Fatalf("consecutive signatures identical: nonce reuse across rounds")
	}
	for i, sig := range []libtss.Signature{sig1, sig2} {
		valid, err := libtss.Verify(libtss.CiphersuiteSecp256k1ECDSA, []byte("f13-same-message"), sig.Data, pubkeys.VerifyingKey)
		if err != nil || !valid {
			t.Fatalf("sig %d invalid: valid=%v err=%v", i+1, valid, err)
		}
	}
}
