package tss

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// F32 (Option A): SAS-authenticated ECDH for trio LAN keygen.
//
// The old trio session key — sha256(sessionID + "," + masterHost) — is
// derived from LAN-public values, so any LAN observer can decrypt and
// forge trio keygen traffic. The replacement, per ceremony:
//
//  1. Phase 1 (TrioECDHPhase1): each device generates an ephemeral P-256
//     keypair, posts its pubkey, collects peer pubkeys, then runs a
//     Burmester-Desmedt round over the sorted-party ring (each party
//     posts X_i = s_left XOR s_right) and verifies X_1^X_2^X_3 == 0 so
//     a forged X aborts instead of splitting the group key. Returns a
//     6-digit SAS (short authentication string). All honest devices
//     compute the SAME SAS; JS shows it on the pairing screens and the
//     ceremony proceeds only after the user confirms the codes match
//     on every device (reuses the matching-codes UX).
//  2. Phase 2 (TrioECDHConfirm): after user confirmation, the group
//     secret G = s_12^s_23^s_31 is reconstructed (each party recovers
//     its one unknown pairwise secret from a neighbor's X), combined
//     into the AES session key, and the private key is wiped. The
//     handle is one-shot — the key is ceremony-scoped, never persisted.
//
// Pairwise ECDH alone cannot yield a group key (each party holds only
// 2 of the 3 pair secrets); the BD round is what makes all three
// devices converge without a dealer.
//
// Fail-closed (per product decision, no silent fallback):
//   - Peers that never post (pre-ECDH app versions) time out with
//     TRIO_PEER_OUTDATED — old↔new trio keygen refuses instead of
//     downgrading to the public derivation.
//   - The public derivation itself is retired: DeriveLANSessionKey
//     now returns TRIO_LEGACY_KEY_REFUSED.
// Trio signing already uses duo-style ECIES and is unaffected; duo is
// unaffected.

// Typed F32 errors. Callers and the JS layer match on these prefixes.
var (
	errTrioPeerOutdated     = fmt.Errorf("TRIO_PEER_OUTDATED: peer did not complete the ECDH exchange — outdated app version; update all devices and pair again (no legacy fallback)")
	errTrioHandleUnknown    = fmt.Errorf("TRIO_HANDLE_UNKNOWN: unknown or already-used ECDH handle")
	errTrioLegacyRefused    = fmt.Errorf("TRIO_LEGACY_KEY_REFUSED: trio LAN no longer derives session keys from public values (F32); run the ECDH exchange")
	errTrioECDHRelayMissing = fmt.Errorf("relay has no ecdh endpoint (old version as LAN master)")
	errTrioXMismatch        = fmt.Errorf("TRIO_X_MISMATCH: ECDH cross-check failed — a posted value is forged; aborting (possible active attacker)")
)

// trioECDHCollectTimeout bounds each exchange round. Keygen runs before
// joiners are awaited, so this is longer than the F39 barrier; tests
// shrink it via TRIO_ECDH_SEC.
func trioECDHCollectTimeout() time.Duration {
	if s := os.Getenv("TRIO_ECDH_SEC"); s != "" {
		if sec, err := strconv.Atoi(s); err == nil && sec > 0 {
			return time.Duration(sec) * time.Second
		}
	}
	return 120 * time.Second
}

type trioECDHState struct {
	priv     *ecdh.PrivateKey
	peerPubs map[string]string
	ring     []string
	xMap     map[string]string
}

var trioECDHMu sync.Mutex
var trioECDHHandles = map[string]*trioECDHState{}

