package nostrtransport

import "testing"

func TestAbortPhaseInvokesOnAbort(t *testing.T) {
	p := NewMessagePump(Config{SessionID: "sess-abort"}, nil)
	var reasons []string
	p.SetOnAbort(func(reason string) { reasons = append(reasons, reason) })

	if !p.handleCoordinatorPhase(map[string]interface{}{
		"phase":   "abort",
		"content": "deserialize failed: invalid scalar fragment length",
	}) {
		t.Fatal("abort rumor should be handled as a coordinator phase")
	}
	if len(reasons) != 1 || reasons[0] != "deserialize failed: invalid scalar fragment length" {
		t.Fatalf("onAbort reasons=%v", reasons)
	}

	if !p.handleCoordinatorPhase(map[string]interface{}{"phase": "Abort"}) {
		t.Fatal("Abort (mixed case) should be handled")
	}
	if len(reasons) != 2 {
		t.Fatalf("onAbort called %d times, want 2", len(reasons))
	}

	if !p.handleCoordinatorPhase(map[string]interface{}{"phase": "ready"}) {
		t.Fatal("ready rumor should still be skipped by TSS")
	}
	if len(reasons) != 2 {
		t.Fatalf("ready must not invoke onAbort, called=%d", len(reasons))
	}
	if !p.handleCoordinatorPhase(map[string]interface{}{"phase": "complete"}) {
		t.Fatal("complete rumor should still be skipped by TSS")
	}
	if len(reasons) != 2 {
		t.Fatalf("complete must not invoke onAbort, called=%d", len(reasons))
	}

	if p.handleCoordinatorPhase(map[string]interface{}{"chunk": "0/1"}) {
		t.Fatal("TSS chunk rumor must not be treated as a coordinator phase")
	}
	if len(reasons) != 2 {
		t.Fatalf("chunk rumor must not invoke onAbort, called=%d", len(reasons))
	}
}
