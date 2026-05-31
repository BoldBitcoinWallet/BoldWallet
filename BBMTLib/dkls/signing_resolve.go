package dkls

import (
	"fmt"
	"strings"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// SigningSession maps a 2-of-n keysign round to libtss party identifiers (same as DKG).
type SigningSession struct {
	SelfID     libtss.Identifier
	SigningIDs []libtss.Identifier
	NostrPeers []string // participating npubs excluding local (Nostr transport)
	LANPeerIDs []libtss.Identifier
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
	committee := ks.KeygenCommitteeKeys
	if len(committee) < 2 {
		return SigningSession{}, fmt.Errorf("dkls keysign: invalid committee size %d", len(committee))
	}
	participating := splitCSV(partiesCSV)
	if len(participating) < 2 {
		return SigningSession{}, fmt.Errorf("dkls keysign: need at least 2 participating parties, got %d", len(participating))
	}
	rawIDs, err := partyIDsFromParticipatingKeys(participating, committee)
	if err != nil {
		return SigningSession{}, err
	}
	signingIDs, err := dedupeSigningIDs(rawIDs)
	if err != nil {
		return SigningSession{}, err
	}
	if err := validateSelfInSigning(selfID, signingIDs); err != nil {
		return SigningSession{}, err
	}
	return SigningSession{
		SelfID:     selfID,
		SigningIDs: signingIDs,
		LANPeerIDs: lanPeerIDsFromSigning(selfID, signingIDs),
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
	participating, err := normalizeParticipatingNpubs(partiesNpubsCSV)
	if err != nil {
		return SigningSession{}, err
	}
	localNpub = strings.TrimSpace(localNpub)
	if localNpub == "" {
		return SigningSession{}, fmt.Errorf("dkls keysign: local npub is empty")
	}
	if !npubInList(localNpub, participating) {
		return SigningSession{}, fmt.Errorf("dkls keysign: local npub not in participating set %v", participating)
	}
	signingIDs := make([]libtss.Identifier, len(participating))
	for i, npub := range participating {
		id, err := partyIDFromNpub(npub, committee)
		if err != nil {
			return SigningSession{}, fmt.Errorf("dkls keysign: npub %q not in committee: %w", npub, err)
		}
		signingIDs[i] = id
	}
	signingIDs, err = dedupeSigningIDs(signingIDs)
	if err != nil {
		return SigningSession{}, err
	}
	if err := validateSelfInSigning(selfID, signingIDs); err != nil {
		return SigningSession{}, err
	}
	expected, err := partyIDFromNpub(localNpub, committee)
	if err != nil {
		return SigningSession{}, err
	}
	if expected != selfID {
		return SigningSession{}, fmt.Errorf("dkls keysign: share id %d != committee index for local npub (%d)", selfID, expected)
	}
	peers := filterPeers(participating, localNpub)
	return SigningSession{
		SelfID:     selfID,
		SigningIDs: signingIDs,
		NostrPeers: peers,
	}, nil
}

// normalizeParticipatingNpubs sorts and deduplicates signing npubs (matches mobile Nostr pairing).
func normalizeParticipatingNpubs(partiesNpubsCSV string) ([]string, error) {
	participating := sortedPartiesNpubs(splitCSV(partiesNpubsCSV))
	seen := make(map[string]struct{}, len(participating))
	out := make([]string, 0, len(participating))
	for _, npub := range participating {
		if _, dup := seen[npub]; dup {
			return nil, fmt.Errorf("dkls keysign: duplicate npub in participating parties: %s", npub)
		}
		seen[npub] = struct{}{}
		out = append(out, npub)
	}
	if len(out) < 2 {
		return nil, fmt.Errorf("dkls keysign: need at least 2 distinct participating npubs, got %d", len(out))
	}
	return out, nil
}

func npubInList(npub string, list []string) bool {
	npub = strings.TrimSpace(npub)
	for _, p := range list {
		if strings.TrimSpace(p) == npub {
			return true
		}
	}
	return false
}

func validateSelfInSigning(selfID libtss.Identifier, signingIDs []libtss.Identifier) error {
	for _, id := range signingIDs {
		if id == selfID {
			return nil
		}
	}
	return fmt.Errorf("dkls keysign: local party id %d not in signing set %v", selfID, signingIDs)
}