func trioECDHNewHandle() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("F32 ECDH handle rand failed: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// trioECDSAS derives the 6-digit compare code. Inputs are sorted peer
// pubkeys plus the ceremony session, so every honest device derives
// the identical code; a MITM feeding different pubkeys per victim
// produces visibly different codes.
func trioECDSAS(sortedPubHexes []string, session string) (string, error) {
	h, err := Sha256(strings.Join(sortedPubHexes, "|") + "|" + session)
	if err != nil {
		return "", err
	}
	raw, err := hex.DecodeString(h)
	if err != nil || len(raw) < 4 {
		return "", fmt.Errorf("F32 SAS hash decode failed")
	}
	digits := binary.BigEndian.Uint32(raw[:4]) % 1000000
	return fmt.Sprintf("%06d", digits), nil
}

func trioECDSplitParties(partiesCSV string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, p := range strings.Split(partiesCSV, ",") {
		p = strings.TrimSpace(p)
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

func trioXOR(a, b []byte) []byte {
	out := make([]byte, len(a))
	for i := range a {
		out[i] = a[i] ^ b[i]
	}
	return out
}

func postTrioECDHKey(server, session, party, pubHex string) error {
	payload, err := json.Marshal(map[string]string{"party": party, "pubkey": pubHex})
	if err != nil {
		return fmt.Errorf("failed to marshal ecdh payload: %w", err)
	}
	resp, err := relayRequestClient.Post(
		strings.TrimRight(server, "/")+"/ecdh/keygen/"+session,
		"application/json", bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("failed to post ecdh pubkey: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return errTrioECDHRelayMissing
	}
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ecdh/keygen status %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return nil
}

func fetchTrioECDHKeys(server, session string) (map[string]string, error) {
	resp, err := relayRequestClient.Get(strings.TrimRight(server, "/") + "/ecdh/keygen/" + session)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch ecdh pubkeys: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, errTrioECDHRelayMissing
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ecdh/keygen status %s", resp.Status)
	}
	buff, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read ecdh body: %w", err)
	}
	var pubs map[string]string
	if err := json.Unmarshal(buff, &pubs); err != nil {
		return nil, fmt.Errorf("failed to decode ecdh pubkeys: %w", err)
	}
	return pubs, nil
}

func postTrioECDHXValue(server, session, party, xHex string) error {
	payload, err := json.Marshal(map[string]string{"party": party, "x": xHex})
	if err != nil {
		return fmt.Errorf("failed to marshal ecdh-x payload: %w", err)
	}
	resp, err := relayRequestClient.Post(
		strings.TrimRight(server, "/")+"/ecdh/xchg/"+session,
		"application/json", bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("failed to post ecdh-x: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return errTrioECDHRelayMissing
	}
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ecdh/xchg status %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return nil
}

func fetchTrioECDHX(server, session string) (map[string]string, error) {
	resp, err := relayRequestClient.Get(strings.TrimRight(server, "/") + "/ecdh/xchg/" + session)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch ecdh-x values: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, errTrioECDHRelayMissing
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ecdh/xchg status %s", resp.Status)
	}
	buff, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read ecdh-x body: %w", err)
	}
	var xs map[string]string
	if err := json.Unmarshal(buff, &xs); err != nil {
		return nil, fmt.Errorf("failed to decode ecdh-x values: %w", err)
	}
	return xs, nil
}

// validateTrioECDHPub requires a 130-hex uncompressed P-256 point
// (0x04 || X || Y). Malformed peer keys fail the exchange, never
// the ceremony silently.
func validateTrioECDHPub(pubHex string) error {
	if len(pubHex) != 130 || !strings.HasPrefix(strings.ToLower(pubHex), "04") {
		return fmt.Errorf("ecdh pubkey must be 130-hex uncompressed P-256")
	}
	if !isHexString(pubHex) {
		return fmt.Errorf("ecdh pubkey must be hex")
	}
	return nil
}

// trioPairSecret runs ECDH against one peer pubkey hex.
func trioPairSecret(priv *ecdh.PrivateKey, peer, pubHex string) ([]byte, error) {
	raw, err := hex.DecodeString(pubHex)
	if err != nil {
		return nil, fmt.Errorf("F32 peer %s pubkey decode failed: %w", peer, err)
	}
	pub, err := ecdh.P256().NewPublicKey(raw)
	if err != nil {
		return nil, fmt.Errorf("F32 peer %s pubkey rejected: %w", peer, err)
	}
	secret, err := priv.ECDH(pub)
	if err != nil {
		return nil, fmt.Errorf("F32 ECDH with peer %s failed: %w", peer, err)
	}
	return secret, nil
}

// verifyTrioXXor requires X_1^X_2^...^X_n == 0: every pairwise secret
// appears in exactly two broadcasts, so any forged X breaks the
// invariant and fails the exchange closed.
func verifyTrioXXor(xs map[string]string) error {
	var acc []byte
	for party, xHex := range xs {
		raw, err := hex.DecodeString(xHex)
		if err != nil || len(raw) != 32 {
			return fmt.Errorf("%w: party %s posted a malformed X value", errTrioXMismatch, party)
		}
		if acc == nil {
			acc = raw
		} else {
			acc = trioXOR(acc, raw)
		}
	}
	for _, b := range acc {
		if b != 0 {
			return errTrioXMismatch
		}
	}
	return nil
}

// trioCollectPolls a relay map until every party is present, the
// session is cancelled, or the round times out (fail closed).
func trioCollect(fetch func() (map[string]string, error), parties []string, cancelCh <-chan struct{}) (map[string]string, error) {
	timeout := time.NewTimer(trioECDHCollectTimeout())
	defer timeout.Stop()
	poll := time.NewTicker(500 * time.Millisecond)
	defer poll.Stop()
	for {
		got, ferr := fetch()
		if ferr != nil {
			if ferr == errTrioECDHRelayMissing {
				return nil, fmt.Errorf("%w: LAN master runs a pre-ECDH app version", errTrioPeerOutdated)
			}
			Logln("BBMTLog", "F32: ecdh fetch failed, retrying", ferr)
		} else {
			complete := true
			for _, p := range parties {
				if _, ok := got[p]; !ok {
					complete = false
					break
				}
			}
			if complete {
				return got, nil
			}
		}
		select {
		case <-cancelCh:
			return nil, fmt.Errorf("F32 ECDH exchange cancelled")
		case <-timeout.C:
			return nil, errTrioPeerOutdated
		case <-poll.C:
		}
	}
}

// TrioECDHPhase1 generates this device's ephemeral ECDH keypair, runs
// both exchange rounds (pubkeys, then BD X values with the XOR
// invariant check), and returns JSON {"handle","sas","parties"}. The
// private key stays in Go memory under the handle until Phase 2 or
// Abort (both one-shot wipes).
func TrioECDHPhase1(server, session, selfParty string, partiesCSV string) (result string, err error) {
	defer RecoverAsError("TrioECDHPhase1", &err, &result)
	parties := trioECDSplitParties(partiesCSV)
	if len(parties) < 2 {
		return "", fmt.Errorf("F32 ECDH needs at least 2 parties, got %d", len(parties))
	}
	selfParty = strings.TrimSpace(selfParty)
	if selfParty == "" {
		return "", fmt.Errorf("F32 ECDH needs a non-empty self party")
	}
	selfKnown := false
	for _, p := range parties {
		if p == selfParty {
			selfKnown = true
		}
	}
	if !selfKnown {
		return "", fmt.Errorf("F32 ECDH self party %q not in parties", selfParty)
	}

	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return "", fmt.Errorf("F32 ECDH keygen failed: %w", err)
	}
	ownPub := hex.EncodeToString(priv.PublicKey().Bytes())

	handle, err := trioECDHNewHandle()
	if err != nil {
		return "", err
	}

	if err := postTrioECDHKey(server, session, selfParty, ownPub); err != nil {
		if err == errTrioECDHRelayMissing {
			return "", fmt.Errorf("%w: LAN master runs a pre-ECDH app version", errTrioPeerOutdated)
		}
		return "", err
	}

	cancelCh := getOrCreateCancelCh(session)
	pubs, err := trioCollect(func() (map[string]string, error) {
		return fetchTrioECDHKeys(server, session)
	}, parties, cancelCh)
	if err != nil {
		return "", err
	}

	peerPubs := map[string]string{}
	sortedPubs := []string{ownPub}
	for _, p := range parties {
		if p == selfParty {
			continue
		}
		h := strings.ToLower(strings.TrimSpace(pubs[p]))
		if verr := validateTrioECDHPub(h); verr != nil {
			return "", fmt.Errorf("F32 peer %s posted an invalid ECDH pubkey: %w", p, verr)
		}
		peerPubs[p] = h
		sortedPubs = append(sortedPubs, h)
	}
	sort.Strings(sortedPubs)

	// Round 2 (Burmester-Desmedt): ring order is sorted party names.
	// Own X = s_left XOR s_right; every pairwise secret appears in
	// exactly two broadcasts.
	ring := append([]string{}, parties...)
	sort.Strings(ring)
	selfIdx := -1
	for i, p := range ring {
		if p == selfParty {
			selfIdx = i
		}
	}
	leftPeer := ring[(selfIdx-1+len(ring))%len(ring)]
	rightPeer := ring[(selfIdx+1)%len(ring)]
	secretL, err := trioPairSecret(priv, leftPeer, peerPubs[leftPeer])
	if err != nil {
		return "", err
	}
	secretR, err := trioPairSecret(priv, rightPeer, peerPubs[rightPeer])
	if err != nil {
		return "", err
	}
	ownX := hex.EncodeToString(trioXOR(secretL, secretR))
	if err := postTrioECDHXValue(server, session, selfParty, ownX); err != nil {
		if err == errTrioECDHRelayMissing {
			return "", fmt.Errorf("%w: LAN master runs a pre-ECDH app version", errTrioPeerOutdated)
		}
		return "", err
	}
	xMap, err := trioCollect(func() (map[string]string, error) {
		return fetchTrioECDHX(server, session)
	}, parties, cancelCh)
	if err != nil {
		return "", err
	}
	if err := verifyTrioXXor(xMap); err != nil {
		return "", err
	}

	sas, err := trioECDSAS(sortedPubs, session)
	if err != nil {
		return "", err
	}

	trioECDHMu.Lock()
	trioECDHHandles[handle] = &trioECDHState{priv: priv, peerPubs: peerPubs, ring: ring, xMap: xMap}
	trioECDHMu.Unlock()

	out, err := json.Marshal(map[string]string{
		"handle":  handle,
		"sas":     sas,
		"parties": strings.Join(parties, ","),
	})
	if err != nil {
		return "", fmt.Errorf("F32 ECDH phase-1 marshal failed: %w", err)
	}
	return string(out), nil
}

