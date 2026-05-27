package dkls

import (
	"crypto/sha256"
	"fmt"
	"sync"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

func collectPeerMessages(round [][]libtss.Message, idx int, selfID libtss.Identifier) []libtss.Message {
	var out []libtss.Message
	for peer := range round {
		if peer == idx {
			continue
		}
		for _, msg := range round[peer] {
			if msg.To == 0 || msg.To == selfID {
				out = append(out, msg)
			}
		}
	}
	return out
}

// MessageRouter delivers libtss TLV messages between parties in-process or via transport.
type MessageRouter struct {
	mu     sync.Mutex
	queues map[libtss.Identifier][]libtss.Message
	notify map[libtss.Identifier]chan struct{}
}

func NewMessageRouter(parties []libtss.Identifier) *MessageRouter {
	r := &MessageRouter{
		queues: make(map[libtss.Identifier][]libtss.Message),
		notify: make(map[libtss.Identifier]chan struct{}),
	}
	for _, p := range parties {
		r.queues[p] = nil
		r.notify[p] = make(chan struct{}, 64)
	}
	return r
}

func (r *MessageRouter) Post(from libtss.Identifier, msgs []libtss.Message) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, msg := range msgs {
		to := msg.To
		if to == 0 {
			for id := range r.queues {
				if id != from {
					r.queues[id] = append(r.queues[id], msg)
					select {
					case r.notify[id] <- struct{}{}:
					default:
					}
				}
			}
			continue
		}
		r.queues[to] = append(r.queues[to], msg)
		select {
		case r.notify[to] <- struct{}{}:
		default:
		}
	}
}

func (r *MessageRouter) Drain(self libtss.Identifier) []libtss.Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := r.queues[self]
	r.queues[self] = nil
	return out
}

// RunDKGParty runs DKG for one party using the shared router (duo threshold by default).
func RunDKGParty(selfID libtss.Identifier, sessionID []byte, router *MessageRouter) (*libtss.KeyShareHandle, libtss.PublicKeyPackage, error) {
	return RunDKGPartyWithThreshold(selfID, sessionID, DefaultThreshold, router)
}

// RunDKGPartyWithThreshold runs DKG for one party with an explicit threshold.
func RunDKGPartyWithThreshold(selfID libtss.Identifier, sessionID []byte, threshold libtss.ThresholdConfig, router *MessageRouter) (share *libtss.KeyShareHandle, pub libtss.PublicKeyPackage, err error) {
	defer recoverAsErrorClear("RunDKGPartyWithThreshold", &err, func() {
		share = nil
		pub = libtss.PublicKeyPackage{}
	})
	if err := initLibtss(); err != nil {
		return nil, libtss.PublicKeyPackage{}, fmt.Errorf("tss init: %w", err)
	}

	session, outMsgs, err := libtss.NewDKGSession(threshold, selfID, sessionID)
	if err != nil {
		return nil, libtss.PublicKeyPackage{}, err
	}
	defer session.Free()

	router.Post(selfID, outMsgs)

	for {
		in := router.Drain(selfID)
		if len(in) == 0 {
			<-router.notify[selfID]
			in = router.Drain(selfID)
		}
		step, err := session.Next(in)
		if err != nil {
			return nil, libtss.PublicKeyPackage{}, err
		}
		if step.Complete {
			return step.KeyShare, step.PublicKeyPackage, nil
		}
		router.Post(selfID, step.Messages)
	}
}

// RunDKGInProcess runs 2-party DKG in a single process (for scripts/tests).
func RunDKGInProcess(sessionID []byte) ([]*libtss.KeyShareHandle, libtss.PublicKeyPackage, error) {
	return RunDKGInProcessWithThreshold(sessionID, ThresholdDuo())
}

