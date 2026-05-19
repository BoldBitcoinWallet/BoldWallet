package dkls

import (
	"fmt"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// SigningSession maps a 2-of-n keysign round to libtss party identifiers (same as DKG).
type SigningSession struct {
	SelfID       libtss.Identifier
	SigningIDs   []libtss.Identifier
	NostrPeers   []string // participating npubs excluding local (Nostr transport)
	LANPeerIDs   []libtss.Identifier
}

// ResolveSigningSessionLAN maps LAN party monikers (KeyShareN) to DKG identifiers.
// partiesCSV lists only devices participating in this keysign (2 for trio spend).
func ResolveSigningSessionLAN(
	share *libtss.KeyShareHandle,
	ks *KeyshareJSON,
	partiesCSV string,
) (SigningSession, error) {
	selfID, err := share.Identifier()
	if err != nil {
		return SigningSession{}, fmt.Errorf("share identifier: %w", err)
	}
	participating := splitCSV(partiesCSV)
	if len(participating) < 2 {
		return SigningSession{}, fmt.Errorf("dkls keysign: need at least 2 participating parties, got %d", len(participating))
	}
	signingIDs := partyIDsFromKeys(participating)
	if err := validateSelfInSigning(selfID, signingIDs); err != nil {
		return SigningSession{}, err
	}
	_ = ks // committee validated via share handle
	return SigningSession{
		SelfID:     selfID,
		SigningIDs: signingIDs,
		LANPeerIDs: signingIDs,
	}, nil
}

// ResolveSigningSessionNostr maps participating npubs to DKG identifiers using
// keygen_committee_keys order (matches GG18 nostr keysign subset behavior).
func ResolveSigningSessionNostr(
	share *libtss.KeyShareHandle,
	ks *KeyshareJSON,
	localNpub, partiesNpubsCSV string,
) (SigningSession, error) {
	selfID, err := share.Identifier()
	if err != nil {
		return SigningSession{}, fmt.Errorf("share identifier: %w", err)
	}
	committee := ks.KeygenCommitteeKeys
	if len(committee) < 2 {
		return SigningSession{}, fmt.Errorf("dkls keysign: invalid committee size %d", len(committee))
	}
	participating := splitCSV(partiesNpubsCSV)
	if len(participating) < 2 {
		return SigningSession{}, fmt.Errorf("dkls keysign: need at least 2 participating npubs, got %d", len(participating))
	}
	signingIDs := make([]libtss.Identifier, len(participating))
	for i, npub := range participating {
		id := partyIDFromNpub(npub, committee)
		if id < 1 {
			return SigningSession{}, fmt.Errorf("dkls keysign: npub %q not in committee", npub)
		}
		signingIDs[i] = id
	}
	if err := validateSelfInSigning(selfID, signingIDs); err != nil {
		return SigningSession{}, err
	}
	expected := partyIDFromNpub(localNpub, committee)
	if expected >= 1 && expected != selfID {
		return SigningSession{}, fmt.Errorf("dkls keysign: share id %d != committee index for local npub (%d)", selfID, expected)
	}
	peers := filterPeers(participating, localNpub)
	return SigningSession{
		SelfID:     selfID,
		SigningIDs: signingIDs,
		NostrPeers: peers,
	}, nil
}

func validateSelfInSigning(selfID libtss.Identifier, signingIDs []libtss.Identifier) error {
	for _, id := range signingIDs {
		if id == selfID {
			return nil
		}
	}
	return fmt.Errorf("dkls keysign: local party id %d not in signing set %v", selfID, signingIDs)
}
