package tss

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
	mecdsa "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	"github.com/btcsuite/btcd/btcutil"
)

// UTXO represents an unspent transaction output
type UTXO struct {
	TxID   string `json:"txid"`
	Vout   uint32 `json:"vout"`
	Value  int64  `json:"value"` // Value in satoshis
	Status struct {
		Confirmed   bool  `json:"confirmed"`
		BlockHeight int64 `json:"block_height"`
	} `json:"status,omitempty"` // Status is optional, includes both confirmed and unconfirmed UTXOs
}

// UTXOWithPath extends UTXO with derivation path and scriptpubkey for HD wallets (per-input signing).
// Scriptpubkey (hex) is optional: when present, FetchUTXODetails is skipped during signing,
// removing the last network call from the MPC signing loop.
type UTXOWithPath struct {
	UTXO
	DerivationPath string `json:"derivation_path,omitempty"`
	Scriptpubkey   string `json:"scriptpubkey,omitempty"`
}

var _btc_net = "testnet3" // default chain params remain testnet3-compatible
var _api_url = "https://mempool.space/testnet4/api"
var _api_urls = []string{"https://mempool.space/api", "https://benpool.space/api"}

var _fee_set = "30m"

func UseFeeAPIs(urls string) (string, error) {
	_api_urls = strings.Split(urls, ",")
	return urls, nil
}

func SetNetwork(network string) (string, error) {
	normalized := network
	if normalized == "testnet" || normalized == "testnet4" {
		normalized = "testnet3"
	}
	if normalized == "mainnet" || normalized == "testnet3" {
		_btc_net = normalized
		switch normalized {
		case "mainnet":
			_api_url = "https://mempool.space/api"
		case "testnet3":
			_api_url = "https://mempool.space/testnet4/api"
		}
		return _api_url, nil
	}
	return "", fmt.Errorf("non supported network %s", network)
}

func UseAPI(network, base string) (string, error) {
	normalized := network
	if normalized == "testnet" || normalized == "testnet4" {
		normalized = "testnet3"
	}
	if normalized == "mainnet" || normalized == "testnet3" {
		_btc_net = normalized
		_api_url = strings.TrimSuffix(base, "/")
		return _api_url, nil
	}
	return "", fmt.Errorf("non supported network %s", network)
}

func UseFeePolicy(feeType string) (string, error) {
	if feeType == "30m" || feeType == "1hr" || feeType == "min" || feeType == "eco" || feeType == "top" {
		_fee_set = feeType
		return "ok", nil
	}
	return "", fmt.Errorf("invalid fee type: top, eco, min, 1hr, 30m")
}

func GetNetwork() (string, error) {
	return _btc_net + "@" + _api_url, nil
}

// FetchUTXOs fetches UTXOs for a given address
// The mempool.space API returns both confirmed and unconfirmed UTXOs by default
func FetchUTXOs(address string) (result []UTXO, err error) {
	defer RecoverAsErrorf("FetchUTXOs", &err, "internal error (panic) fetching UTXOs: %v", func() { result = nil })

	url := fmt.Sprintf("%s/address/%s/utxo", _api_url, address)
	Logf("Fetching UTXOs from endpoint: %s", url)
	resp, err := http.Get(url)
	if err != nil {
		Logf("Error fetching UTXOs from %s: %v", url, err)
		return nil, fmt.Errorf("failed to fetch UTXOs: %w", err)
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		Logf("Error response from %s: HTTP %d - %s", url, resp.StatusCode, string(body))
		return nil, fmt.Errorf("failed to fetch UTXOs: HTTP %d - %s", resp.StatusCode, string(body))
	}
	Logf("Successfully fetched UTXOs from %s (HTTP %d)", url, resp.StatusCode)

	// Read the response body to log it
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		Logf("Error reading response body from %s: %v", url, err)
		return nil, fmt.Errorf("failed to read UTXO response: %w", err)
	}

	// Log the raw response (first 500 chars to avoid huge logs)
	bodyStr := string(bodyBytes)
	if len(bodyStr) > 500 {
		Logf("Raw API response (first 500 chars): %s...", bodyStr[:500])
	} else {
		Logf("Raw API response: %s", bodyStr)
	}

	// Decode JSON from the body bytes
	var utxos []UTXO
	if err := json.Unmarshal(bodyBytes, &utxos); err != nil {
		Logf("Error parsing JSON response from %s: %v. Response was: %s", url, err, bodyStr)
		return nil, fmt.Errorf("failed to parse UTXO response: %w", err)
	}

	// Log UTXO status for debugging
	if len(utxos) > 0 {
		confirmedCount := 0
		unconfirmedCount := 0
		totalValue := int64(0)
		for _, utxo := range utxos {
			totalValue += utxo.Value
			if utxo.Status.Confirmed {
				confirmedCount++
			} else {
				unconfirmedCount++
			}
		}
		Logf("Fetched %d UTXOs: %d confirmed, %d unconfirmed, total value: %d satoshis", len(utxos), confirmedCount, unconfirmedCount, totalValue)
		// Log first few UTXOs for debugging
		for i, utxo := range utxos {
			if i < 3 { // Log first 3 UTXOs
				Logf("UTXO[%d]: txid=%s, vout=%d, value=%d, confirmed=%v", i, utxo.TxID, utxo.Vout, utxo.Value, utxo.Status.Confirmed)
			}
		}
	} else {
		Logf("No UTXOs found for address %s (this includes both confirmed and unconfirmed)", address)
		Logf("API returned empty array. This could mean:")
		Logf("  - Address has no UTXOs (all spent)")
		Logf("  - Address format mismatch")
		Logf("  - Network mismatch (checking testnet vs mainnet)")
		Logf("  - API endpoint issue")
	}

	return utxos, nil
}

func TotalUTXO(address string) (result string, err error) {
	defer RecoverAsError("TotalUTXO", &err, &result)

	utxos, err := FetchUTXOs(address)
	if err != nil {
		return "", err
	}
	total := 0
	for _, utxo := range utxos {
		Logf("Adding UTXO: %s with value: %d", utxo.TxID, utxo.Value)
		total = total + int(utxo.Value)
	}
	return fmt.Sprintf("%d", total), nil
}