// RunDKGInProcessWithThreshold runs n-party DKG in-process (duo or trio).
func RunDKGInProcessWithThreshold(sessionID []byte, threshold libtss.ThresholdConfig) (shares []*libtss.KeyShareHandle, pubkeys libtss.PublicKeyPackage, err error) {
	defer recoverAsErrorClear("RunDKGInProcessWithThreshold", &err, func() {
		shares = nil
		pubkeys = libtss.PublicKeyPackage{}
	})
	if err := initLibtss(); err != nil {
		return nil, libtss.PublicKeyPackage{}, fmt.Errorf("tss init: %w", err)
	}

	n := threshold.MaxSigners
	sessions := make([]*libtss.DKGSession, n)
	round := make([][]libtss.Message, n)
	for i := uint16(0); i < n; i++ {
		session, messages, err := libtss.NewDKGSession(threshold, libtss.Identifier(i+1), sessionID)
		if err != nil {
			return nil, libtss.PublicKeyPackage{}, err
		}
		sessions[i] = session
		round[i] = messages
		defer session.Free()
	}

	shares = make([]*libtss.KeyShareHandle, n)
	for {
		nextRound := make([][]libtss.Message, n)
		completed := 0
		for i := range sessions {
			step, err := sessions[i].Next(collectPeerMessages(round, i, libtss.Identifier(i+1)))
			if err != nil {
				return nil, libtss.PublicKeyPackage{}, err
			}
			if step.Complete {
				shares[i] = step.KeyShare
				pubkeys = step.PublicKeyPackage
				completed++
				continue
			}
			nextRound[i] = step.Messages
		}
		if completed == int(n) {
			return shares, pubkeys, nil
		}
		round = nextRound
	}
}

// RunSignParty runs signing for one party using the shared router.
func RunSignParty(share *libtss.KeyShareHandle, message []byte, signID []byte, router *MessageRouter) (sig libtss.Signature, err error) {
	defer recoverAsErrorClear("RunSignParty", &err, func() { sig = libtss.Signature{} })
	selfID, err := share.Identifier()
	if err != nil {
		return libtss.Signature{}, err
	}

	n := DefaultThreshold.MaxSigners
	var signingParties []libtss.Identifier
	for id := libtss.Identifier(1); id <= libtss.Identifier(n); id++ {
		signingParties = append(signingParties, id)
	}

	session, outMsgs, err := libtss.NewSignSession(share, message, counterpartiesFor(selfID, signingParties), signID)
	if err != nil {
		return libtss.Signature{}, wrapNonceReuseError(err)
	}
	defer session.Free()

	router.Post(selfID, outMsgs)

	for {
		in := router.Drain(selfID)
		if len(in) == 0 {
			<-router.notify[selfID]
			in = router.Drain(selfID)
		}
		step, err := session.Next(in)
		if err != nil {
			return libtss.Signature{}, wrapNonceReuseError(err)
		}
		if step.Complete {
			step.Signature.Protocol = libtss.ProtocolDKLs23
			return step.Signature, nil
		}
		router.Post(selfID, step.Messages)
	}
}

func counterpartiesFor(selfID libtss.Identifier, signingParties []libtss.Identifier) []libtss.Identifier {
	var out []libtss.Identifier
	for _, id := range signingParties {
		if id != selfID {
			out = append(out, id)
		}
	}
	return out
}

// RunSignInProcess signs with all participants in-process (for scripts/tests).
func RunSignInProcess(shares []*libtss.KeyShareHandle, message []byte) (sig libtss.Signature, err error) {
	defer recoverAsErrorClear("RunSignInProcess", &err, func() { sig = libtss.Signature{} })
	if err := initLibtss(); err != nil {
		return libtss.Signature{}, fmt.Errorf("tss init: %w", err)
	}

	sessions := make([]*libtss.SignSession, len(shares))
	round := make([][]libtss.Message, len(shares))
	ids := make([]libtss.Identifier, len(shares))
	for i, share := range shares {
		id, err := share.Identifier()
		if err != nil {
			return libtss.Signature{}, err
		}
		ids[i] = id
	}

	signID := []byte("boldwallet-dkls-sign")
	for i, share := range shares {
		session, messages, err := libtss.NewSignSession(share, message, counterpartiesFor(ids[i], ids), signID)
		if err != nil {
			return libtss.Signature{}, wrapNonceReuseError(err)
		}
		sessions[i] = session
		round[i] = messages
		defer session.Free()
	}

	for {
		nextRound := make([][]libtss.Message, len(shares))
		completed := 0
		var sig libtss.Signature
		for i := range sessions {
			step, err := sessions[i].Next(collectPeerMessages(round, i, ids[i]))
			if err != nil {
				return libtss.Signature{}, wrapNonceReuseError(err)
			}
			if step.Complete {
				sig = step.Signature
				completed++
				continue
			}
			nextRound[i] = step.Messages
		}
		if completed == len(shares) {
			sig.Protocol = libtss.ProtocolDKLs23
			return sig, nil
		}
		round = nextRound
	}
}

// HashMessageForDKLs applies SHA-256 for DKLs23 signing input.
func HashMessageForDKLs(message []byte) []byte {
	h := sha256.Sum256(message)
	return h[:]
}