// TrioECDHConfirm runs after the user confirms matching SAS codes on
// every device. It reconstructs the group secret G = s_12^s_23^s_31
// (recovering the one unknown pairwise secret from a neighbor's X),
// derives the ceremony-scoped AES session key, wipes the private key,
// and returns the session-key hex (same 64-hex shape as the retired
// derivation — drop-in for existing sessionKey plumbing).
func TrioECDHConfirm(handle, session string) (result string, err error) {
	defer RecoverAsError("TrioECDHConfirm", &err, &result)
	trioECDHMu.Lock()
	st, ok := trioECDHHandles[handle]
	if ok {
		delete(trioECDHHandles, handle)
	}
	trioECDHMu.Unlock()
	if !ok || st == nil || st.priv == nil {
		return "", errTrioHandleUnknown
	}

	// Own pair secrets with ring neighbors.
	selfParty := selfOf(st)
	n := len(st.ring)
	selfIdx := -1
	for i, p := range st.ring {
		if p == selfParty {
			selfIdx = i
		}
	}
	if selfIdx < 0 {
		return "", fmt.Errorf("F32 ECDH state lost self party")
	}
	leftPeer := st.ring[(selfIdx-1+n)%n]
	rightPeer := st.ring[(selfIdx+1)%n]
	secretL, err := trioPairSecret(st.priv, leftPeer, st.peerPubs[leftPeer])
	if err != nil {
		return "", err
	}
	secretR, err := trioPairSecret(st.priv, rightPeer, st.peerPubs[rightPeer])
	if err != nil {
		return "", err
	}
	// Missing secret (between the two neighbors) = X_left XOR s_own_left.
	xLeftHex, ok := st.xMap[leftPeer]
	if !ok {
		return "", fmt.Errorf("%w: missing X for %s", errTrioXMismatch, leftPeer)
	}
	xLeft, err := hex.DecodeString(xLeftHex)
	if err != nil || len(xLeft) != 32 {
		return "", fmt.Errorf("%w: malformed X for %s", errTrioXMismatch, leftPeer)
	}
	missing := trioXOR(xLeft, secretL)
	group := trioXOR(trioXOR(secretL, secretR), missing)
	sessionKey, err := Sha256("trio-ecdh-v1|" + hex.EncodeToString(group) + "|" + session)
	if err != nil {
		return "", err
	}
	return sessionKey, nil
}

// selfOf recovers the self party: the ring entry absent from peerPubs.
func selfOf(st *trioECDHState) string {
	for _, p := range st.ring {
		if _, isPeer := st.peerPubs[p]; !isPeer {
			return p
		}
	}
	return ""
}

// TrioECDHAbort wipes a phase-1 handle without deriving (user saw a
// SAS mismatch). Best-effort; always succeeds.
func TrioECDHAbort(handle string) (result string, err error) {
	defer RecoverAsError("TrioECDHAbort", &err, &result)
	trioECDHMu.Lock()
	delete(trioECDHHandles, handle)
	trioECDHMu.Unlock()
	return "ok", nil
}