func FetchUTXODetails(txID string, vout uint32) (result *wire.TxOut, isWitnessResult bool, err error) {
	defer RecoverAsErrorf("FetchUTXODetails", &err, "internal error (panic) fetching UTXO details: %v", func() {
		result = nil
		isWitnessResult = false
	})

	url := fmt.Sprintf("%s/tx/%s", _api_url, txID)
	Logf("Fetching UTXO details from endpoint: %s", url)
	resp, err := http.Get(url)
	if err != nil {
		Logf("Error fetching UTXO details from %s: %v", url, err)
		return nil, false, fmt.Errorf("failed to fetch transaction details: %w", err)
	}
	defer resp.Body.Close()

	var txData struct {
		Vout []struct {
			Scriptpubkey string `json:"scriptpubkey"`
			Value        int64  `json:"value"`
		} `json:"vout"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&txData); err != nil {
		return nil, false, fmt.Errorf("failed to parse transaction response: %w", err)
	}

	// Check if vout index is valid
	if len(txData.Vout) == 0 {
		return nil, false, fmt.Errorf("transaction %s has no outputs", txID)
	}
	if vout >= uint32(len(txData.Vout)) {
		return nil, false, fmt.Errorf("invalid vout %d for txID %s (transaction has %d outputs)", vout, txID, len(txData.Vout))
	}

	// Safely access the vout
	voutData := txData.Vout[vout]
	if voutData.Scriptpubkey == "" {
		return nil, false, fmt.Errorf("empty scriptpubkey for txID %s vout %d", txID, vout)
	}

	scriptBytes, err := hex.DecodeString(voutData.Scriptpubkey)
	if err != nil {
		return nil, false, fmt.Errorf("failed to decode scriptpubkey: %w", err)
	}
	isWitness := txscript.IsWitnessProgram(scriptBytes)
	return &wire.TxOut{PkScript: scriptBytes, Value: voutData.Value}, isWitness, nil
}

func RecommendedFees(feeType string) (int, error) {
	for _, url := range _api_urls {
		fee_url := strings.TrimSuffix(url, "/")
		url := fmt.Sprintf("%s/v1/fees/recommended", fee_url)
		Logf("Fetching recommended fees from endpoint: %s (fee type: %s)", url, feeType)
		resp, err := http.Get(url)
		if err != nil {
			Logf("Error fetching fees from %s: %v, trying next endpoint", url, err)
			continue
		}
		defer resp.Body.Close()
		var fees FeeResponse
		if err := json.NewDecoder(resp.Body).Decode(&fees); err != nil {
			continue
		}
		switch feeType {
		case "top":
			return fees.FastestFee, nil
		case "30m":
			return fees.HalfHourFee, nil
		case "1hr":
			return fees.HourFee, nil
		case "eco":
			return fees.EconomyFee, nil
		case "min":
			return fees.MinimumFee, nil
		default:
			return 0, errors.New("invalid fee type: top, eco, min, 1hr, 30m")
		}
	}
	return 0, errors.New("failed to get fees")
}

// ComputeTxId returns the txid (reversed double-SHA256 of serialized tx) for a raw tx hex.
// Used by the app to name the shared file before broadcasting.
func ComputeTxId(rawTxHex string) (string, error) {
	rawTx, err := hex.DecodeString(rawTxHex)
	if err != nil {
		return "", fmt.Errorf("invalid raw tx hex: %w", err)
	}
	hash := chainhash.DoubleHashH(rawTx)
	return hash.String(), nil
}

func PostTx(rawTxHex string) (string, error) {
	const maxRetries = 4
	var lastErr error

	for attempt := 1; attempt <= maxRetries; attempt++ {
		txid, err := postTxOnce(rawTxHex)
		if err == nil {
			return txid, nil
		}
		lastErr = err
		Logf("PostTx attempt %d/%d failed: %v", attempt, maxRetries, err)
		if attempt < maxRetries {
			time.Sleep(time.Duration(attempt) * time.Second) // Exponential backoff: 1s, 2s
		}
	}

	return "", fmt.Errorf("failed after %d attempts: %w", maxRetries, lastErr)
}

func postTxOnce(rawTxHex string) (string, error) {
	// Define the Blockstream API endpoint for broadcasting transactions
	url := fmt.Sprintf("%s/tx", _api_url)
	Logf("Broadcasting transaction to endpoint: %s", url)

	// Create a POST request with the raw transaction hex as the body
	req, err := http.NewRequest("POST", url, bytes.NewBufferString(rawTxHex))
	if err != nil {
		Logf("Error creating POST request to %s: %v", url, err)
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	// Set appropriate headers

	// Send the request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	// Check the response status
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to broadcast transaction: %s", string(body))
	} else {
		Logf("ok")
	}
	// Read the transaction ID (txid) from the response body
	txid, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	// Return the txid as a string
	return string(txid), nil
}

// SelectUTXOs selects the optimal set of UTXOs based on the strategy
func SelectUTXOs(utxos []UTXO, totalAmount int64, strategy string) (result []UTXO, totalSelectedResult int64, err error) {
	defer RecoverAsErrorf("SelectUTXOs", &err, "internal error (panic) selecting UTXOs: %v", func() {
		result = nil
		totalSelectedResult = 0
	})

	// Sort UTXOs based on the strategy
	switch strategy {
	case "smallest":
		sort.Slice(utxos, func(i, j int) bool { return utxos[i].Value < utxos[j].Value })
	case "largest":
		sort.Slice(utxos, func(i, j int) bool { return utxos[i].Value > utxos[j].Value })
	default:
		sort.Slice(utxos, func(i, j int) bool { return utxos[i].Value > utxos[j].Value })
	}

	var selected []UTXO
	var totalSelected int64

	for _, utxo := range utxos {
		Logf("Selecting UTXO: %s with value: %d", utxo.TxID, utxo.Value)
		selected = append(selected, utxo)
		totalSelected += utxo.Value
		if totalSelected >= totalAmount {
			break
		}
	}

	if totalSelected < totalAmount {
		return nil, 0, fmt.Errorf("insufficient funds: needed %d, got %d", totalAmount, totalSelected)
	}
	Logf("Total selected amount / needed amount: %d/%d", totalSelected, totalAmount)

	return selected, totalSelected, nil
}

// utxoWithPathJSON is used for JSON unmarshaling from RN (supports both derivation_path and derivationPath).
type utxoWithPathJSON struct {
	TxID         string `json:"txid"`
	Vout         uint32 `json:"vout"`
	Value        int64  `json:"value"`
	Path         string `json:"derivation_path"`
	PathAlt      string `json:"derivationPath"`
	Address      string `json:"address"`      // optional, for fee estimation fallback
	Scriptpubkey string `json:"scriptpubkey"` // hex locking script; when set avoids FetchUTXODetails during signing
}

func (u *utxoWithPathJSON) toUTXOWithPath() UTXOWithPath {
	path := u.Path
	if path == "" {
		path = u.PathAlt
	}
	return UTXOWithPath{
		UTXO:           UTXO{TxID: u.TxID, Vout: u.Vout, Value: u.Value},
		DerivationPath: path,
		Scriptpubkey:   u.Scriptpubkey,
	}
}

// SelectUTXOsWithPaths selects UTXOs from a pool with per-UTXO derivation paths.
func SelectUTXOsWithPaths(utxos []UTXOWithPath, totalAmount int64, strategy string) (result []UTXOWithPath, totalSelectedResult int64, err error) {
	defer RecoverAsErrorf("SelectUTXOsWithPaths", &err, "internal error (panic) selecting UTXOs: %v", func() {
		result = nil
		totalSelectedResult = 0
	})

	// Sort by (TxID, Vout) first for determinism, then by strategy
	sort.Slice(utxos, func(i, j int) bool {
		if utxos[i].TxID != utxos[j].TxID {
			return utxos[i].TxID < utxos[j].TxID
		}
		if utxos[i].Vout != utxos[j].Vout {
			return utxos[i].Vout < utxos[j].Vout
		}
		return false
	})
	switch strategy {
	case "smallest":
		sort.Slice(utxos, func(i, j int) bool { return utxos[i].Value < utxos[j].Value })
	case "largest":
		sort.Slice(utxos, func(i, j int) bool { return utxos[i].Value > utxos[j].Value })
	default:
		sort.Slice(utxos, func(i, j int) bool { return utxos[i].Value > utxos[j].Value })
	}

	var selected []UTXOWithPath
	var totalSelected int64
	for _, utxo := range utxos {
		Logf("Selecting UTXO: %s vout=%d value=%d path=%s", utxo.TxID, utxo.Vout, utxo.Value, utxo.DerivationPath)
		selected = append(selected, utxo)
		totalSelected += utxo.Value
		if totalSelected >= totalAmount {
			break
		}
	}

	if totalSelected < totalAmount {
		return nil, 0, fmt.Errorf("insufficient funds: needed %d, got %d", totalAmount, totalSelected)
	}
	Logf("SelectUTXOsWithPaths: selected %d UTXOs, total %d", len(selected), totalSelected)
	return selected, totalSelected, nil
}

// parseUTXOsWithPathsJSON parses JSON array of UTXOs with paths from RN.
func parseUTXOsWithPathsJSON(jsonStr string) ([]UTXOWithPath, error) {
	if jsonStr == "" {
		return nil, fmt.Errorf("empty utxos JSON")
	}
	var raw []utxoWithPathJSON
	if err := json.Unmarshal([]byte(jsonStr), &raw); err != nil {
		return nil, fmt.Errorf("failed to parse utxos JSON: %w", err)
	}
	out := make([]UTXOWithPath, 0, len(raw))
	for _, u := range raw {
		out = append(out, u.toUTXOWithPath())
	}
	return out, nil
}

// mpcHook emits coarse-grained progress for React Native (TssHook).
// hookType: "btc_send" (build/sign send flow) or "psbt" (PSBT co-signing).
func mpcHook(hookType, info, session, utxo_session string, utxo_current, utxo_total int, done bool) {
	if hookType == "" {
		hookType = "btc_send"
	}
	hookData := fmt.Sprintf(
		`{ "time": %d, "type": "%s",  "info": "%s", "session": "%s", "utxo_session": "%s", "utxo_current": %d, "utxo_total": %d, "done": %t }`,
		int(time.Now().Unix()),
		hookType,
		info,
		session,
		utxo_session,
		utxo_current,
		utxo_total,
		done,
	)
	Hook(hookData)
}

func SpendingHash(senderAddress, receiverAddress string, amountSatoshi int64) (result string, err error) {
	defer RecoverAsError("SpendingHash", &err, &result)

	Logln("BBMTLog", "invoking SpendingHash...")

	// Fetch UTXOs (same as EstimateFees), but be conservative:
	// if there are no UTXOs or selection fails, return an empty hash instead
	// of treating it as a hard error. The caller already validates wallet
	// balance (potentially using HD/multi-path), so single-address insufficiency
	// here should not block UX.
	utxos, err := FetchUTXOs(senderAddress)
	if err != nil {
		Logf("SpendingHash: failed to fetch UTXOs for %s: %v", senderAddress, err)
		return "", nil
	}
	if len(utxos) == 0 {
		Logf("SpendingHash: no UTXOs for %s, returning empty hash", senderAddress)
		return "", nil
	}

	// Select UTXOs using the same strategy as EstimateFees
	selectedUTXOs, _, err := SelectUTXOs(utxos, amountSatoshi, "smallest")
	if err != nil {
		Logf("SpendingHash: SelectUTXOs error for %s amount=%d: %v", senderAddress, amountSatoshi, err)
		return "", nil
	}

	// Sort selected UTXOs deterministically by TxID, then Vout
	// This ensures the same hash is generated across devices for the same UTXOs
	sortedUTXOs := make([]UTXO, len(selectedUTXOs))
	copy(sortedUTXOs, selectedUTXOs)
	sort.Slice(sortedUTXOs, func(i, j int) bool {
		if sortedUTXOs[i].TxID != sortedUTXOs[j].TxID {
			return sortedUTXOs[i].TxID < sortedUTXOs[j].TxID
		}
		return sortedUTXOs[i].Vout < sortedUTXOs[j].Vout
	})

	// Create a deterministic string representation of all UTXOs
	// Format: "txid1:vout1,txid2:vout2,..."
	var utxoStrings []string
	for _, utxo := range sortedUTXOs {
		utxoStrings = append(utxoStrings, fmt.Sprintf("%s:%d", utxo.TxID, utxo.Vout))
	}
	utxoData := strings.Join(utxoStrings, ",")

	// Compute SHA256 hash
	hash := sha256.Sum256([]byte(utxoData))
	hashHex := hex.EncodeToString(hash[:])

	Logf("SpendingHash: selected %d UTXOs, hash: %s", len(sortedUTXOs), hashHex)
	return hashHex, nil
}

// SpendingHashWithUTXOs is the multi-path counterpart of SpendingHash.
// Instead of fetching UTXOs from a single address, it accepts a pre-fetched
// pool (JSON-encoded []utxoWithPathJSON) that covers all HD addresses.
// It selects UTXOs using the same "smallest-first" strategy and returns a
// deterministic SHA-256 hex over "txid:vout" pairs - identical across
// co-signing devices as long as they supply the same UTXO set.
func SpendingHashWithUTXOs(utxosWithPathsJSON, receiverAddress, amountSatoshiStr string) (result string, err error) {
	defer RecoverAsError("SpendingHashWithUTXOs", &err, &result)

	Logln("BBMTLog", "invoking SpendingHashWithUTXOs...")

	amountSatoshi, parseErr := strconv.ParseInt(amountSatoshiStr, 10, 64)
	if parseErr != nil {
		Logf("SpendingHashWithUTXOs: invalid amount %q: %v", amountSatoshiStr, parseErr)
		return "", fmt.Errorf("invalid amount: %w", parseErr)
	}

	utxos, err := parseUTXOsWithPathsJSON(utxosWithPathsJSON)
	if err != nil {
		Logf("SpendingHashWithUTXOs: failed to parse utxosWithPathsJSON: %v", err)
		return "", nil
	}
	if len(utxos) == 0 {
		Logf("SpendingHashWithUTXOs: no UTXOs provided, returning empty hash")
		return "", nil
	}

	selected, _, err := SelectUTXOsWithPaths(utxos, amountSatoshi, "smallest")
	if err != nil {
		Logf("SpendingHashWithUTXOs: SelectUTXOsWithPaths failed amount=%d: %v", amountSatoshi, err)
		return "", nil
	}

	// Sort selected UTXOs deterministically by TxID, then Vout
	sort.Slice(selected, func(i, j int) bool {
		if selected[i].TxID != selected[j].TxID {
			return selected[i].TxID < selected[j].TxID
		}
		return selected[i].Vout < selected[j].Vout
	})

	var utxoStrings []string
	for _, u := range selected {
		utxoStrings = append(utxoStrings, fmt.Sprintf("%s:%d", u.TxID, u.Vout))
	}
	utxoData := strings.Join(utxoStrings, ",")

	hash := sha256.Sum256([]byte(utxoData))
	hashHex := hex.EncodeToString(hash[:])

	Logf("SpendingHashWithUTXOs: selected %d UTXOs, hash: %s", len(selected), hashHex)
	return hashHex, nil
}

func EstimateFees(senderAddress, receiverAddress string, amountSatoshi int64) (result string, err error) {
	defer RecoverAsError("EstimateFees", &err, &result)

	Logln("BBMTLog", "invoking EstimateFees...")

	utxos, err := FetchUTXOs(senderAddress)
	if err != nil {
		return "", fmt.Errorf("failed to fetch UTXOs: %w", err)
	}

	// Check if we have any UTXOs
	if len(utxos) == 0 {
		Logf("No UTXOs found for address %s during fee estimation", senderAddress)
		return "", fmt.Errorf("no UTXOs available for address %s. Please ensure you have confirmed transactions before sending", senderAddress)
	}

	// Use iterative approach to match MpcSendBTC behavior:
	// MpcSendBTC selects UTXOs for amountSatoshi+estimatedFee, so we need to do the same
	// 1. First estimate: select UTXOs for amount only, calculate fee
	// 2. Second estimate: re-select UTXOs for amount+fee (matching actual send), re-calculate fee
	// This ensures we select the same UTXOs that will be used in the actual send

	// First iteration: select UTXOs for amount only
	selectedUTXOs, _, err := SelectUTXOs(utxos, amountSatoshi, "smallest")
	if err != nil {
		return "", err
	}

	// First fee estimate with UTXOs selected for amount only
	_fee, _err := calculateFees(senderAddress, selectedUTXOs, amountSatoshi, receiverAddress)
	if _err != nil {
		return "", _err
	}

	// Second iteration: re-select UTXOs for amount + fee (matching MpcSendBTC behavior)
	// This ensures the fee estimation uses the same UTXOs that will be used in actual send
	Logf("Re-selecting UTXOs for amount+fee (%d + %d = %d) to match MpcSendBTC behavior", amountSatoshi, _fee, amountSatoshi+_fee)
	selectedUTXOs, _, err = SelectUTXOs(utxos, amountSatoshi+_fee, "smallest")
	if err != nil {
		// If we can't select enough UTXOs for amount+fee, return the original fee estimate
		// This can happen if the wallet doesn't have enough funds
		Logf("Could not select UTXOs for amount+fee, using original estimate: %v", err)
		return strconv.FormatInt(_fee, 10), nil
	}

	// Re-calculate fee with the new UTXOs (which match what will be used in actual send)
	_fee, _err = calculateFees(senderAddress, selectedUTXOs, amountSatoshi, receiverAddress)
	if _err != nil {
		return "", _err
	}
	Logf("Final fee estimate with UTXOs selected for amount+fee: %d", _fee)

	return strconv.FormatInt(_fee, 10), nil
}

// EstimateFeeWithUTXOs estimates fees using a pre-fetched UTXO pool with paths (multi-path send).
// utxosWithPathsJSON: JSON array of {txid, vout, value, derivation_path or derivationPath}
// changeAddress: used for change output size estimation (e.g. next HD change address)
func EstimateFeeWithUTXOs(utxosWithPathsJSON, receiverAddress, amountSatoshiStr, changeAddress string) (result string, err error) {
	defer RecoverAsError("EstimateFeeWithUTXOs", &err, &result)

	Logln("BBMTLog", "invoking EstimateFeeWithUTXOs...")
	Logf("GoLog: EstimateFeeWithUTXOs input receiverAddress=%s amountSatoshi=%s changeAddress=%s", receiverAddress, amountSatoshiStr, changeAddress)
	Logf("GoLog: Current network: %s, API: %s", _btc_net, _api_url)

	amountSatoshi, parseErr := strconv.ParseInt(amountSatoshiStr, 10, 64)
	if parseErr != nil {
		Logf("GoLog: EstimateFeeWithUTXOs - invalid amount %q: %v", amountSatoshiStr, parseErr)
		return "", fmt.Errorf("invalid amount: %w", parseErr)
	}

	utxos, err := parseUTXOsWithPathsJSON(utxosWithPathsJSON)
	if err != nil {
		Logf("GoLog: EstimateFeeWithUTXOs - failed to parse utxosWithPathsJSON: %v", err)
		return "", err
	}
	if len(utxos) == 0 {
		Logf("GoLog: EstimateFeeWithUTXOs - utxosWithPathsJSON parsed but no UTXOs available")
		return "", fmt.Errorf("no UTXOs available. Please ensure you have confirmed transactions before sending")
	}

	// Use changeAddress for fee estimation (change output type)
	addrForFee := changeAddress
	if addrForFee == "" && len(utxos) > 0 {
		// Fallback: re-parse to get address from first item (parseUTXOsWithPathsJSON doesn't store it)
		var raw []utxoWithPathJSON
		if json.Unmarshal([]byte(utxosWithPathsJSON), &raw) == nil && len(raw) > 0 && raw[0].Address != "" {
			addrForFee = raw[0].Address
		}
	}
	if addrForFee == "" {
		Logf("GoLog: EstimateFeeWithUTXOs - missing changeAddress and unable to infer from utxosWithPathsJSON")
		return "", fmt.Errorf("changeAddress required for multi-path fee estimation")
	}

	Logf("GoLog: EstimateFeeWithUTXOs - using addrForFee=%s and %d candidate UTXOs", addrForFee, len(utxos))

	// First iteration: select for amount only
	selected, _, err := SelectUTXOsWithPaths(utxos, amountSatoshi, "smallest")
	if err != nil {
		Logf("GoLog: EstimateFeeWithUTXOs - failed SelectUTXOsWithPaths for amount=%d: %v", amountSatoshi, err)
		return "", err
	}
	selectedUTXOs := make([]UTXO, len(selected))
	for i := range selected {
		selectedUTXOs[i] = selected[i].UTXO
	}

	_fee, _err := calculateFees(addrForFee, selectedUTXOs, amountSatoshi, receiverAddress)
	if _err != nil {
		Logf("GoLog: EstimateFeeWithUTXOs - calculateFees (first pass) error: %v", _err)
		return "", _err
	}
	Logf("GoLog: EstimateFeeWithUTXOs - first pass fee=%d (amount=%d, selectedUTXOs=%d)", _fee, amountSatoshi, len(selectedUTXOs))

	// Second iteration: re-select for amount+fee
	selected, _, err = SelectUTXOsWithPaths(utxos, amountSatoshi+_fee, "smallest")
	if err != nil {
		Logf("GoLog: Could not select UTXOs for amount+fee=%d, using original estimate: %v", amountSatoshi+_fee, err)
		return strconv.FormatInt(_fee, 10), nil
	}
	selectedUTXOs = make([]UTXO, len(selected))
	for i := range selected {
		selectedUTXOs[i] = selected[i].UTXO
	}

	_fee, _err = calculateFees(addrForFee, selectedUTXOs, amountSatoshi, receiverAddress)
	if _err != nil {
		Logf("GoLog: EstimateFeeWithUTXOs - calculateFees (second pass) error: %v", _err)
		return "", _err
	}
	Logf("GoLog: EstimateFeeWithUTXOs: final fee %d (amount=%d, selectedUTXOs=%d)", _fee, amountSatoshi, len(selectedUTXOs))
	return strconv.FormatInt(_fee, 10), nil
}

func MpcSendBTC(
	/* tss */
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, derivePath,
	/* btc */
	publicKey, senderAddress, receiverAddress string, amountSatoshi, estimatedFee int64) (result string, err error) {
	defer RecoverAsError("MpcSendBTC", &err, &result)

	Logln("BBMTLog", "invoking MpcSendBTC...")

	params := &chaincfg.TestNet3Params
	if _btc_net == "mainnet" {
		params = &chaincfg.MainNetParams
		Logln("Using mainnet parameters")
		mpcHook("btc_send", "using mainnet", session, "", 0, 0, false)
	} else {
		Logln("Using testnet parameters")
		mpcHook("btc_send", "using testnet", session, "", 0, 0, false)
	}

	pubKeyBytes, err := hex.DecodeString(publicKey)
	if err != nil {
		Logf("Error decoding public key: %v", err)
		return "", fmt.Errorf("invalid public key format: %w", err)
	}
	Logln("Public key decoded successfully")

	fromAddr, err := btcutil.DecodeAddress(senderAddress, params)
	if err != nil {
		Logf("Error decoding sender address: %v", err)
		return "", fmt.Errorf("failed to decode sender address: %w", err)
	}
	Logln("Sender address decoded successfully")

	toAddr, err := btcutil.DecodeAddress(receiverAddress, params)
	mpcHook("btc_send", "checking receiver address", session, "", 0, 0, false)
	if err != nil {
		Logf("Error decoding receiver address: %v", err)
		return "", fmt.Errorf("failed to decode receiver address: %w", err)
	}

	Logf("Sender Address Type: %T", fromAddr)
	Logf("Receiver Address Type: %T", toAddr)

	mpcHook("btc_send", "fetching utxos", session, "", 0, 0, false)
	utxos, err := FetchUTXOs(senderAddress)
	if err != nil {
		Logf("Error fetching UTXOs: %v", err)
		return "", fmt.Errorf("failed to fetch UTXOs: %w", err)
	}
	Logf("Fetched UTXOs: %+v", utxos)

	// Check if we have any UTXOs
	if len(utxos) == 0 {
		Logf("No UTXOs found for address %s. This may be because:", senderAddress)
		Logf("1. The address has no confirmed transactions")
		Logf("2. All transactions are still pending (unconfirmed)")
		Logf("3. The address has been fully spent")
		return "", fmt.Errorf("no UTXOs available for address %s. Please ensure you have confirmed transactions before sending", senderAddress)
	}

	mpcHook("btc_send", "selecting utxos", session, "", 0, 0, false)
	selectedUTXOs, totalAmount, err := SelectUTXOs(utxos, amountSatoshi+estimatedFee, "smallest")
	if err != nil {
		Logf("Error selecting UTXOs: %v", err)
		// Provide more context in the error message
		totalAvailable := int64(0)
		for _, utxo := range utxos {
			totalAvailable += utxo.Value
		}
		return "", fmt.Errorf("insufficient funds: needed %d (amount: %d + fee: %d), available: %d. Note: Only confirmed UTXOs are available for spending", amountSatoshi+estimatedFee, amountSatoshi, estimatedFee, totalAvailable)
	}
	Logf("Selected UTXOs: %+v, Total Amount: %d", selectedUTXOs, totalAmount)

	// Create new transaction
	tx := wire.NewMsgTx(wire.TxVersion)
	Logln("New transaction created")

	// Add all inputs with RBF enabled (nSequence = 0xfffffffd)
	utxoCount := len(selectedUTXOs)
	utxoIndex := 0
	utxoSession := ""

	mpcHook("btc_send", "adding inputs", session, utxoSession, utxoIndex, utxoCount, false)
	for _, utxo := range selectedUTXOs {
		hash, err := chainhash.NewHashFromStr(utxo.TxID)
		if err != nil {
			Logf("Error parsing UTXO TxID %s: %v", utxo.TxID, err)
			return "", fmt.Errorf("invalid UTXO transaction ID %s: %w", utxo.TxID, err)
		}
		outPoint := wire.NewOutPoint(hash, utxo.Vout)
		// Create input with RBF enabled (nSequence = 0xfffffffd)
		txIn := wire.NewTxIn(outPoint, nil, nil)
		txIn.Sequence = 0xfffffffd // Enable RBF
		tx.AddTxIn(txIn)
		Logf("Added UTXO to transaction with RBF enabled: %+v", utxo)
	}

	Logf("Estimated Fee: %d", estimatedFee)
	if totalAmount < amountSatoshi+estimatedFee {
		Logf("Insufficient funds: available %d, needed %d", totalAmount, amountSatoshi+estimatedFee)
		return "", fmt.Errorf("insufficient funds: available %d, needed %d", totalAmount, amountSatoshi+estimatedFee)
	}
	Logln("Sufficient funds available")

	// Add recipient output
	mpcHook("btc_send", "creating output script", session, utxoSession, utxoIndex, utxoCount, false)
	pkScript, err := txscript.PayToAddrScript(toAddr)
	if err != nil {
		Logf("Error creating output script: %v", err)
		return "", fmt.Errorf("failed to create output script: %w", err)
	}
	tx.AddTxOut(wire.NewTxOut(amountSatoshi, pkScript))
	Logf("Added recipient output: %d satoshis to %s", amountSatoshi, receiverAddress)

	// Add change output if necessary
	changeAmount := totalAmount - amountSatoshi - estimatedFee
	mpcHook("btc_send", "calculating change amount", session, utxoSession, utxoIndex, utxoCount, false)

	if changeAmount > 546 {
		changePkScript, err := txscript.PayToAddrScript(fromAddr)
		if err != nil {
			Logf("Error creating change script: %v", err)
			return "", fmt.Errorf("failed to create change script: %w", err)
		}
		tx.AddTxOut(wire.NewTxOut(changeAmount, changePkScript))
		Logf("Added change output: %d satoshis to %s", changeAmount, senderAddress)
	}

	// Create prevOutFetcher for all inputs (needed for SegWit)
	prevOuts := make(map[wire.OutPoint]*wire.TxOut)
	for i, utxo := range selectedUTXOs {
		txOut, _, err := FetchUTXODetails(utxo.TxID, utxo.Vout)
		if err != nil {
			return "", fmt.Errorf("failed to fetch UTXO details for input %d: %w", i, err)
		}
		hash, err := chainhash.NewHashFromStr(utxo.TxID)
		if err != nil {
			Logf("Error parsing UTXO TxID %s: %v", utxo.TxID, err)
			return "", fmt.Errorf("invalid UTXO transaction ID %s for input %d: %w", utxo.TxID, i, err)
		}
		outPoint := wire.OutPoint{Hash: *hash, Index: utxo.Vout}
		prevOuts[outPoint] = txOut
	}
	prevOutFetcher := txscript.NewMultiPrevOutFetcher(prevOuts)

	// Sign each input with enhanced address type support
	mpcHook("btc_send", "signing inputs", session, utxoSession, utxoIndex, utxoCount, false)
	for i, utxo := range selectedUTXOs {
		// update utxo session - counter
		utxoIndex = i + 1
		utxoSession = fmt.Sprintf("%s%d", session, i)

		mpcHook("btc_send", "fetching utxo details", session, utxoSession, utxoIndex, utxoCount, false)
		txOut, isWitness, err := FetchUTXODetails(utxo.TxID, utxo.Vout)
		if err != nil {
			Logf("Error fetching UTXO details: %v", err)
			return "", fmt.Errorf("failed to fetch UTXO details: %w", err)
		}

		var sigHash []byte
		hashCache := txscript.NewTxSigHashes(tx, prevOutFetcher)

		// Determine the script type and signing method
		if isWitness {
			// Handle different SegWit types
			if txscript.IsPayToWitnessPubKeyHash(txOut.PkScript) {
				// P2WPKH (Native SegWit)
				Logf("Processing P2WPKH input for index: %d", i)
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
				if err != nil {
					Logf("Error calculating P2WPKH witness sighash: %v", err)
					return "", fmt.Errorf("failed to calculate P2WPKH witness sighash: %w", err)
				}

				// Sign the hash
				sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
				mpcHook("btc_send", "joining keysign - P2WPKH", session, utxoSession, utxoIndex, utxoCount, false)
				sigJSON, err := DispatchJoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
				if err != nil {
					return "", fmt.Errorf("failed to sign P2WPKH transaction: %w", err)
				}
				if sigJSON == "" {
					return "", fmt.Errorf("failed to sign P2WPKH transaction: signature is empty")
				}

				var sig KeysignResponse
				if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
					return "", fmt.Errorf("failed to parse P2WPKH signature response: %w", err)
				}

				signature, err := hex.DecodeString(sig.DerSignature)
				if err != nil {
					return "", fmt.Errorf("failed to decode P2WPKH DER signature: %w", err)
				}

				signatureWithHashType := append(signature, byte(txscript.SigHashAll))
				tx.TxIn[i].Witness = wire.TxWitness{signatureWithHashType, pubKeyBytes}
				tx.TxIn[i].SignatureScript = nil
				Logf("P2WPKH witness set for input %d", i)

			} else if txscript.IsPayToTaproot(txOut.PkScript) {
				Logf("Taproot detected but not supported due to lack of Schnorr support in BNB-TSS.")
				return "", fmt.Errorf("taproot (P2TR) inputs are not supported for now")
			} else {
				// Generic SegWit handling (P2WSH, etc.)
				Logf("Processing generic SegWit input for index: %d", i)
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
				if err != nil {
					Logf("Error calculating generic witness sighash: %v", err)
					return "", fmt.Errorf("failed to calculate generic witness sighash: %w", err)
				}

				sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
				mpcHook("btc_send", "joining keysign - generic SegWit", session, utxoSession, utxoIndex, utxoCount, false)
				sigJSON, err := DispatchJoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
				if err != nil {
					return "", fmt.Errorf("failed to sign generic SegWit transaction: %w", err)
				}
				if sigJSON == "" {
					return "", fmt.Errorf("failed to sign generic SegWit transaction: signature is empty")
				}

				var sig KeysignResponse
				if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
					return "", fmt.Errorf("failed to parse generic SegWit signature response: %w", err)
				}

				signature, err := hex.DecodeString(sig.DerSignature)
				if err != nil {
					return "", fmt.Errorf("failed to decode generic SegWit DER signature: %w", err)
				}

				signatureWithHashType := append(signature, byte(txscript.SigHashAll))
				tx.TxIn[i].Witness = wire.TxWitness{signatureWithHashType, pubKeyBytes}
				tx.TxIn[i].SignatureScript = nil
				Logf("Generic SegWit witness set for input %d", i)
			}

		} else {
			// Handle non-SegWit types
			if txscript.IsPayToPubKeyHash(txOut.PkScript) {
				// P2PKH (Legacy)
				Logf("Processing P2PKH input for index: %d", i)
				sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
				if err != nil {
					Logf("Error calculating P2PKH sighash: %v", err)
					return "", fmt.Errorf("failed to calculate P2PKH sighash: %w", err)
				}

				sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
				mpcHook("btc_send", "joining keysign - P2PKH", session, utxoSession, utxoIndex, utxoCount, false)
				sigJSON, err := DispatchJoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
				if err != nil {
					return "", fmt.Errorf("failed to sign P2PKH transaction: %w", err)
				}
				if sigJSON == "" {
					return "", fmt.Errorf("failed to sign P2PKH transaction: signature is empty")
				}

				var sig KeysignResponse
				if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
					return "", fmt.Errorf("failed to parse P2PKH signature response: %w", err)
				}

				signature, err := hex.DecodeString(sig.DerSignature)
				if err != nil {
					return "", fmt.Errorf("failed to decode P2PKH DER signature: %w", err)
				}

				signatureWithHashType := append(signature, byte(txscript.SigHashAll))
				builder := txscript.NewScriptBuilder()
				builder.AddData(signatureWithHashType)
				builder.AddData(pubKeyBytes)
				scriptSig, err := builder.Script()
				if err != nil {
					Logf("Error building P2PKH scriptSig: %v", err)
					return "", fmt.Errorf("failed to build P2PKH scriptSig: %w", err)
				}
				tx.TxIn[i].SignatureScript = scriptSig
				tx.TxIn[i].Witness = nil
				Logf("P2PKH SignatureScript set for input %d", i)

			} else if txscript.IsPayToScriptHash(txOut.PkScript) {
				// P2SH - need to determine if it's P2SH-P2WPKH or regular P2SH
				Logf("Processing P2SH input for index: %d", i)

				// For P2SH-P2WPKH, we need to construct the correct redeem script
				// The redeem script for P2SH-P2WPKH is a witness program: OP_0 <20-byte-pubkey-hash>
				pubKeyHash := btcutil.Hash160(pubKeyBytes)

				// Create the witness program (redeem script for P2SH-P2WPKH)
				redeemScript := make([]byte, 22)
				redeemScript[0] = 0x00 // OP_0
				redeemScript[1] = 0x14 // Push 20 bytes
				copy(redeemScript[2:], pubKeyHash)

				// Verify this is actually P2SH-P2WPKH by checking if the scriptHash matches
				scriptHash := btcutil.Hash160(redeemScript)
				expectedP2SHScript := make([]byte, 23)
				expectedP2SHScript[0] = 0xa9 // OP_HASH160
				expectedP2SHScript[1] = 0x14 // Push 20 bytes
				copy(expectedP2SHScript[2:22], scriptHash)
				expectedP2SHScript[22] = 0x87 // OP_EQUAL

				if bytes.Equal(txOut.PkScript, expectedP2SHScript) {
					// This is P2SH-P2WPKH
					Logf("Confirmed P2SH-P2WPKH for input %d", i)
					Logf("txOut.PkScript: %x", txOut.PkScript)
					Logf("redeemScript: %x (length: %d)", redeemScript, len(redeemScript))
					Logf("expectedP2SHScript: %x", expectedP2SHScript)

					// Verify redeem script hash
					scriptHash := btcutil.Hash160(redeemScript)
					if len(txOut.PkScript) != 23 || txOut.PkScript[0] != 0xa9 || txOut.PkScript[22] != 0x87 {
						return "", fmt.Errorf("txOut.PkScript is not a valid P2SH script: %x", txOut.PkScript)
					}
					if !bytes.Equal(scriptHash, txOut.PkScript[2:22]) {
						return "", fmt.Errorf("redeemScript hash %x does not match P2SH script hash %x", scriptHash, txOut.PkScript[2:22])
					}

					// Calculate witness sighash using the witness program as the script
					sigHash, err = txscript.CalcWitnessSigHash(redeemScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
					if err != nil {
						Logf("Error calculating P2SH-P2WPKH witness sighash: %v", err)
						return "", fmt.Errorf("failed to calculate P2SH-P2WPKH witness sighash: %w", err)
					}

					sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
					Logf("P2SH-P2WPKH sighash: %s", sighashBase64)
					mpcHook("btc_send", "joining keysign - P2SH-P2WPKH", session, utxoSession, utxoIndex, utxoCount, false)
					sigJSON, err := DispatchJoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
					if err != nil {
						return "", fmt.Errorf("failed to sign P2SH-P2WPKH transaction: %w", err)
					}
					if sigJSON == "" {
						return "", fmt.Errorf("failed to sign P2SH-P2WPKH transaction: signature is empty")
					}

					var sig KeysignResponse
					if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
						return "", fmt.Errorf("failed to parse P2SH-P2WPKH signature response: %w", err)
					}

					signature, err := hex.DecodeString(sig.DerSignature)
					if err != nil {
						return "", fmt.Errorf("failed to decode P2SH-P2WPKH DER signature: %w", err)
					}

					signatureWithHashType := append(signature, byte(txscript.SigHashAll))

					// Set SignatureScript and Witness
					// For P2SH-P2WPKH, the SignatureScript must be a canonical push of the redeemScript
					// Manually construct the canonical push of the redeem script
					if len(redeemScript) != 22 { // Sanity check for P2SH-P2WPKH redeem script
						Logf("Error: P2SH-P2WPKH redeemScript has unexpected length: %d", len(redeemScript))
						return "", fmt.Errorf("internal error: P2SH-P2WPKH redeemScript has unexpected length %d", len(redeemScript))
					}

					// Create a canonical push of the redeemScript
					builder := txscript.NewScriptBuilder()
					builder.AddData(redeemScript)
					canonicalRedeemScriptPush, err := builder.Script()
					if err != nil {
						Logf("Error building canonical P2SH-P2WPKH scriptSig: %v", err)
						return "", fmt.Errorf("failed to build canonical P2SH-P2WPKH scriptSig: %w", err)
					}

					tx.TxIn[i].SignatureScript = canonicalRedeemScriptPush
					tx.TxIn[i].Witness = wire.TxWitness{signatureWithHashType, pubKeyBytes}
					Logf("P2SH-P2WPKH: SignatureScript: %x (length: %d), Witness: %x (items: %d)",
						tx.TxIn[i].SignatureScript, len(tx.TxIn[i].SignatureScript),
						tx.TxIn[i].Witness, len(tx.TxIn[i].Witness))
				} else {
					// This is regular P2SH (not P2SH-P2WPKH)
					Logf("Processing regular P2SH for input %d", i)
					sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
					if err != nil {
						return "", fmt.Errorf("failed to calculate P2SH sighash: %w", err)
					}

					sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
					mpcHook("btc_send", "joining keysign - P2SH", session, utxoSession, utxoIndex, utxoCount, false)
					sigJSON, err := DispatchJoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
					if err != nil {
						return "", fmt.Errorf("failed to sign P2SH transaction: %w", err)
					}
					if sigJSON == "" {
						return "", fmt.Errorf("failed to sign P2SH transaction: signature is empty")
					}

					var sig KeysignResponse
					if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
						return "", fmt.Errorf("failed to parse P2SH signature response: %w", err)
					}

					signature, err := hex.DecodeString(sig.DerSignature)
					if err != nil {
						return "", fmt.Errorf("failed to decode P2SH DER signature: %w", err)
					}

					signatureWithHashType := append(signature, byte(txscript.SigHashAll))

					// For regular P2SH, build the scriptSig with signature + pubkey + redeem script
					builder := txscript.NewScriptBuilder()
					builder.AddData(signatureWithHashType)
					builder.AddData(pubKeyBytes)
					// Note: For a complete P2SH implementation, you'd need the actual redeem script here
					// This is simplified for P2PKH-like redeem scripts
					scriptSig, err := builder.Script()
					if err != nil {
						return "", fmt.Errorf("failed to build P2SH scriptSig: %w", err)
					}
					tx.TxIn[i].SignatureScript = scriptSig
					tx.TxIn[i].Witness = nil
					Logf("Regular P2SH SignatureScript set for input %d", i)
				}
			} else {
				// Unknown script type
				return "", fmt.Errorf("unsupported script type for input %d", i)
			}
		}

		// FIXED: Script validation with proper prevOutFetcher
		mpcHook("btc_send", "validating tx script", session, utxoSession, utxoIndex, utxoCount, false)
		vm, err := txscript.NewEngine(
			txOut.PkScript,
			tx,
			i,
			txscript.StandardVerifyFlags,
			nil,
			hashCache,
			txOut.Value,
			prevOutFetcher, // Use the proper prevOutFetcher
		)
		if err != nil {
			Logf("Error creating script engine for input %d: %v", i, err)
			return "", fmt.Errorf("failed to create script engine for input %d: %w", i, err)
		}
		if err := vm.Execute(); err != nil {
			Logf("Script validation failed for input %d: %v", i, err)
			return "", fmt.Errorf("script validation failed for input %d: %w", i, err)
		}
		Logf("Script validation succeeded for input %d", i)
	}

	// Serialize and broadcast
	mpcHook("btc_send", "serializing tx", session, utxoSession, utxoIndex, utxoCount, false)
	var signedTx bytes.Buffer
	if err := tx.Serialize(&signedTx); err != nil {
		Logf("Error serializing transaction: %v", err)
		return "", fmt.Errorf("failed to serialize transaction: %w", err)
	}

	rawTx := hex.EncodeToString(signedTx.Bytes())
	Logln("Raw Transaction (signed, not broadcast)")
	mpcHook("btc_send", "signed", session, utxoSession, utxoIndex, utxoCount, true)
	return rawTx, nil
}

// MpcSendBTCWithUTXOs is the multi-path variant: uses pre-fetched UTXOs with per-input derivation paths.
// utxosWithPathsJSON: JSON array of {txid, vout, value, derivation_path or derivationPath}
// changeAddress: HD change address for change output (required)
func MpcSendBTCWithUTXOs(
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare string,
	publicKey, receiverAddress, amountSatoshiStr, estimatedFeeStr, utxosWithPathsJSON, changeAddress string,
) (result string, err error) {
	defer RecoverAsError("MpcSendBTCWithUTXOs", &err, &result)

	amountSatoshi, parseErr := strconv.ParseInt(amountSatoshiStr, 10, 64)
	if parseErr != nil {
		return "", fmt.Errorf("invalid amountSatoshi %q: %w", amountSatoshiStr, parseErr)
	}
	estimatedFee, parseErr := strconv.ParseInt(estimatedFeeStr, 10, 64)
	if parseErr != nil {
		return "", fmt.Errorf("invalid estimatedFee %q: %w", estimatedFeeStr, parseErr)
	}

	utxos, err := parseUTXOsWithPathsJSON(utxosWithPathsJSON)
	if err != nil {
		return "", err
	}
	if len(utxos) == 0 {
		return "", fmt.Errorf("no UTXOs available. Please ensure you have confirmed transactions before sending")
	}

	var ks struct {
		PubKey       string `json:"pub_key"`
		ChainCodeHex string `json:"chain_code_hex"`
	}
	if err := json.Unmarshal([]byte(keyshare), &ks); err != nil || ks.PubKey == "" || ks.ChainCodeHex == "" {
		return "", fmt.Errorf("invalid keyshare: need pub_key and chain_code_hex")
	}

	selectedUTXOs, totalAmount, err := SelectUTXOsWithPaths(utxos, amountSatoshi+estimatedFee, "smallest")
	if err != nil {
		return "", err
	}

	params := &chaincfg.TestNet3Params
	if _btc_net == "mainnet" {
		params = &chaincfg.MainNetParams
	}
	toAddr, err := btcutil.DecodeAddress(receiverAddress, params)
	if err != nil {
		return "", fmt.Errorf("failed to decode receiver address: %w", err)
	}
	changeAddr, err := btcutil.DecodeAddress(changeAddress, params)
	if err != nil {
		return "", fmt.Errorf("failed to decode change address: %w", err)
	}

	tx := wire.NewMsgTx(wire.TxVersion)
	for _, utxo := range selectedUTXOs {
		hash, err := chainhash.NewHashFromStr(utxo.TxID)
		if err != nil {
			return "", fmt.Errorf("invalid UTXO TxID %s: %w", utxo.TxID, err)
		}
		txIn := wire.NewTxIn(wire.NewOutPoint(hash, utxo.Vout), nil, nil)
		txIn.Sequence = 0xfffffffd
		tx.AddTxIn(txIn)
	}

	if totalAmount < amountSatoshi+estimatedFee {
		return "", fmt.Errorf("insufficient funds: available %d, needed %d", totalAmount, amountSatoshi+estimatedFee)
	}

	pkScript, _ := txscript.PayToAddrScript(toAddr)
	tx.AddTxOut(wire.NewTxOut(amountSatoshi, pkScript))

	changeAmount := totalAmount - amountSatoshi - estimatedFee
	if changeAmount > 546 {
		changePkScript, _ := txscript.PayToAddrScript(changeAddr)
		tx.AddTxOut(wire.NewTxOut(changeAmount, changePkScript))
	}

	// Build prevOuts map from inline scriptpubkey (no network call).
	// Falls back to FetchUTXODetails only when scriptpubkey was not supplied by the caller.
	prevOuts := make(map[wire.OutPoint]*wire.TxOut)
	for _, utxo := range selectedUTXOs {
		var txOut *wire.TxOut
		if utxo.Scriptpubkey != "" {
			sb, spkErr := hex.DecodeString(utxo.Scriptpubkey)
			if spkErr != nil || len(sb) == 0 {
				return "", fmt.Errorf("invalid scriptpubkey for %s:%d", utxo.TxID, utxo.Vout)
			}
			txOut = &wire.TxOut{PkScript: sb, Value: utxo.Value}
		} else {
			var fetchErr error
			txOut, _, fetchErr = FetchUTXODetails(utxo.TxID, utxo.Vout)
			if fetchErr != nil {
				return "", fmt.Errorf("failed to fetch UTXO details for %s:%d: %w", utxo.TxID, utxo.Vout, fetchErr)
			}
		}
		hash, _ := chainhash.NewHashFromStr(utxo.TxID)
		prevOuts[wire.OutPoint{Hash: *hash, Index: utxo.Vout}] = txOut
	}
	prevOutFetcher := txscript.NewMultiPrevOutFetcher(prevOuts)

	utxoCount := len(selectedUTXOs)
	for i, utxo := range selectedUTXOs {
		derivePath := utxo.DerivationPath
		if derivePath == "" {
			return "", fmt.Errorf("UTXO %d missing derivation path", i)
		}
		derivedPubHex, err := GetDerivedPubKey(ks.PubKey, ks.ChainCodeHex, derivePath, false)
		if err != nil {
			return "", fmt.Errorf("failed to derive pubkey for input %d: %w", i, err)
		}
		pubKeyBytes, err := hex.DecodeString(derivedPubHex)
		if err != nil {
			return "", fmt.Errorf("invalid derived pubkey for input %d: %w", i, err)
		}

		utxoSession := fmt.Sprintf("%s%d", session, i)
		// Re-use the already-resolved prevout (no second network call per input).
		outpointHash, _ := chainhash.NewHashFromStr(utxo.TxID)
		txOut := prevOuts[wire.OutPoint{Hash: *outpointHash, Index: utxo.Vout}]
		isWitness := txscript.IsWitnessProgram(txOut.PkScript)
		hashCache := txscript.NewTxSigHashes(tx, prevOutFetcher)

		var sigHash []byte
		var isP2SHP2WPKH bool
		if isWitness {
			if txscript.IsPayToWitnessPubKeyHash(txOut.PkScript) {
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
			} else if txscript.IsPayToTaproot(txOut.PkScript) {
				return "", fmt.Errorf("taproot (P2TR) inputs are not supported")
			} else {
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
			}
		} else {
			if txscript.IsPayToPubKeyHash(txOut.PkScript) {
				sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
			} else if txscript.IsPayToScriptHash(txOut.PkScript) {
				pubKeyHash := btcutil.Hash160(pubKeyBytes)
				redeemScript := make([]byte, 22)
				redeemScript[0], redeemScript[1] = 0x00, 0x14
				copy(redeemScript[2:], pubKeyHash)
				scriptHash := btcutil.Hash160(redeemScript)
				expectedP2SH := make([]byte, 23)
				expectedP2SH[0], expectedP2SH[1], expectedP2SH[22] = 0xa9, 0x14, 0x87
				copy(expectedP2SH[2:22], scriptHash)
				if bytes.Equal(txOut.PkScript, expectedP2SH) {
					isP2SHP2WPKH = true
					sigHash, err = txscript.CalcWitnessSigHash(redeemScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
				} else {
					sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
				}
			} else {
				sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
			}
		}
		if err != nil {
			return "", fmt.Errorf("failed to calc sighash for input %d: %w", i, err)
		}

		sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
		mpcHook("btc_send", "joining keysign", session, utxoSession, i+1, utxoCount, false)
		sigJSON, err := DispatchJoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
		if err != nil {
			return "", fmt.Errorf("failed to sign input %d: %w", i, err)
		}
		var sig KeysignResponse
		if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
			return "", fmt.Errorf("failed to parse signature for input %d: %w", i, err)
		}
		signature, err := hex.DecodeString(sig.DerSignature)
		if err != nil {
			return "", fmt.Errorf("failed to decode signature for input %d: %w", i, err)
		}
		sigWithHashType := append(signature, byte(txscript.SigHashAll))

		if isWitness {
			tx.TxIn[i].Witness = wire.TxWitness{sigWithHashType, pubKeyBytes}
			tx.TxIn[i].SignatureScript = nil
		} else if isP2SHP2WPKH {
			redeemScript := make([]byte, 22)
			redeemScript[0], redeemScript[1] = 0x00, 0x14
			copy(redeemScript[2:], btcutil.Hash160(pubKeyBytes))
			builder := txscript.NewScriptBuilder()
			builder.AddData(redeemScript)
			canonical, _ := builder.Script()
			tx.TxIn[i].SignatureScript = canonical
			tx.TxIn[i].Witness = wire.TxWitness{sigWithHashType, pubKeyBytes}
		} else {
			builder := txscript.NewScriptBuilder()
			builder.AddData(sigWithHashType)
			builder.AddData(pubKeyBytes)
			scriptSig, _ := builder.Script()
			tx.TxIn[i].SignatureScript = scriptSig
			tx.TxIn[i].Witness = nil
		}

		vm, err := txscript.NewEngine(txOut.PkScript, tx, i, txscript.StandardVerifyFlags, nil, hashCache, txOut.Value, prevOutFetcher)
		if err != nil {
			return "", fmt.Errorf("script engine for input %d: %w", i, err)
		}
		if err := vm.Execute(); err != nil {
			return "", fmt.Errorf("script validation failed for input %d: %w", i, err)
		}
	}

	var signedTx bytes.Buffer
	if err := tx.Serialize(&signedTx); err != nil {
		return "", fmt.Errorf("failed to serialize transaction: %w", err)
	}
	rawTx := hex.EncodeToString(signedTx.Bytes())
	Logln("Raw Transaction (signed, not broadcast)")
	mpcHook("btc_send", "signed", session, "", utxoCount, utxoCount, true)
	return rawTx, nil
}

func calculateFees(senderAddress string, utxos []UTXO, satoshiAmount int64, receiverAddress string) (int64, error) {
	params := &chaincfg.TestNet3Params
	if _btc_net == "mainnet" {
		params = &chaincfg.MainNetParams
		Logln("Using MainNet parameters")
	} else {
		Logln("Using TestNet3 parameters")
	}

	// Decode addresses
	fromAddr, err := btcutil.DecodeAddress(senderAddress, params)
	if err != nil {
		return 0, fmt.Errorf("failed to decode sender address: %w", err)
	}
	Logf("Sender Address Decoded: %s, Type: %T", senderAddress, fromAddr)

	toAddr, err := btcutil.DecodeAddress(receiverAddress, params)
	if err != nil {
		return 0, fmt.Errorf("failed to decode receiver address: %w", err)
	}
	Logf("Receiver Address Decoded: %s, Type: %T", receiverAddress, toAddr)

	// Fetch fee rate (sat/vB)
	feeRate, err := RecommendedFees(_fee_set)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch fee rate: %w", err)
	}
	Logf("Fee Rate for %s: %d sat/vB", _fee_set, feeRate)

	// Calculate total input value
	totalInputValue := int64(0)
	for _, utxo := range utxos {
		totalInputValue += utxo.Value
	}
	Logf("Total input value: %d satoshis", totalInputValue)

	// Initial transaction size estimation (in weight units for SegWit compatibility)
	baseWeight := 40 // 4 bytes version + 1 byte input count + 1 byte output count + 4 bytes locktime = 10 bytes * 4 weight units
	hasSegWit := false
	inputCount := len(utxos)
	if inputCount > 252 { // VarInt adjustment
		baseWeight += 8 // Larger VarInt for input count
	}

	// Estimate input sizes
	for i, utxo := range utxos {
		txOut, isWitness, err := FetchUTXODetails(utxo.TxID, utxo.Vout)
		if err != nil {
			return 0, fmt.Errorf("failed to fetch UTXO details for %s:%d: %w", utxo.TxID, utxo.Vout, err)
		}
		Logf("UTXO %d: TXID %s, Vout %d, IsWitness: %v", i, utxo.TxID, utxo.Vout, isWitness)

		if isWitness {
			hasSegWit = true
			if txscript.IsPayToWitnessPubKeyHash(txOut.PkScript) { // P2WPKH
				baseWeight += 272 // 68 bytes * 4 (non-witness) + 105 bytes / 4 (witness) ≈ 68 vbytes
				Logf("UTXO %d is P2WPKH: Added 68 vbytes", i)
			} else if txscript.IsPayToTaproot(txOut.PkScript) { // P2TR
				baseWeight += 230 // 57.5 vbytes: 43 bytes * 4 + 65 bytes / 4
				Logf("UTXO %d is P2TR: Added 57.5 vbytes", i)
			} else { // P2WSH or other SegWit
				baseWeight += 300 // Estimate: ~75 vbytes, conservative for P2WSH
				Logf("UTXO %d is other SegWit type: Added 75 vbytes", i)
			}
		} else {
			if txscript.IsPayToPubKeyHash(txOut.PkScript) { // P2PKH
				baseWeight += 592 // 148 bytes * 4 = 148 vbytes
				Logf("UTXO %d is P2PKH: Added 148 vbytes", i)
			} else if txscript.IsPayToScriptHash(txOut.PkScript) { // P2SH
				baseWeight += 720 // ~180 bytes * 4, varies with redeem script
				Logf("UTXO %d is P2SH: Added 180 vbytes", i)
			} else { // P2MS or other
				baseWeight += 720 // Conservative estimate
				Logf("UTXO %d assumed P2MS: Added 180 vbytes", i)
			}
		}
	}

	// Add SegWit marker and flag (2 bytes, only if SegWit inputs exist)
	if hasSegWit {
		baseWeight += 8 // 2 bytes * 4 weight units
		Logf("Added SegWit marker and flag: 2 vbytes")
	}

	// Recipient output size
	outputCount := 1 // Start with receiver output
	switch toAddr.(type) {
	case *btcutil.AddressPubKeyHash: // P2PKH
		baseWeight += 136 // 34 bytes * 4 = 34 vbytes
		Logln("Receiver is P2PKH: Added 34 vbytes")
	case *btcutil.AddressScriptHash: // P2SH
		baseWeight += 128 // 32 bytes * 4 = 32 vbytes
		Logln("Receiver is P2SH: Added 32 vbytes")
	case *btcutil.AddressWitnessPubKeyHash: // P2WPKH
		baseWeight += 124 // 31 bytes * 4 = 31 vbytes
		Logln("Receiver is P2WPKH: Added 31 vbytes")
	case *btcutil.AddressWitnessScriptHash: // P2WSH
		baseWeight += 172 // 43 bytes * 4 = 43 vbytes
		Logln("Receiver is P2WSH: Added 43 vbytes")
	case *btcutil.AddressTaproot: // P2TR
		baseWeight += 136 // 34 bytes * 4 = 34 vbytes
		Logln("Receiver is P2TR: Added 34 vbytes")
	default:
		return 0, fmt.Errorf("unsupported receiver address type: %T", toAddr)
	}

	// Initial fee estimate
	vbytes := baseWeight / 4
	if baseWeight%4 != 0 {
		vbytes++ // Round up
	}
	estimatedFee := int64(vbytes) * int64(feeRate)
	Logf("Initial estimated size: %d vbytes, Fee: %d satoshis", vbytes, estimatedFee)

	// Check for change output
	changeAmount := totalInputValue - satoshiAmount - estimatedFee
	if changeAmount > 546 { // Dust threshold
		outputCount++
		switch fromAddr.(type) {
		case *btcutil.AddressPubKeyHash: // P2PKH
			baseWeight += 136 // 34 bytes * 4
			Logln("Change is P2PKH: Added 34 vbytes")
		case *btcutil.AddressScriptHash: // P2SH
			baseWeight += 128 // 32 bytes * 4
			Logln("Change is P2SH: Added 32 vbytes")
		case *btcutil.AddressWitnessPubKeyHash: // P2WPKH
			baseWeight += 124 // 31 bytes * 4
			Logln("Change is P2WPKH: Added 31 vbytes")
		case *btcutil.AddressWitnessScriptHash: // P2WSH
			baseWeight += 172 // 43 bytes * 4
			Logln("Change is P2WSH: Added 43 vbytes")
		case *btcutil.AddressTaproot: // P2TR
			baseWeight += 136 // 34 bytes * 4
			Logln("Change is P2TR: Added 34 vbytes")
		default:
			return 0, fmt.Errorf("unsupported sender address type: %T", fromAddr)
		}
		// Recalculate with change output
		vbytes = baseWeight / 4
		if baseWeight%4 != 0 {
			vbytes++
		}
		if outputCount > 252 {
			baseWeight += 8 // Adjust VarInt for output count
			vbytes = baseWeight / 4
			if baseWeight%4 != 0 {
				vbytes++
			}
		}
		estimatedFee = int64(vbytes) * int64(feeRate)
		Logf("Added change output, new size: %d vbytes, Fee: %d satoshis", vbytes, estimatedFee)
	}

	// Ensure minimum fee (1 sat/vB)
	if estimatedFee < int64(vbytes) {
		estimatedFee = int64(vbytes)
		Logf("Adjusted to minimum fee: %d satoshis (1 sat/vB)", estimatedFee)
	}

	Logf("Final estimated transaction size: %d vbytes, Fee: %d satoshis", vbytes, estimatedFee)
	return estimatedFee, nil
}

func SecP256k1Recover(r, s, v, h string) (result string, err error) {
	defer RecoverAsError("SecP256k1Recover", &err, &result)

	// Decode r, s into bytes
	rBytes := hexToBytes(r)
	sBytes := hexToBytes(s)
	vByte := hexToBytes(v)
	// normalize recovery
	recoveryID := vByte[0]
	if recoveryID < 27 {
		recoveryID += 27
	}
	msgHash := hexToBytes(h)
	if len(msgHash) != 32 {
		return "", errors.New("invalid message hash length")
	}
	// build sig: https://github.com/decred/dcrd/blob/08d8572807872f2b9737f8a118b16c320a04b077/dcrec/secp256k1/ecdsa/signature.go#L860
	signature := make([]byte, 65)
	copy(signature[1:33], rBytes)
	copy(signature[33:65], sBytes)
	signature[0] = recoveryID

	pubKey, _, err := mecdsa.RecoverCompact(signature, msgHash)
	if err != nil {
		return "", err
	}

	return hex.EncodeToString(pubKey.SerializeCompressed()), nil
}

func PubToP2KH(pubKeyCompressed, mainnetORtestnet3 string) (result string, err error) {
	defer RecoverAsError("PubToP2KH", &err, &result)

	// Decode the hex string to bytes
	pubKeyBytes, err := hex.DecodeString(pubKeyCompressed)
	if err != nil {
		return "", fmt.Errorf("failed to decode public key: %w", err)
	}

	// Ensure the public key is in the correct format
	if len(pubKeyBytes) != 33 {
		return "", fmt.Errorf("invalid compressed public key length: got %d, want 33", len(pubKeyBytes))
	}

	// Convert the public key to a P2PKH address
	pubKeyHash := btcutil.Hash160(pubKeyBytes)
	var address *btcutil.AddressPubKeyHash
	switch mainnetORtestnet3 {
	case "mainnet":
		address, err = btcutil.NewAddressPubKeyHash(pubKeyHash, &chaincfg.MainNetParams)
	case "testnet3":
		address, err = btcutil.NewAddressPubKeyHash(pubKeyHash, &chaincfg.TestNet3Params)
	default:
		return "", fmt.Errorf("invalid network, options: mainnet, testnet3")
	}
	if err != nil {
		return "", fmt.Errorf("failed to create Bech32 address: %w", err)
	}
	return address.EncodeAddress(), nil
}

func PubToP2WPKH(pubKeyCompressed, mainnetORtestnet3 string) (result string, err error) {
	defer RecoverAsError("PubToP2WPKH", &err, &result)

	// Decode hex-encoded compressed public key
	pubKeyBytes, err := hex.DecodeString(pubKeyCompressed)
	if err != nil {
		return "", fmt.Errorf("failed to decode public key: %w", err)
	}
	if len(pubKeyBytes) != 33 {
		return "", fmt.Errorf("invalid compressed public key length: got %d, want 33", len(pubKeyBytes))
	}

	// Determine network parameters
	var params *chaincfg.Params
	switch mainnetORtestnet3 {
	case "mainnet":
		params = &chaincfg.MainNetParams
	case "testnet3":
		params = &chaincfg.TestNet3Params
	default:
		return "", fmt.Errorf("invalid network, options: mainnet, testnet3")
	}

	// Create native SegWit (P2WPKH) address
	pubKeyHash := btcutil.Hash160(pubKeyBytes)
	address, err := btcutil.NewAddressWitnessPubKeyHash(pubKeyHash, params)
	if err != nil {
		return "", fmt.Errorf("failed to create P2WPKH address: %w", err)
	}

	return address.EncodeAddress(), nil
}

func PubToP2SHP2WKH(pubKeyCompressed, mainnetORtestnet3 string) (result string, err error) {
	defer RecoverAsError("PubToP2SHP2WKH", &err, &result)

	// Decode hex-encoded compressed public key
	pubKeyBytes, err := hex.DecodeString(pubKeyCompressed)
	if err != nil {
		return "", fmt.Errorf("failed to decode public key: %w", err)
	}
	if len(pubKeyBytes) != 33 {
		return "", fmt.Errorf("invalid compressed public key length: got %d, want 33", len(pubKeyBytes))
	}

	// Determine network parameters
	var params *chaincfg.Params
	switch mainnetORtestnet3 {
	case "mainnet":
		params = &chaincfg.MainNetParams
	case "testnet3":
		params = &chaincfg.TestNet3Params
	default:
		return "", fmt.Errorf("invalid network, options: mainnet, testnet3")
	}

	// Create nested SegWit (P2SH-P2WPKH) address
	pubKeyHash := btcutil.Hash160(pubKeyBytes)
	witnessAddr, err := btcutil.NewAddressWitnessPubKeyHash(pubKeyHash, params)
	if err != nil {
		return "", fmt.Errorf("failed to create witness pubkey hash: %w", err)
	}

	redeemScript, err := txscript.PayToAddrScript(witnessAddr)
	if err != nil {
		return "", fmt.Errorf("failed to create redeem script: %w", err)
	}

	wrappedAddr, err := btcutil.NewAddressScriptHash(redeemScript, params)
	if err != nil {
		return "", fmt.Errorf("failed to create P2SH address: %w", err)
	}

	return wrappedAddr.EncodeAddress(), nil
}

func PubToP2TR(pubKeyCompressedHex, mainnetORtestnet3 string) (result string, err error) {
	defer RecoverAsError("PubToP2TR", &err, &result)

	// Decode the compressed public key
	pubKeyBytes, err := hex.DecodeString(pubKeyCompressedHex)
	if err != nil {
		return "", fmt.Errorf("failed to decode compressed pubkey: %w", err)
	}
	if len(pubKeyBytes) != 33 {
		return "", fmt.Errorf("invalid compressed pubkey length: got %d, want 33", len(pubKeyBytes))
	}

	// Extract x-only pubkey (bytes 1 to 33, skipping the first byte)
	xOnlyPubKey := pubKeyBytes[1:]

	var params *chaincfg.Params
	switch mainnetORtestnet3 {
	case "mainnet":
		params = &chaincfg.MainNetParams
	case "testnet3":
		params = &chaincfg.TestNet3Params
	default:
		return "", fmt.Errorf("invalid network, options: mainnet, testnet3")
	}

	taprootAddr, err := btcutil.NewAddressTaproot(xOnlyPubKey, params)
	if err != nil {
		return "", fmt.Errorf("failed to create Taproot address: %w", err)
	}

	return taprootAddr.EncodeAddress(), nil
}
