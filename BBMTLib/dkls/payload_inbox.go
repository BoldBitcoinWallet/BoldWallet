package dkls

import (
	"context"
	"fmt"
	"sort"
	"time"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// dkgPhase2ScalarLen is the exact fragment size libtss phase 2 expects
// (see libtss dkls.rs scalar_from_message). Later rounds are larger.
const dkgPhase2ScalarLen = 32

// payloadInbox keeps a per-sender FIFO of transport payloads (one Send each).
// DKG/sign rounds pop at most one payload per sender so a faster peer's next
// round is not fed into session.Next with the current round.
type payloadInbox struct {
	queues map[libtss.Identifier][][]libtss.Message
}

type payloadMatch func([]libtss.Message) bool

func newPayloadInbox() *payloadInbox {
	return &payloadInbox{queues: make(map[libtss.Identifier][][]libtss.Message)}
}

func (in *payloadInbox) enqueue(payload []libtss.Message, selfID libtss.Identifier) {
	byFrom := make(map[libtss.Identifier][]libtss.Message)
	for _, m := range filterMessagesFor(selfID, payload) {
		if m.From == 0 || m.From == selfID {
			continue
		}
		byFrom[m.From] = append(byFrom[m.From], m)
	}
	for from, msgs := range byFrom {
		in.queues[from] = append(in.queues[from], msgs)
	}
}

func (in *payloadInbox) queuedSenderCount() int {
	return in.matchingSenderCount(nil)
}

func (in *payloadInbox) matchingSenderCount(match payloadMatch) int {
	n := 0
	for _, q := range in.queues {
		for _, payload := range q {
			if match == nil || match(payload) {
				n++
				break
			}
		}
	}
	return n
}

func (in *payloadInbox) sendersReady() []libtss.Identifier {
	ids := make([]libtss.Identifier, 0, len(in.queues))
	for from, q := range in.queues {
		if len(q) > 0 {
			ids = append(ids, from)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func (in *payloadInbox) popOnePerSender(maxSenders int) []libtss.Message {
	return in.popOnePerSenderMatching(maxSenders, nil)
}

func (in *payloadInbox) popOnePerSenderMatching(maxSenders int, match payloadMatch) []libtss.Message {
	if maxSenders < 1 {
		maxSenders = 1
	}
	var out []libtss.Message
	n := 0
	for _, from := range in.sendersReady() {
		if n >= maxSenders {
			break
		}
		q := in.queues[from]
		idx := -1
		for i, payload := range q {
			if match == nil || match(payload) {
				idx = i
				break
			}
		}
		if idx < 0 {
			continue
		}
		out = append(out, q[idx]...)
		in.queues[from] = append(q[:idx], q[idx+1:]...)
		n++
	}
	return out
}

func drainRoundCh(roundCh <-chan []libtss.Message, inbox *payloadInbox, selfID libtss.Identifier) {
	for {
		select {
		case part := <-roundCh:
			inbox.enqueue(part, selfID)
		default:
			return
		}
	}
}

func payloadIsScalarPhase(msgs []libtss.Message) bool {
	if len(msgs) == 0 {
		return false
	}
	for _, m := range msgs {
		if len(m.Data) != dkgPhase2ScalarLen {
			return false
		}
	}
	return true
}

func senderSet(batch []libtss.Message, selfID libtss.Identifier) map[libtss.Identifier]struct{} {
	seen := make(map[libtss.Identifier]struct{})
	for _, m := range filterMessagesFor(selfID, batch) {
		if m.From != 0 && m.From != selfID {
			seen[m.From] = struct{}{}
		}
	}
	return seen
}

// recvPeerPayloadRound waits until needPeerMsgs senders each have at least one
// queued payload, then pops exactly one payload per those senders.
func recvPeerPayloadRound(
	ctx context.Context,
	roundCh <-chan []libtss.Message,
	inbox *payloadInbox,
	selfID libtss.Identifier,
	needPeerMsgs int,
	deadline time.Time,
) ([]libtss.Message, error) {
	return recvPeerPayloadRoundMatching(ctx, roundCh, inbox, selfID, needPeerMsgs, deadline, nil)
}

func recvPeerPayloadRoundMatching(
	ctx context.Context,
	roundCh <-chan []libtss.Message,
	inbox *payloadInbox,
	selfID libtss.Identifier,
	needPeerMsgs int,
	deadline time.Time,
	match payloadMatch,
) ([]libtss.Message, error) {
	if needPeerMsgs < 1 {
		needPeerMsgs = 1
	}
	for inbox.matchingSenderCount(match) < needPeerMsgs {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("DKLs operation canceled: %w", ctx.Err())
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("DKLs timed out waiting for peer messages")
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("DKLs operation canceled: %w", ctx.Err())
		case part := <-roundCh:
			inbox.enqueue(part, selfID)
			drainRoundCh(roundCh, inbox, selfID)
		case <-time.After(200 * time.Millisecond):
		}
	}
	return inbox.popOnePerSenderMatching(needPeerMsgs, match), nil
}

// recvMorePayload waits for a newly arrived transport payload (does not pop
// leftovers already queued from earlier rounds). Payloads from senders already
// in presentSenders stay queued and are not returned for the current Next.
func recvMorePayload(
	ctx context.Context,
	roundCh <-chan []libtss.Message,
	inbox *payloadInbox,
	selfID libtss.Identifier,
	deadline time.Time,
	peerQuiesce time.Duration,
	presentSenders map[libtss.Identifier]struct{},
	match payloadMatch,
) ([]libtss.Message, error) {
	for {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("DKLs operation canceled: %w", ctx.Err())
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("DKLs timed out waiting for peer messages")
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("DKLs operation canceled: %w", ctx.Err())
		case part := <-roundCh:
			missing, extra := splitPayloadByPresent(part, selfID, presentSenders)
			if match != nil && len(missing) > 0 && !match(missing) {
				extra = append(extra, missing...)
				missing = nil
			}
			if len(extra) > 0 {
				inbox.enqueue(extra, selfID)
			}
			if len(missing) > 0 {
				return missing, nil
			}
		case <-time.After(peerQuiesce):
		}
	}
}

func splitPayloadByPresent(
	part []libtss.Message,
	selfID libtss.Identifier,
	presentSenders map[libtss.Identifier]struct{},
) (missing, extra []libtss.Message) {
	for _, m := range filterMessagesFor(selfID, part) {
		if m.From == 0 || m.From == selfID {
			continue
		}
		if _, ok := presentSenders[m.From]; ok && presentSenders != nil {
			extra = append(extra, m)
			continue
		}
		missing = append(missing, m)
	}
	return missing, extra
}
