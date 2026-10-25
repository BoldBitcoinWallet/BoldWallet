package nostrtransport

import "testing"

func TestAbortPhaseInvokesOnAbort(t *testing.T) {
	p := NewMessagePump(Config{SessionID: "sess-abort"}, nil)
	var reasons []string
	p.SetOnAbort(func(reason string) { reasons = append(reasons, reason) })

	if !p.handleCoordinatorPhase(map[string]interface{}{
		"phase":   "abort",
		"content": "deserialize failed: invalid scalar fragment length",
	}, "senderhex") {
		t.Fatal("abort rumor should be handled as a coordinator phase")
	}
	if len(reasons) != 1 || reasons[0] != "deserialize failed: invalid scalar fragment length" {
		t.Fatalf("onAbort reasons=%v", reasons)
	}

	if !p.handleCoordinatorPhase(map[string]interface{}{"phase": "Abort"}, "senderhex") {
		t.Fatal("Abort (mixed case) should be handled")
	}
	if len(reasons) != 2 {
		t.Fatalf("onAbort called %d times, want 2", len(reasons))
	}

	if !p.handleCoordinatorPhase(map[string]interface{}{"phase": "ready"}, "senderhex") {
		t.Fatal("ready rumor should still be skipped by TSS")
	}
	if len(reasons) != 2 {
		t.Fatalf("ready must not invoke onAbort, called=%d", len(reasons))
	}
	if !p.handleCoordinatorPhase(map[string]interface{}{"phase": "complete"}, "senderhex") {
		t.Fatal("complete rumor should still be skipped by TSS")
	}
	if len(reasons) != 2 {
		t.Fatalf("complete must not invoke onAbort, called=%d", len(reasons))
	}

	if p.handleCoordinatorPhase(map[string]interface{}{"chunk": "0/1"}, "senderhex") {
		t.Fatal("TSS chunk rumor must not be treated as a coordinator phase")
	}
	if len(reasons) != 2 {
		t.Fatalf("chunk rumor must not invoke onAbort, called=%d", len(reasons))
	}
}

func TestGroupKeyPhaseInvokesOnGroupKey(t *testing.T) {
	p := NewMessagePump(Config{SessionID: "sess-gk"}, nil)
	var got []string
	p.SetOnGroupKey(func(senderHex, gkHash string) {
		got = append(got, senderHex+"="+gkHash)
	})

	if !p.handleCoordinatorPhase(map[string]interface{}{
		"phase":   "keygen-groupkey",
		"content": "ab12",
	}, "peerhex") {
		t.Fatal("groupkey rumor should be handled as a coordinator phase")
	}
	if len(got) != 1 || got[0] != "peerhex=ab12" {
		t.Fatalf("onGroupKey got=%v", got)
	}

	// Empty content must not invoke (no empty-hash bypass).
	if !p.handleCoordinatorPhase(map[string]interface{}{
		"phase":   "keygen-groupkey",
		"content": "",
	}, "peerhex") {
		t.Fatal("empty groupkey rumor should still be skipped by TSS")
	}
	if len(got) != 1 {
		t.Fatalf("empty content must not invoke onGroupKey, got=%v", got)
	}

	// Without a registered callback the phase is still consumed.
	q := NewMessagePump(Config{SessionID: "sess-gk2"}, nil)
	if !q.handleCoordinatorPhase(map[string]interface{}{
		"phase":   "keygen-groupkey",
		"content": "ab12",
	}, "peerhex") {
		t.Fatal("groupkey rumor without callback should still be skipped by TSS")
	}
}
