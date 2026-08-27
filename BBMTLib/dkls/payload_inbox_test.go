package dkls

import (
	"context"
	"testing"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

func payloadFrom(sender libtss.Identifier, data string) []libtss.Message {
	return []libtss.Message{{From: sender, To: 0, Data: []byte(data)}}
}

func TestPayloadInboxPopsOneRoundPerSender(t *testing.T) {
	self := libtss.Identifier(1)
	in := newPayloadInbox()
	in.enqueue(payloadFrom(2, "r1"), self)
	in.enqueue(payloadFrom(2, "r2"), self)
	in.enqueue(payloadFrom(3, "r1"), self)

	batch := in.popOnePerSender(2)
	if len(batch) != 2 {
		t.Fatalf("expected 2 messages in first round, got %d", len(batch))
	}
	seen := map[libtss.Identifier]string{}
	for _, m := range batch {
		seen[m.From] = string(m.Data)
	}
	if seen[2] != "r1" || seen[3] != "r1" {
		t.Fatalf("first pop mixed rounds: %+v", batch)
	}
	if in.queuedSenderCount() != 1 {
		t.Fatalf("expected leftover from sender 2, senders=%d", in.queuedSenderCount())
	}

	next := in.popOnePerSender(2)
	if len(next) != 1 || string(next[0].Data) != "r2" || next[0].From != 2 {
		t.Fatalf("expected leftover r2 from sender 2, got %+v", next)
	}
}

func TestRecvPeerPayloadRoundLeavesFutureRoundQueued(t *testing.T) {
	self := libtss.Identifier(1)
	ch := make(chan []libtss.Message, 8)
	inbox := newPayloadInbox()
	ch <- payloadFrom(2, "r1")
	ch <- payloadFrom(2, "r2")
	ch <- payloadFrom(3, "r1")

	ctx := context.Background()
	deadline := time.Now().Add(2 * time.Second)
	batch, err := recvPeerPayloadRound(ctx, ch, inbox, self, 2, deadline)
	if err != nil {
		t.Fatalf("recvPeerPayloadRound: %v", err)
	}
	if peerSenderCount(batch, self) != 2 {
		t.Fatalf("expected 2 senders, got %d (%+v)", peerSenderCount(batch, self), batch)
	}
	for _, m := range batch {
		if string(m.Data) == "r2" {
			t.Fatalf("round-2 payload was included in round-1 batch: %+v", batch)
		}
	}
	if inbox.queuedSenderCount() != 1 {
		t.Fatalf("expected sender 2 round-2 still queued, senders=%d", inbox.queuedSenderCount())
	}

	// recvMorePayload must wait for a newly arrived item, not pop leftovers,
	// and must not merge a payload from a sender already in the current batch.
	ch <- payloadFrom(2, "r2b")
	ch <- payloadFrom(3, "r2")
	present := map[libtss.Identifier]struct{}{2: {}}
	more, err := recvMorePayload(ctx, ch, inbox, self, deadline, 50*time.Millisecond, present, nil)
	if err != nil {
		t.Fatalf("recvMorePayload: %v", err)
	}
	if len(more) != 1 || more[0].From != 3 || string(more[0].Data) != "r2" {
		t.Fatalf("recvMorePayload should return only the missing sender, got %+v", more)
	}
	if inbox.queuedSenderCount() != 1 {
		t.Fatalf("sender 2 extras must stay queued, senders=%d", inbox.queuedSenderCount())
	}
}

func TestPayloadInboxPopsScalarPhaseSkippingLaterRound(t *testing.T) {
	self := libtss.Identifier(1)
	in := newPayloadInbox()
	r2 := bytesOfLen(40, 'x')
	r1 := bytesOfLen(dkgPhase2ScalarLen, 's')
	in.enqueue([]libtss.Message{{From: 2, To: 1, Data: r2}}, self)
	in.enqueue([]libtss.Message{{From: 2, To: 1, Data: r1}}, self)
	in.enqueue([]libtss.Message{{From: 3, To: 1, Data: bytesOfLen(dkgPhase2ScalarLen, 't')}}, self)

	batch := in.popOnePerSenderMatching(2, payloadIsScalarPhase)
	if len(batch) != 2 {
		t.Fatalf("expected 2 scalar payloads, got %d", len(batch))
	}
	for _, m := range batch {
		if len(m.Data) != dkgPhase2ScalarLen {
			t.Fatalf("popped non-scalar payload: from=%d len=%d", m.From, len(m.Data))
		}
	}
	if in.queuedSenderCount() != 1 {
		t.Fatalf("expected leftover later-round from sender 2, senders=%d", in.queuedSenderCount())
	}
	left := in.popOnePerSender(1)
	if len(left) != 1 || left[0].From != 2 || len(left[0].Data) != 40 {
		t.Fatalf("expected queued r2 from sender 2, got %+v", left)
	}
}

func TestRecvPeerPayloadRoundScalarSkipsOutOfOrderRound2(t *testing.T) {
	self := libtss.Identifier(1)
	ch := make(chan []libtss.Message, 8)
	inbox := newPayloadInbox()
	ch <- []libtss.Message{{From: 2, To: 1, Data: bytesOfLen(40, 'x')}}
	ch <- []libtss.Message{{From: 2, To: 1, Data: bytesOfLen(dkgPhase2ScalarLen, 's')}}
	ch <- []libtss.Message{{From: 3, To: 1, Data: bytesOfLen(dkgPhase2ScalarLen, 't')}}

	ctx := context.Background()
	deadline := time.Now().Add(2 * time.Second)
	batch, err := recvPeerPayloadRoundMatching(ctx, ch, inbox, self, 2, deadline, payloadIsScalarPhase)
	if err != nil {
		t.Fatalf("recvPeerPayloadRoundMatching: %v", err)
	}
	if peerSenderCount(batch, self) != 2 {
		t.Fatalf("expected 2 senders, got %d", peerSenderCount(batch, self))
	}
	for _, m := range batch {
		if len(m.Data) != dkgPhase2ScalarLen {
			t.Fatalf("round-2 payload was included in phase-2 batch: from=%d len=%d", m.From, len(m.Data))
		}
	}
	if inbox.queuedSenderCount() != 1 {
		t.Fatalf("expected sender 2 round-2 still queued, senders=%d", inbox.queuedSenderCount())
	}
}

func bytesOfLen(n int, fill byte) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = fill
	}
	return b
}
