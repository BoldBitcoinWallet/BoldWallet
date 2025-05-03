package tss

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
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
	TxID  string `json:"txid"`
	Vout  uint32 `json:"vout"`
	Value int64  `json:"value"` // Value in satoshis
}

var _btc_net = "testnet3" // default to testnet
var _api_url = "https://mempool.space/testnet/api"
var _fee_set = "30m"

func SetNetwork(network string) (string, error) {
	if network == "mainnet" || network == "testnet3" {
		_btc_net = network
		if network == "mainnet" {
			_api_url = "https://mempool.space/api"
		} else if network == "testnet3" {
			_api_url = "https://mempool.space/testnet/api"
		}
		return _api_url, nil
	}
	return "", fmt.Errorf("non supported network %s", network)
}

func UseAPI(network, base string) (string, error) {
	if network == "mainnet" || network == "testnet3" {
		_btc_net = network
		_api_url = base
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
func FetchUTXOs(address string) ([]UTXO, error) {
	url := fmt.Sprintf("%s/address/%s/utxo", _api_url, address)
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch UTXOs: %w", err)
	}
	defer resp.Body.Close()

	var utxos []UTXO
	if err := json.NewDecoder(resp.Body).Decode(&utxos); err != nil {
		return nil, fmt.Errorf("failed to parse UTXO response: %w", err)
	}
	return utxos, nil
}

func TotalUTXO(address string) (string, error) {
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

func FetchUTXODetails(txID string, vout uint32) (*wire.TxOut, bool, error) {
	url := fmt.Sprintf("%s/tx/%s", _api_url, txID)
	resp, err := http.Get(url)
	if err != nil {
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

	if vout < uint32(len(txData.Vout)) {
		scriptBytes, err := hex.DecodeString(txData.Vout[vout].Scriptpubkey)
		if err != nil {
			return nil, false, fmt.Errorf("failed to decode scriptpubkey: %w", err)
		}
		isWitness := txscript.IsWitnessProgram(scriptBytes)
		return &wire.TxOut{PkScript: scriptBytes, Value: txData.Vout[vout].Value}, isWitness, nil
	}

	return nil, false, fmt.Errorf("invalid vout for txID %s", txID)
}

func RecommendedFees(feeType string) (int, error) {
	url := fmt.Sprintf("%s/v1/fees/recommended", _api_url)
	resp, err := http.Get(url)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	var fees FeeResponse
	if err := json.NewDecoder(resp.Body).Decode(&fees); err != nil {
		Logf("Error getting the feerate - using 2 sat/vB defaulted. %v", err)
		return 2, nil
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

func PostTx(rawTxHex string) (string, error) {
	// Define the Blockstream API endpoint for broadcasting transactions
	url := fmt.Sprintf("%s/tx", _api_url)

	// Create a POST request with the raw transaction hex as the body
	req, err := http.NewRequest("POST", url, bytes.NewBufferString(rawTxHex))
	if err != nil {
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
func SelectUTXOs(utxos []UTXO, totalAmount int64, strategy string) ([]UTXO, int64, error) {
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

func ecdsaSign(senderWIF string, data []byte) []byte {
	wifKey, _ := btcutil.DecodeWIF(senderWIF)
	signature := mecdsa.Sign(wifKey.PrivKey, data[:])
	return signature.Serialize()
}

func mpcHook(info, session, utxo_session string, utxo_current, utxo_total int, done bool) {
	hookData := fmt.Sprintf(
		`{ "time": %d, "type": "%s",  "info": "%s", "session": "%s", "utxo_session": "%s", "utxo_current": %d, "utxo_total": %d, "done": %t }`,
		int(time.Now().Unix()),
		"btc_send",
		info,
		session,
		utxo_session,
		utxo_current,
		utxo_total,
		done,
	)
	Hook(hookData)
}

func MpcSendBTC(
	/* tss */
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, derivePath,
	/* btc */
	publicKey, senderAddress, receiverAddress string, amountSatoshi, estimatedFee int64) (string, error) {

	Logln("BBMTLog", "invoking MpcSendBTC...")

	params := &chaincfg.TestNet3Params
	if _btc_net == "mainnet" {
		params = &chaincfg.MainNetParams
		Logln("Using mainnet parameters")
		mpcHook("using mainnet", session, "", 0, 0, false)
	} else {
		Logln("Using testnet parameters")
		mpcHook("using testnet", session, "", 0, 0, false)
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
	mpcHook("checking receiver address", session, "", 0, 0, false)
	if err != nil {
		Logf("Error decoding receiver address: %v", err)
		return "", fmt.Errorf("failed to decode receiver address: %w", err)
	}

	Logf("Sender Address Type: %T", fromAddr)
	Logf("Receiver Address Type: %T", toAddr)

	mpcHook("fetching utxos", session, "", 0, 0, false)
	utxos, err := FetchUTXOs(senderAddress)
	if err != nil {
		Logf("Error fetching UTXOs: %v", err)
		return "", fmt.Errorf("failed to fetch UTXOs: %w", err)
	}
	Logf("Fetched UTXOs: %+v", utxos)

	mpcHook("selecting utxos", session, "", 0, 0, false)
	selectedUTXOs, totalAmount, err := SelectUTXOs(utxos, amountSatoshi+estimatedFee, "smallest")
	if err != nil {
		Logf("Error selecting UTXOs: %v", err)
		return "", err
	}
	Logf("Selected UTXOs: %+v, Total Amount: %d", selectedUTXOs, totalAmount)

	// Create new transaction
	tx := wire.NewMsgTx(wire.TxVersion)
	Logln("New transaction created")

	// Add all inputs
	utxoCount := len(selectedUTXOs)
	utxoIndex := 0
	utxoSession := ""

	mpcHook("adding inputs", session, utxoSession, utxoIndex, utxoCount, false)
	for _, utxo := range selectedUTXOs {
		hash, _ := chainhash.NewHashFromStr(utxo.TxID)
		outPoint := wire.NewOutPoint(hash, utxo.Vout)
		tx.AddTxIn(wire.NewTxIn(outPoint, nil, nil))
		Logf("Added UTXO to transaction: %+v", utxo)
	}

	Logf("Estimated Fee: %d", estimatedFee)
	if totalAmount < amountSatoshi+estimatedFee {
		Logf("Insufficient funds: available %d, needed %d", totalAmount, amountSatoshi+estimatedFee)
		return "", fmt.Errorf("insufficient funds: available %d, needed %d", totalAmount, amountSatoshi+estimatedFee)
	}
	Logln("Sufficient funds available")

	// Add recipient output
	mpcHook("creating  output script", session, utxoSession, utxoIndex, utxoCount, false)
	pkScript, err := txscript.PayToAddrScript(toAddr)
	if err != nil {
		Logf("Error creating output script: %v", err)
		return "", fmt.Errorf("failed to create output script: %w", err)
	}
	tx.AddTxOut(wire.NewTxOut(amountSatoshi, pkScript))
	Logf("Added recipient output: %d satoshis to %s", amountSatoshi, receiverAddress)

	// Add change output if necessary
	changeAmount := totalAmount - amountSatoshi - estimatedFee
	mpcHook("calculating change amount", session, utxoSession, utxoIndex, utxoCount, false)

	if changeAmount > 546 {
		changePkScript, err := txscript.PayToAddrScript(fromAddr)
		if err != nil {
			Logf("Error creating change script: %v", err)
			return "", fmt.Errorf("failed to create change script: %w", err)
		}
		tx.AddTxOut(wire.NewTxOut(changeAmount, changePkScript))
		Logf("Added change output: %d satoshis to %s", changeAmount, senderAddress)
	}

	// Sign each input
	mpcHook("signing inputs", session, utxoSession, utxoIndex, utxoCount, false)
	for i, utxo := range selectedUTXOs {

		// update utxo session - counter
		utxoIndex = i + 1
		utxoSession = fmt.Sprintf("%s%d", session, i)

		mpcHook("fetching utxo defails", session, utxoSession, utxoIndex, utxoCount, false)
		txOut, isWitness, err := FetchUTXODetails(utxo.TxID, utxo.Vout)
		if err != nil {
			Logf("Error fetching UTXO details: %v", err)
			return "", fmt.Errorf("failed to fetch UTXO details: %w", err)
		}

		var sigHash []byte
		prevOutFetcher := txscript.NewCannedPrevOutputFetcher(txOut.PkScript, txOut.Value)

		if isWitness {
			Logf("Processing SegWit input for index: %d", i)
			hashCache := txscript.NewTxSigHashes(tx, prevOutFetcher)
			sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
			if err != nil {
				Logf("Error calculating witness sighash: %v", err)
				return "", fmt.Errorf("failed to calculate witness sighash: %w", err)
			}

			// Sign each utxo
			sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
			mpcHook("joining keysign", session, utxoSession, utxoIndex, utxoCount, false)
			sigJSON, err := JoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
			if err != nil {
				return "", fmt.Errorf("failed to sign transaction: signature is empty")
			}
			var sig KeysignResponse
			if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
				return "", fmt.Errorf("failed to parse signature response: %w", err)
			}

			// Decode the hex encoded DER signature
			signature, err := hex.DecodeString(sig.DerSignature)
			if err != nil {
				return "", fmt.Errorf("failed to decode DER signature: %w", err)
			}

			// sigWithHashType
			signatureWithHashType := append(signature, byte(txscript.SigHashAll))

			// Use Witness for SegWit
			mpcHook("appending signature - segwit", session, utxoSession, utxoIndex, utxoCount, false)
			tx.TxIn[i].Witness = wire.TxWitness{
				signatureWithHashType,
				pubKeyBytes,
			}
			tx.TxIn[i].SignatureScript = nil
			Logf("Witness set for input %d: %v", i, tx.TxIn[i].Witness)
		} else {
			Logf("Processing P2PKH input for index: %d", i)
			// For P2PKH outputs
			sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
			if err != nil {
				Logf("Error calculating sighash: %v", err)
				return "", fmt.Errorf("failed to calculate sighash: %w", err)
			}

			// Sign
			sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
			mpcHook("joining keysign", session, utxoSession, utxoIndex, utxoCount, false)
			sigJSON, err := JoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, derivePath, sighashBase64)
			if err != nil {
				return "", fmt.Errorf("failed to sign transaction: signature is empty")
			}
			var sig KeysignResponse
			if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
				return "", fmt.Errorf("failed to parse signature response: %w", err)
			}

			// Decode the hex encoded DER signature
			signature, err := hex.DecodeString(sig.DerSignature)
			if err != nil {
				return "", fmt.Errorf("failed to decode DER signature: %w", err)
			}

			// sigWithHashType
			signatureWithHashType := append(signature, byte(txscript.SigHashAll))

			// Use SignatureScript for P2PKH
			mpcHook("appending signature - p2pkh", session, utxoSession, utxoIndex, utxoCount, false)
			builder := txscript.NewScriptBuilder()
			builder.AddData(signatureWithHashType)
			builder.AddData(pubKeyBytes)
			scriptSig, err := builder.Script()
			if err != nil {
				Logf("Error building scriptSig: %v", err)
				return "", fmt.Errorf("failed to build scriptSig: %w", err)
			}
			tx.TxIn[i].SignatureScript = scriptSig
			tx.TxIn[i].Witness = nil
			Logf("SignatureScript set for input %d: %x", i, tx.TxIn[i].SignatureScript)
		}

		// Script validation
		mpcHook("validating tx script", session, utxoSession, utxoIndex, utxoCount, false)
		vm, err := txscript.NewEngine(
			txOut.PkScript,
			tx,
			i,
			txscript.StandardVerifyFlags,
			nil,
			txscript.NewTxSigHashes(tx, prevOutFetcher),
			txOut.Value,
			prevOutFetcher,
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
	mpcHook("serializing tx", session, utxoSession, utxoIndex, utxoCount, false)
	var signedTx bytes.Buffer
	if err := tx.Serialize(&signedTx); err != nil {
		Logf("Error serializing transaction: %v", err)
		return "", fmt.Errorf("failed to serialize transaction: %w", err)
	}

	rawTx := hex.EncodeToString(signedTx.Bytes())
	Logln("Raw Transaction:", rawTx)

	txid, err := PostTx(rawTx)
	if err != nil {
		Logf("Error broadcasting transaction: %v", err)
		return "", fmt.Errorf("failed to broadcast transaction: %w", err)
	}
	mpcHook("txid:"+txid, session, utxoSession, utxoIndex, utxoCount, true)
	Logf("Transaction broadcasted successfully, txid: %s", txid)
	return txid, nil
}

func DecodeAddress(address string) (string, error) {
	params := &chaincfg.TestNet3Params
	if _btc_net == "mainnet" {
		params = &chaincfg.MainNetParams
	}
	addr, err := btcutil.DecodeAddress(address, params)
	if err != nil {
		return "", fmt.Errorf("failed to decode sender address: %w", err)
	}
	return addr.EncodeAddress(), nil
}

func previewTxFees(senderAddress string, utxos []UTXO, satoshiAmount int64, receiverAddress string) (int64, error) {
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

func SendBitcoin(wifKey, publicKey, senderAddress, receiverAddress string, preview, amountSatoshi int64) (string, error) {
	Logln("BBMTLog", "invoking SendBitcoin...")
	params := &chaincfg.TestNet3Params
	if _btc_net == "mainnet" {
		params = &chaincfg.MainNetParams
	}

	utxos, err := FetchUTXOs(senderAddress)
	if err != nil {
		return "", fmt.Errorf("failed to fetch UTXOs: %w", err)
	}

	// select the utxos
	selectedUTXOs, totalAmount, err := SelectUTXOs(utxos, amountSatoshi, "smallest")
	if err != nil {
		return "", err
	}

	if preview > 0 {
		_fee, _err := previewTxFees(senderAddress, selectedUTXOs, amountSatoshi, receiverAddress)
		if _err != nil {
			return "", _err
		}
		return strconv.FormatInt(_fee, 10), nil
	}

	feeRate, err := RecommendedFees(_fee_set)
	if err != nil {
		return "", fmt.Errorf("failed to fetch fee rate: %w", err)
	}

	// Estimate transaction size more accurately
	var estimatedSize = 10 // Base size for version, locktime, etc.

	// Inputs
	for _, utxo := range selectedUTXOs {
		_, isWitness, err := FetchUTXODetails(utxo.TxID, utxo.Vout)
		if err != nil {
			return "", fmt.Errorf("failed to fetch UTXO details: %w", err)
		}
		if isWitness {
			// SegWit input size estimation
			estimatedSize += 68  // SegWit input without witness data
			estimatedSize += 107 // Witness data size (approx)
		} else {
			// Legacy input size
			estimatedSize += 148
		}
	}

	// Outputs
	estimatedSize += 34 // Standard P2PKH output size, adjust if using P2SH or other types

	// If change output is needed
	if totalAmount-amountSatoshi-int64(estimatedSize*feeRate/1000) > 546 {
		estimatedSize += 34 // Assuming change will go back to the same address type
	}

	estimatedFee := int64(estimatedSize * feeRate / 1000)
	Logf("Estimated Fee: %d", estimatedFee)

	if preview > 0 {
		return fmt.Sprintf("%d", estimatedFee), nil
	}

	// Create new transaction
	tx := wire.NewMsgTx(wire.TxVersion)

	// Add all inputs
	for _, utxo := range selectedUTXOs {
		hash, _ := chainhash.NewHashFromStr(utxo.TxID)
		outPoint := wire.NewOutPoint(hash, utxo.Vout)
		tx.AddTxIn(wire.NewTxIn(outPoint, nil, nil))
		Logf("Selected UTXOs: %+v", utxo)
	}

	if totalAmount < amountSatoshi+estimatedFee {
		return "", fmt.Errorf("insufficient funds: available %d, needed %d", totalAmount, amountSatoshi+estimatedFee)
	}

	// Decode WIF and validate key pair first
	decodedWIF, err := btcutil.DecodeWIF(wifKey)
	if err != nil {
		return "", fmt.Errorf("invalid WIF key: %w", err)
	}

	pubKeyBytes, err := hex.DecodeString(publicKey)
	if err != nil {
		return "", fmt.Errorf("invalid public key format: %w", err)
	}

	if !bytes.Equal(decodedWIF.PrivKey.PubKey().SerializeCompressed(), pubKeyBytes) {
		return "", fmt.Errorf("WIF key does not match provided public key")
	}

	fromAddr, err := btcutil.DecodeAddress(senderAddress, params)
	if err != nil {
		return "", fmt.Errorf("failed to decode sender address: %w", err)
	}

	toAddr, err := btcutil.DecodeAddress(receiverAddress, params)
	if err != nil {
		return "", fmt.Errorf("failed to decode receiver address: %w", err)
	}

	Logf("Sender Address Type: %T", fromAddr)
	Logf("Receiver Address Type: %T", toAddr)

	// Add recipient output
	pkScript, err := txscript.PayToAddrScript(toAddr)
	if err != nil {
		return "", fmt.Errorf("failed to create output script: %w", err)
	}
	tx.AddTxOut(wire.NewTxOut(amountSatoshi, pkScript))

	// Add change output if necessary
	changeAmount := totalAmount - amountSatoshi - estimatedFee
	if changeAmount > 546 {
		changePkScript, err := txscript.PayToAddrScript(fromAddr)
		if err != nil {
			return "", fmt.Errorf("failed to create change script: %w", err)
		}
		tx.AddTxOut(wire.NewTxOut(changeAmount, changePkScript))
	}

	// Sign each input
	// In SendBitcoin function
	for i, utxo := range selectedUTXOs {
		txOut, isWitness, err := FetchUTXODetails(utxo.TxID, utxo.Vout)
		if err != nil {
			return "", fmt.Errorf("failed to fetch UTXO details: %w", err)
		}

		var sigHash []byte
		prevOutFetcher := txscript.NewCannedPrevOutputFetcher(txOut.PkScript, txOut.Value)

		if isWitness {
			Logf("Processing SegWit input for index: %d", i)
			// For SegWit outputs
			hashCache := txscript.NewTxSigHashes(tx, prevOutFetcher)
			sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
			if err != nil {
				return "", fmt.Errorf("failed to calculate witness sighash: %w", err)
			}

			// Sign
			signature := ecdsaSign(wifKey, sigHash)
			signatureWithHashType := append(signature, byte(txscript.SigHashAll))

			// Use Witness for SegWit
			tx.TxIn[i].Witness = wire.TxWitness{
				signatureWithHashType,
				pubKeyBytes,
			}
			tx.TxIn[i].SignatureScript = nil
			Logf("Witness set for input %d: %v", i, tx.TxIn[i].Witness)
		} else {
			Logf("Processing P2PKH input for index: %d", i)
			// For P2PKH outputs
			sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
			if err != nil {
				return "", fmt.Errorf("failed to calculate sighash: %w", err)
			}

			// Sign
			// Sign with your ecdsaSign function
			signature := ecdsaSign(wifKey, sigHash)
			signatureWithHashType := append(signature, byte(txscript.SigHashAll))

			// Use SignatureScript for P2PKH
			builder := txscript.NewScriptBuilder()
			builder.AddData(signatureWithHashType)
			builder.AddData(pubKeyBytes)
			scriptSig, err := builder.Script()
			if err != nil {
				return "", fmt.Errorf("failed to build scriptSig: %w", err)
			}
			tx.TxIn[i].SignatureScript = scriptSig
			tx.TxIn[i].Witness = nil
			Logf("SignatureScript set for input %d: %x", i, tx.TxIn[i].SignatureScript)
		}

		// Script validation
		vm, err := txscript.NewEngine(
			txOut.PkScript,
			tx,
			i,
			txscript.StandardVerifyFlags,
			nil,
			txscript.NewTxSigHashes(tx, prevOutFetcher),
			txOut.Value,
			prevOutFetcher,
		)
		if err != nil {
			return "", fmt.Errorf("failed to create script engine for input %d: %w", i, err)
		}
		if err := vm.Execute(); err != nil {
			return "", fmt.Errorf("script validation failed for input %d: %w", i, err)
		}
	}

	// Serialize and broadcast
	var signedTx bytes.Buffer
	if err := tx.Serialize(&signedTx); err != nil {
		return "", fmt.Errorf("failed to serialize transaction: %w", err)
	}

	rawTx := hex.EncodeToString(signedTx.Bytes())
	Logln("Raw Transaction:", rawTx) // Print raw transaction for debugging

	txid, err := PostTx(rawTx)
	if err != nil {
		return "", fmt.Errorf("failed to broadcast transaction: %w", err)
	}

	return txid, nil
}

func SecP256k1Recover(r, s, v, h string) (string, error) {
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

func ConvertPubKeyToBTCAddress(pubKeyCompressed, mainnetORtestnet3 string) (string, error) {
	// Decode the hex string to bytes
	pubKeyBytes, err := hex.DecodeString(pubKeyCompressed)
	if err != nil {
		return "", fmt.Errorf("failed to decode public key: %w", err)
	}

	// Ensure the public key is in the correct format
	if len(pubKeyBytes) != 33 {
		return "", fmt.Errorf("invalid compressed public key length: got %d, want 33", len(pubKeyBytes))
	}

	// Convert the public key to a P2WPKH address (Bech32)
	pubKeyHash := btcutil.Hash160(pubKeyBytes)
	var address *btcutil.AddressPubKeyHash
	if mainnetORtestnet3 == "mainnet" {
		address, err = btcutil.NewAddressPubKeyHash(pubKeyHash, &chaincfg.MainNetParams)
	} else if mainnetORtestnet3 == "testnet3" {
		address, err = btcutil.NewAddressPubKeyHash(pubKeyHash, &chaincfg.TestNet3Params)
	} else {
		return "", fmt.Errorf("invalid network, options: mainnet, testnet3")
	}
	if err != nil {
		return "", fmt.Errorf("failed to create Bech32 address: %w", err)
	}
	return address.EncodeAddress(), nil
}
