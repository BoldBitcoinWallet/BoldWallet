package dkls

import (
	"fmt"
	"sort"
	"strings"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// partyKeyForID returns the LAN relay moniker (KeyShareN) used by the mobile app.
func partyKeyForID(id libtss.Identifier) string {
	return fmt.Sprintf("KeyShare%d", id)
}

// partyIDFromKey maps LAN relay keys or script partyN names to libtss identifiers.
// Deprecated for keysign: use partyIDFromParticipatingKey with committee context.
func partyIDFromKey(key string) libtss.Identifier {
	id, err := partyIDFromKeyMoniker(key)
	if err != nil {
		return 0
	}
	return id
}

// partyIDFromKeyMoniker parses KeyShareN / partyN monikers only.
func partyIDFromKeyMoniker(key string) (libtss.Identifier, error) {
	key = strings.TrimSpace(key)
	if strings.HasPrefix(key, "KeyShare") {
		var n int
		if _, err := fmt.Sscanf(key, "KeyShare%d", &n); err == nil && n > 0 {
			return libtss.Identifier(n), nil
		}
	}
	if strings.HasPrefix(key, "party") {
		var n int
		if _, err := fmt.Sscanf(key, "party%d", &n); err == nil && n > 0 {
			return libtss.Identifier(n), nil
		}
	}
	return 0, fmt.Errorf("dkls: unrecognized party moniker %q", key)
}

func committeeUsesNpubs(committee []string) bool {
	for _, p := range committee {
		if strings.HasPrefix(strings.TrimSpace(p), "npub1") {
			return true
		}
	}
	return false
}

func sortedCommitteeKeys(committee []string) []string {
	out := make([]string, 0, len(committee))
	for _, p := range committee {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}

// partyIDFromParticipatingKey maps a LAN keysign participant moniker to a libtss id.
// KeyShareN / partyN are DKG ids (the N in the moniker), not committee-array indexes:
// duo joiners persist ["KeyShare2","KeyShare1"], but KeyShare2 is still id 2.
// Npub committees keep lex-label mapping (KeyShareN → sorted npubs → DKG id).
func partyIDFromParticipatingKey(key string, committee []string) (libtss.Identifier, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return 0, fmt.Errorf("empty party key")
	}
	if len(committee) < 2 {
		return 0, fmt.Errorf("invalid committee size %d", len(committee))
	}
	if strings.HasPrefix(key, "KeyShare") {
		var n int
		if _, err := fmt.Sscanf(key, "KeyShare%d", &n); err != nil || n <= 0 {
			return 0, fmt.Errorf("invalid KeyShare label %q", key)
		}
		if committeeUsesNpubs(committee) {
			sorted := sortedCommitteeKeys(committee)
			if n > len(sorted) {
				return 0, fmt.Errorf("KeyShare%d out of committee range (size %d)", n, len(sorted))
			}
			return partyIDFromNpub(sorted[n-1], committee)
		}
		return partyIDFromKeyMoniker(key)
	}
	if strings.HasPrefix(key, "party") {
		return partyIDFromKeyMoniker(key)
	}
	for i, p := range committee {
		if strings.TrimSpace(p) == key {
			return libtss.Identifier(i + 1), nil
		}
	}
	if strings.HasPrefix(key, "npub1") {
		return partyIDFromNpub(key, committee)
	}
	return 0, fmt.Errorf("party %q not in committee", key)
}

func partyIDsFromParticipatingKeys(parties []string, committee []string) ([]libtss.Identifier, error) {
	ids := make([]libtss.Identifier, len(parties))
	for i, p := range parties {
		id, err := partyIDFromParticipatingKey(p, committee)
		if err != nil {
			return nil, fmt.Errorf("dkls keysign: %w", err)
		}
		ids[i] = id
	}
	return ids, nil
}

func dedupeSigningIDs(ids []libtss.Identifier) ([]libtss.Identifier, error) {
	seen := make(map[libtss.Identifier]struct{}, len(ids))
	out := make([]libtss.Identifier, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) < 2 {
		return nil, fmt.Errorf("dkls keysign: need at least 2 distinct party ids, got %v", ids)
	}
	return out, nil
}

func lanPeerIDsFromSigning(selfID libtss.Identifier, signingIDs []libtss.Identifier) []libtss.Identifier {
	var peers []libtss.Identifier
	for _, id := range signingIDs {
		if id != selfID {
			peers = append(peers, id)
		}
	}
	return peers
}

// ensureLANRelayJoinKey validates the app relay slot and returns the canonical KeyShareN for selfID.
func ensureLANRelayJoinKey(relayKey string, selfID libtss.Identifier, committee []string) (string, error) {
	canonical := partyKeyForID(selfID)
	relayKey = strings.TrimSpace(relayKey)
	if relayKey == "" {
		return canonical, nil
	}
	id, err := partyIDFromParticipatingKey(relayKey, committee)
	if err != nil {
		return "", fmt.Errorf("dkls keysign: relay join key %q: %w", relayKey, err)
	}
	if id != selfID {
		return "", fmt.Errorf(
			"dkls keysign: relay join key %q maps to party id %d, share is id %d (use %s)",
			relayKey, id, selfID, canonical,
		)
	}
	return canonical, nil
}
