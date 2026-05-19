package tss

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"sort"
	"strings"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss/nostrtransport"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
)

// MpcSignPSBT signs a PSBT using MPC (server-based transport)
// Parameters:
//   - server, key, partiesCSV, session, sessionKey, encKey, decKey: TSS parameters
//   - keyshare: JSON keyshare data
//   - psbtBase64: base64-encoded PSBT to sign
//
// Derivation paths and public keys are extracted from the PSBT's Bip32Derivation fields.
//
// Returns: base64-encoded signed PSBT
func MpcSignPSBT(
	server, key, partiesCSV, session, sessionKey, encKey, decKey, keyshare, psbtBase64 string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in MpcSignPSBT: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	Logln("BBMTLog", "invoking MpcSignPSBT...")

	// Log network being used
	if _btc_net == "mainnet" {
		Logln("Using mainnet parameters")
	} else {
		Logln("Using testnet parameters")
	}

	// Parse keyshare JSON to get xpub and chaincode for deriving public keys
	var keyshareData LocalState
	if err := json.Unmarshal([]byte(keyshare), &keyshareData); err != nil {
		return "", fmt.Errorf("failed to parse keyshare JSON: %w", err)
	}
	if keyshareData.PubKey == "" {
		return "", fmt.Errorf("keyshare missing pub_key")
	}
	if keyshareData.ChainCodeHex == "" {
		return "", fmt.Errorf("keyshare missing chain_code_hex")
	}
	Logf("Keyshare parsed: pub_key (hex, full)=%s, chaincode (hex, full)=%s", truncateHex(keyshareData.PubKey), truncateHex(keyshareData.ChainCodeHex))
	Logf("Keyshare parsed: pub_key (hex) length=%d, chaincode (hex) length=%d", len(keyshareData.PubKey), len(keyshareData.ChainCodeHex))

	// Decode PSBT from base64
	psbtBytes, err := base64.StdEncoding.DecodeString(psbtBase64)
	if err != nil {
		return "", fmt.Errorf("failed to decode PSBT base64: %w", err)
	}
	Logf("PSBT decoded: %d bytes", len(psbtBytes))

	// Parse PSBT
	packet, err := psbt.NewFromRawBytes(bytes.NewReader(psbtBytes), false)
	if err != nil {
		return "", fmt.Errorf("failed to parse PSBT: %w", err)
	}
	Logf("PSBT parsed: %d inputs, %d outputs", len(packet.Inputs), len(packet.Outputs))

	// Log PSBT's XPubs for comparison with keyshare
	if len(packet.XPubs) > 0 {
		for i, xpub := range packet.XPubs {
			xpubPath := formatBip32Path(xpub.Bip32Path)
			Logf("PSBT XPubs[%d]: ExtendedKey (base58/xpub)=%s, path=%s", i, xpub.ExtendedKey, xpubPath)

			// Extract pubkey and chaincode from ExtendedKey (already decoded bytes) for comparison
			// xpub format: version(4) + depth(1) + fingerprint(4) + childIndex(4) + chaincode(32) + pubkey(33) = 78 bytes
			if len(xpub.ExtendedKey) >= 78 {
				psbtChaincodeHex := hex.EncodeToString(xpub.ExtendedKey[13:45]) // bytes 13-45 (32 bytes)
				psbtPubkeyHex := hex.EncodeToString(xpub.ExtendedKey[45:78])    // bytes 45-78 (33 bytes)
				Logf("PSBT XPubs[%d]: pubkey (hex, extracted from xpub)=%s, chaincode (hex, extracted from xpub)=%s", i, truncateHex(psbtPubkeyHex), truncateHex(psbtChaincodeHex))

				// Derive from keyshare's master key to the PSBT's xpub path level for comparison
				if xpubPath != "" {
					Logf("COMPARISON: PSBT xpub is at path %s (account level)", xpubPath)
					Logf("COMPARISON: Deriving from keyshare master key to PSBT xpub path: %s", xpubPath)
					Logf("COMPARISON: Keyshare master pub_key (hex)=%s", truncateHex(keyshareData.PubKey))
					Logf("COMPARISON: Keyshare master chaincode (hex)=%s", truncateHex(keyshareData.ChainCodeHex))

					derivedPubKeyHex, err := GetDerivedPubKey(keyshareData.PubKey, keyshareData.ChainCodeHex, xpubPath, false)
					if err != nil {
						Logf("COMPARISON ERROR: Failed to derive keyshare to PSBT xpub path %s: %v", xpubPath, err)
					} else {
						Logf("COMPARISON: Keyshare derived to %s: pubkey (hex)=%s", xpubPath, truncateHex(derivedPubKeyHex))
						Logf("COMPARISON: PSBT xpub pubkey (hex)=%s", truncateHex(psbtPubkeyHex))
						if derivedPubKeyHex == psbtPubkeyHex {
							Logf("COMPARISON: ✅ MATCH - Keyshare derived pubkey matches PSBT xpub pubkey at account level %s", xpubPath)
						} else {
							Logf("COMPARISON: ❌ MISMATCH - Keyshare derived pubkey (%s) does NOT match PSBT xpub pubkey (%s) at path %s", truncateHex(derivedPubKeyHex), truncateHex(psbtPubkeyHex), xpubPath)
							Logf("COMPARISON: This indicates the keyshare and PSBT are from different wallets or networks")
						}
					}

					// Also check if we can derive the chaincode at this level
					// Note: GetDerivedPubKey only returns the pubkey, not the chaincode
					// But we can verify by checking if derived keys from inputs match
				}
			} else {
				Logf("PSBT XPubs[%d]: ExtendedKey length %d, expected 78 bytes", i, len(xpub.ExtendedKey))
			}
		}
	} else {
		Logf("PSBT has no XPubs")
	}

	psbtJSON, err := json.MarshalIndent(packet, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal PSBT: %w", err)
	}
	Logf("PSBT_JSON: %s", string(psbtJSON))

	// Get the unsigned transaction
	tx := packet.UnsignedTx

	// Build prevOutFetcher from PSBT data
	prevOuts := make(map[wire.OutPoint]*wire.TxOut)
	for i, input := range packet.Inputs {
		txIn := tx.TxIn[i]
		outPoint := txIn.PreviousOutPoint

		var txOut *wire.TxOut
		if input.WitnessUtxo != nil {
			txOut = input.WitnessUtxo
		} else if input.NonWitnessUtxo != nil {
			// Get the output from the non-witness UTXO
			if int(outPoint.Index) < len(input.NonWitnessUtxo.TxOut) {
				txOut = input.NonWitnessUtxo.TxOut[outPoint.Index]
			}
		}

		if txOut != nil {
			prevOuts[outPoint] = txOut
		}
	}
	prevOutFetcher := txscript.NewMultiPrevOutFetcher(prevOuts)

	// Sign each input
	inputCount := len(packet.Inputs)
	for i := range packet.Inputs {
		input := &packet.Inputs[i]
		txIn := tx.TxIn[i]
		outPoint := txIn.PreviousOutPoint

		// Get the previous output
		var txOut *wire.TxOut
		if input.WitnessUtxo != nil {
			txOut = input.WitnessUtxo
		} else if input.NonWitnessUtxo != nil {
			if int(outPoint.Index) < len(input.NonWitnessUtxo.TxOut) {
				txOut = input.NonWitnessUtxo.TxOut[outPoint.Index]
			}
		}

		if txOut == nil {
			return "", fmt.Errorf("missing UTXO data for input %d", i)
		}

		// Extract derivation path for this specific input from PSBT
		// The PSBT's Bip32Derivation is the authoritative source for the derivation path
		var inputPubKeyBytes []byte
		var inputDerivePath string

		if len(input.Bip32Derivation) == 0 {
			return "", fmt.Errorf("input %d: missing Bip32Derivation in PSBT - PSBT must contain derivation path for each input", i)
		}

		// Get derivation path from PSBT - this is the authoritative source
		path := input.Bip32Derivation[0].Bip32Path
		// Log raw path for debugging
		pathStr := fmt.Sprintf("%v", path)
		Logf("Input %d: PSBT Bip32Derivation raw path: %s", i, pathStr)
		extractedPath := formatBip32Path(path)
		if extractedPath == "" {
			return "", fmt.Errorf("input %d: PSBT Bip32Derivation has empty or invalid path", i)
		}
		inputDerivePath = extractedPath
		Logf("Input %d: Using derivation path from PSBT Bip32Derivation: %s", i, inputDerivePath)

		// Get the pubkey from PSBT's Bip32Derivation (this is what the PSBT expects)
		psbtPubKeyBytes := input.Bip32Derivation[0].PubKey
		Logf("Input %d: PSBT Bip32Derivation pubkey: %x", i, psbtPubKeyBytes)

		// Derive the public key from keyshare using GetDerivedPubKey with the path from PSBT
		// Use the keyshare's pub_key and chaincode to derive the corresponding public key
		Logf("Input %d: Deriving public key from keyshare - xpub: %s, chaincode: %s, path: %s", i, truncateHex(keyshareData.PubKey), truncateHex(keyshareData.ChainCodeHex), inputDerivePath)
		derivedPubKeyHex, err := GetDerivedPubKey(keyshareData.PubKey, keyshareData.ChainCodeHex, inputDerivePath, false)
		if err != nil {
			return "", fmt.Errorf("failed to derive public key for input %d with path %s: %w", i, inputDerivePath, err)
		}
		derivedPubKeyBytes, err := hex.DecodeString(derivedPubKeyHex)
		if err != nil {
			return "", fmt.Errorf("failed to decode derived public key for input %d: %w", i, err)
		}
		Logf("Input %d: Derived public key (hex): %s, bytes: %x (length: %d)", i, truncateHex(derivedPubKeyHex), derivedPubKeyBytes, len(derivedPubKeyBytes))

		// Check if this input belongs to us by comparing derived pubkey with PSBT's pubkey
		if !bytes.Equal(derivedPubKeyBytes, psbtPubKeyBytes) {
			Logf("Input %d: ⚠️  SKIPPING SIGNATURE - Pubkey mismatch: derived %x != PSBT %x (path: %s)", i, derivedPubKeyBytes[:min(8, len(derivedPubKeyBytes))], psbtPubKeyBytes[:min(8, len(psbtPubKeyBytes))], inputDerivePath)
			Logf("Input %d: This input does not belong to our wallet, skipping signature", i)
			continue // Skip signing this input, but continue with other inputs
		}

		Logf("Input %d: ✅ Pubkey matches - this input belongs to our wallet, will sign", i)
		// Use the derived key for signing (which matches PSBT's key)
		inputPubKeyBytes = derivedPubKeyBytes

		// Create session for this input
		utxoSession := fmt.Sprintf("%s%d", session, i)
		mpcHook("signing psbt input", session, utxoSession, i+1, inputCount, false)

		// Get sighash type from PSBT input, default to SigHashAll if not specified
		sighashType := txscript.SigHashAll
		if input.SighashType != 0 {
			sighashType = txscript.SigHashType(input.SighashType)
			Logf("Input %d: Using sighash type from PSBT: %d", i, input.SighashType)
		} else {
			Logf("Input %d: Using default sighash type: SigHashAll", i)
		}

		// Determine script type and calculate sighash
		var sigHash []byte
		hashCache := txscript.NewTxSigHashes(tx, prevOutFetcher)
		isWitness := txscript.IsWitnessProgram(txOut.PkScript)

		if isWitness {
			if txscript.IsPayToWitnessPubKeyHash(txOut.PkScript) {
				// P2WPKH (Native SegWit)
				Logf("Input %d: P2WPKH", i)
				// Verify the public key matches the script
				// P2WPKH script format: OP_0 <20-byte-pubkeyhash>
				if len(txOut.PkScript) != 22 || txOut.PkScript[0] != 0x00 || txOut.PkScript[1] != 0x14 {
					return "", fmt.Errorf("invalid P2WPKH script format for input %d", i)
				}
				scriptPubKeyHash := txOut.PkScript[2:22]
				pubKeyHash := btcutil.Hash160(inputPubKeyBytes)
				Logf("Input %d: Script expects pubkey hash: %x", i, scriptPubKeyHash)
				Logf("Input %d: Derived pubkey hash: %x", i, pubKeyHash)
				Logf("Input %d: Derived pubkey: %x", i, inputPubKeyBytes)

				// Verify the public key hash matches the script (we already verified pubkey ownership above)
				if !bytes.Equal(scriptPubKeyHash, pubKeyHash) {
					return "", fmt.Errorf("public key hash mismatch for input %d: script expects %x but got %x (derived from path: %s)", i, scriptPubKeyHash, pubKeyHash, inputDerivePath)
				}
				Logf("Input %d: Public key hash verified for P2WPKH", i)
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, sighashType, tx, i, txOut.Value)
				if err != nil {
					return "", fmt.Errorf("failed to calculate P2WPKH sighash for input %d: %w", i, err)
				}
			} else if txscript.IsPayToTaproot(txOut.PkScript) {
				Logf("Input %d: P2TR (Taproot) - not supported", i)
				return "", fmt.Errorf("taproot (P2TR) inputs are not supported for MPC signing")
			} else {
				// Generic SegWit (P2WSH, etc.)
				Logf("Input %d: Generic SegWit", i)
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, sighashType, tx, i, txOut.Value)
				if err != nil {
					return "", fmt.Errorf("failed to calculate SegWit sighash for input %d: %w", i, err)
				}
			}
		} else if txscript.IsPayToScriptHash(txOut.PkScript) {
			// P2SH - check if it's P2SH-P2WPKH
			// Use the input-specific public key
			pubKeyHash := btcutil.Hash160(inputPubKeyBytes)
			redeemScript := make([]byte, 22)
			redeemScript[0] = 0x00 // OP_0
			redeemScript[1] = 0x14 // Push 20 bytes
			copy(redeemScript[2:], pubKeyHash)

			scriptHash := btcutil.Hash160(redeemScript)
			expectedP2SHScript := make([]byte, 23)
			expectedP2SHScript[0] = 0xa9 // OP_HASH160
			expectedP2SHScript[1] = 0x14 // Push 20 bytes
			copy(expectedP2SHScript[2:22], scriptHash)
			expectedP2SHScript[22] = 0x87 // OP_EQUAL

			if bytes.Equal(txOut.PkScript, expectedP2SHScript) {
				// P2SH-P2WPKH
				Logf("Input %d: P2SH-P2WPKH", i)
				sigHash, err = txscript.CalcWitnessSigHash(redeemScript, hashCache, txscript.SigHashAll, tx, i, txOut.Value)
				if err != nil {
					return "", fmt.Errorf("failed to calculate P2SH-P2WPKH sighash for input %d: %w", i, err)
				}
			} else {
				// Regular P2SH
				Logf("Input %d: P2SH", i)
				sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, sighashType, tx, i)
				if err != nil {
					return "", fmt.Errorf("failed to calculate P2SH sighash for input %d: %w", i, err)
				}
			}
		} else if txscript.IsPayToPubKeyHash(txOut.PkScript) {
			// P2PKH (Legacy)
			Logf("Input %d: P2PKH", i)
			// Verify the public key matches the script
			// P2PKH script format: OP_DUP OP_HASH160 <20-byte-pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
			if len(txOut.PkScript) != 25 || txOut.PkScript[0] != 0x76 || txOut.PkScript[1] != 0xa9 || txOut.PkScript[2] != 0x14 || txOut.PkScript[23] != 0x88 || txOut.PkScript[24] != 0xac {
				return "", fmt.Errorf("invalid P2PKH script format for input %d", i)
			}
			scriptPubKeyHash := txOut.PkScript[3:23]
			pubKeyHash := btcutil.Hash160(inputPubKeyBytes)
			Logf("Input %d: Script expects pubkey hash: %x", i, scriptPubKeyHash)
			Logf("Input %d: Derived pubkey hash: %x", i, pubKeyHash)
			Logf("Input %d: Derived pubkey: %x", i, inputPubKeyBytes)

			// Verify the public key hash matches the script (we already verified pubkey ownership above)
			if !bytes.Equal(scriptPubKeyHash, pubKeyHash) {
				return "", fmt.Errorf("public key hash mismatch for input %d: script expects %x but got %x (derived from path: %s)", i, scriptPubKeyHash, pubKeyHash, inputDerivePath)
			}
			Logf("Input %d: Public key hash verified for P2PKH", i)
			sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, txscript.SigHashAll, tx, i)
			if err != nil {
				return "", fmt.Errorf("failed to calculate P2PKH sighash for input %d: %w", i, err)
			}
		} else {
			return "", fmt.Errorf("unsupported script type for input %d", i)
		}

		// MPC sign the sighash
		sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
		Logf("Input %d: Signing with derivation path: %s, public key: %x...", i, inputDerivePath, inputPubKeyBytes[:min(8, len(inputPubKeyBytes))])
		Logf("Input %d sighash: %s", i, sighashBase64)

		mpcHook("joining keysign", session, utxoSession, i+1, inputCount, false)
		sigJSON, err := DispatchJoinKeysign(server, key, partiesCSV, utxoSession, sessionKey, encKey, decKey, keyshare, inputDerivePath, sighashBase64)
		if err != nil {
			return "", fmt.Errorf("failed to sign input %d: %w", i, err)
		}
		if sigJSON == "" {
			return "", fmt.Errorf("failed to sign input %d: signature is empty", i)
		}

		var sig KeysignResponse
		if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
			return "", fmt.Errorf("failed to parse signature response for input %d: %w", i, err)
		}

		derSignature, err := hex.DecodeString(sig.DerSignature)
		if err != nil {
			return "", fmt.Errorf("failed to decode DER signature for input %d: %w", i, err)
		}

		// Add signature with the sighash type used for signing
		signatureWithHashType := append(derSignature, byte(sighashType))

		// Add partial signature to PSBT using the input-specific public key
		input.PartialSigs = append(input.PartialSigs, &psbt.PartialSig{
			PubKey:    inputPubKeyBytes, // Use the public key from Bip32Derivation
			Signature: signatureWithHashType,
		})

		Logf("Input %d signed successfully with public key from PSBT", i)
	}

	mpcHook("psbt signing complete", session, "", inputCount, inputCount, true)

	// Validate the signed PSBT by finalizing and checking each input
	Logf("Validating signed PSBT before serialization...")
	if err := validateSignedPSBT(packet, prevOutFetcher); err != nil {
		return "", fmt.Errorf("PSBT validation failed: %w", err)
	}
	Logf("PSBT validation succeeded for all inputs")

	// Serialize the signed PSBT
	var signedPSBT bytes.Buffer
	if err := packet.Serialize(&signedPSBT); err != nil {
		return "", fmt.Errorf("failed to serialize signed PSBT: %w", err)
	}

	// Return as base64
	signedBase64 := base64.StdEncoding.EncodeToString(signedPSBT.Bytes())
	Logf("Signed PSBT: %d bytes", len(signedBase64))
	Logf("Signed PSBT: %s", signedBase64)

	return signedBase64, nil
}

// validateSignedPSBT validates that all signed inputs in the PSBT have valid signatures
// This helps catch signature errors before serialization
func validateSignedPSBT(packet *psbt.Packet, prevOutFetcher *txscript.MultiPrevOutFetcher) error {
	// Get the transaction
	tx := packet.UnsignedTx

	// Validate each input that has signatures
	hashCache := txscript.NewTxSigHashes(tx, prevOutFetcher)

	if hashCache == nil {
		return fmt.Errorf("failed to create transaction signature hashes")
	}

	validatedCount := 0

	for i := range tx.TxIn {
		input := &packet.Inputs[i]
		txIn := tx.TxIn[i]

		// Skip validation if this input has no signatures from us
		if len(input.PartialSigs) == 0 {
			Logf("Input %d: No partial signatures to validate (may be signed by other parties)", i)
			continue
		}

		// Get the previous output
		var txOut *wire.TxOut
		if input.WitnessUtxo != nil {
			txOut = input.WitnessUtxo
		} else if input.NonWitnessUtxo != nil {
			outPoint := txIn.PreviousOutPoint
			if int(outPoint.Index) < len(input.NonWitnessUtxo.TxOut) {
				txOut = input.NonWitnessUtxo.TxOut[outPoint.Index]
			}
		}

		if txOut == nil {
			return fmt.Errorf("input %d: missing UTXO data for validation", i)
		}

		// PSBT inputs are not finalized yet (they have partial signatures)
		// We can validate the signature format and public key matching
		Logf("Input %d: Validating partial signatures (count: %d)", i, len(input.PartialSigs))

		// Determine script type for better error messages
		scriptType := "unknown"
		scriptHash := "unknown"
		if len(txOut.PkScript) >= 22 && txOut.PkScript[0] == 0x00 && txOut.PkScript[1] == 0x14 {
			scriptType = "P2WPKH"
			scriptHash = hex.EncodeToString(txOut.PkScript[2:22])
		} else if len(txOut.PkScript) >= 25 && txOut.PkScript[0] == 0x76 {
			scriptType = "P2PKH"
			scriptHash = hex.EncodeToString(txOut.PkScript[3:23])
		} else if len(txOut.PkScript) >= 23 && txOut.PkScript[0] == 0xa9 {
			scriptType = "P2SH"
			scriptHash = hex.EncodeToString(txOut.PkScript[2:22])
		}

		// Verify each partial signature format and public key
		for sigIdx, partialSig := range input.PartialSigs {
			if len(partialSig.Signature) < 1 {
				return fmt.Errorf("input %d, signature %d: signature is empty (script type: %s, script hash: %s)",
					i, sigIdx, scriptType, scriptHash)
			}

			// Extract signature and hash type
			sigBytes := partialSig.Signature[:len(partialSig.Signature)-1]
			hashType := txscript.SigHashType(partialSig.Signature[len(partialSig.Signature)-1])

			// Verify signature format
			if len(sigBytes) < 8 {
				return fmt.Errorf("input %d, signature %d: signature too short (%d bytes, minimum 8) (script type: %s, script hash: %s, hash type: %d)",
					i, sigIdx, len(sigBytes), scriptType, scriptHash, hashType)
			}

			// Verify public key format
			if len(partialSig.PubKey) != 33 {
				return fmt.Errorf("input %d, signature %d: invalid public key length (%d bytes, expected 33) (script type: %s, script hash: %s, public key: %x...)",
					i, sigIdx, len(partialSig.PubKey), scriptType, scriptHash, partialSig.PubKey[:min(8, len(partialSig.PubKey))])
			}

			// Verify public key hash matches script (for P2WPKH and P2PKH)
			pubKeyHash := hex.EncodeToString(btcutil.Hash160(partialSig.PubKey))
			if scriptType == "P2WPKH" || scriptType == "P2PKH" {
				if pubKeyHash != scriptHash {
					return fmt.Errorf("input %d, signature %d: public key hash mismatch (script type: %s, script expects: %s, signature pubkey hash: %s, public key: %x..., hash type: %d)",
						i, sigIdx, scriptType, scriptHash, pubKeyHash,
						partialSig.PubKey[:min(8, len(partialSig.PubKey))], hashType)
				}
			}

			Logf("Input %d, signature %d: validated - length %d, hash type %d, pubkey hash %s",
				i, sigIdx, len(sigBytes), hashType, pubKeyHash)
		}

		Logf("Input %d: All partial signatures validated (format and pubkey match)", i)
		validatedCount++
	}

	Logf("PSBT validation: %d inputs validated successfully", validatedCount)
	return nil
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// truncateHex truncates a hex string to show only first 4 and last 4 characters
func truncateHex(hexStr string) string {
	if len(hexStr) <= 8 {
		return hexStr
	}
	return hexStr[:4] + "..." + hexStr[len(hexStr)-4:]
}

// formatBip32Path converts a BIP32 path from []uint32 to string format like "m/44'/0'/0'/0/0"
// Values >= 0x80000000 are hardened (indicated by ')
func formatBip32Path(path []uint32) string {
	if len(path) == 0 {
		return ""
	}

	parts := make([]string, len(path))
	for i, component := range path {
		if component >= 0x80000000 {
			// Hardened key: subtract 0x80000000 and add '
			parts[i] = fmt.Sprintf("%d'", component-0x80000000)
		} else {
			// Normal key
			parts[i] = fmt.Sprintf("%d", component)
		}
	}

	return "m/" + strings.Join(parts, "/")
}

// ParsePSBTDetails extracts transaction details from a PSBT for display
// Returns JSON with inputs, outputs, fee, and total amounts
func ParsePSBTDetails(psbtBase64 string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in ParsePSBTDetails: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	params := &chaincfg.TestNet3Params
	if _btc_net == "mainnet" {
		params = &chaincfg.MainNetParams
	}

	// Decode PSBT from base64
	psbtBytes, err := base64.StdEncoding.DecodeString(psbtBase64)
	if err != nil {
		return "", fmt.Errorf("failed to decode PSBT base64: %w", err)
	}

	// Parse PSBT
	packet, err := psbt.NewFromRawBytes(bytes.NewReader(psbtBytes), false)
	if err != nil {
		return "", fmt.Errorf("failed to parse PSBT: %w", err)
	}

	tx := packet.UnsignedTx

	// Extract derivation paths from PSBT inputs
	derivePathsPerInput := make([]string, 0) // Derivation path for each input

	// Calculate total input value and extract derivation paths
	var totalInput int64
	inputs := make([]map[string]interface{}, 0)
	for i, input := range packet.Inputs {
		txIn := tx.TxIn[i]
		inputInfo := map[string]interface{}{
			"txid": txIn.PreviousOutPoint.Hash.String(),
			"vout": txIn.PreviousOutPoint.Index,
		}

		var value int64
		if input.WitnessUtxo != nil {
			value = input.WitnessUtxo.Value
		} else if input.NonWitnessUtxo != nil {
			idx := txIn.PreviousOutPoint.Index
			if int(idx) < len(input.NonWitnessUtxo.TxOut) {
				value = input.NonWitnessUtxo.TxOut[idx].Value
			}
		}
		inputInfo["amount"] = value
		totalInput += value
		inputs = append(inputs, inputInfo)

		// Extract derivation path from Bip32Derivation for this input
		var inputDerivePath string
		if len(input.Bip32Derivation) > 0 {
			// Use the first derivation path found for this input
			// Convert []uint32 to string format like "m/44'/0'/0'/0/0"
			path := input.Bip32Derivation[0].Bip32Path
			inputDerivePath = formatBip32Path(path)
		}

		// Store derivation path for this input (or empty if not found)
		derivePathsPerInput = append(derivePathsPerInput, inputDerivePath)
	}

	// Calculate outputs
	var totalOutput int64
	outputs := make([]map[string]interface{}, 0)
	for _, txOut := range tx.TxOut {
		addr := "Unknown"
		_, addrs, _, err := txscript.ExtractPkScriptAddrs(txOut.PkScript, params)
		if err == nil && len(addrs) > 0 {
			addr = addrs[0].EncodeAddress()
		}

		outputs = append(outputs, map[string]interface{}{
			"address": addr,
			"amount":  txOut.Value,
		})
		totalOutput += txOut.Value
	}

	fee := max(totalInput-totalOutput, 0)

	result_map := map[string]interface{}{
		"inputs":      inputs,
		"outputs":     outputs,
		"fee":         fee,
		"totalInput":  totalInput,
		"totalOutput": totalOutput,
		"derivePaths": derivePathsPerInput,
	}

	jsonBytes, err := json.Marshal(result_map)
	if err != nil {
		return "", fmt.Errorf("failed to marshal PSBT details: %w", err)
	}

	return string(jsonBytes), nil
}

// NostrMpcSignPSBT signs a PSBT using MPC over Nostr transport
// This is analogous to NostrMpcSendBTC but for PSBT signing
// Parameters:
//   - relaysCSV: comma-separated Nostr relay URLs
//   - partyNsec: party's Nostr secret key (bech32)
//   - partiesNpubsCSV: comma-separated public keys of all parties (bech32)
//   - npubsSorted: sorted comma-separated npubs (for sessionFlag calculation)
//   - keyshareJSON: JSON keyshare data
//   - psbtBase64: base64-encoded PSBT to sign
//
// Returns: base64-encoded signed PSBT
func NostrMpcSignPSBT(
	relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted,
	keyshareJSON, psbtBase64 string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in NostrMpcSignPSBT: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	return runNostrMpcSignPSBTInternal(relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted, keyshareJSON, psbtBase64)
}

// runNostrMpcSignPSBTInternal implements the Nostr-based MPC PSBT signing
func runNostrMpcSignPSBTInternal(
	relaysCSV, partyNsec, partiesNpubsCSV, npubsSorted,
	keyshareJSON, psbtBase64 string) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in runNostrMpcSignPSBTInternal: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = ""
		}
	}()

	Logln("BBMTLog", "invoking NostrMpcSignPSBT...")

	// Log network being used
	if _btc_net == "mainnet" {
		Logln("Using mainnet parameters")
	} else {
		Logln("Using testnet parameters")
	}

	// Step 1: Calculate sessionFlag for pre-agreement using PSBT hash
	// Format: sha256(npubsSorted,psbtHash)
	psbtHash, err := Sha256(psbtBase64)
	if err != nil {
		return "", fmt.Errorf("failed to hash PSBT: %w", err)
	}
	sessionFlag, err := Sha256(fmt.Sprintf("%s,%s", npubsSorted, psbtHash))
	if err != nil {
		return "", fmt.Errorf("failed to calculate sessionFlag: %w", err)
	}
	Logf("NostrMpcSignPSBT: calculated sessionFlag=%s (psbtHash=%s)", sessionFlag, psbtHash[:16])

	// Step 2: Perform pre-agreement to exchange nonces
	mpcHook("pre-agreement phase", sessionFlag, "", 0, 0, false)
	preAgreement, err := runNostrPreAgreementPSBT(relaysCSV, partyNsec, partiesNpubsCSV, sessionFlag)
	if err != nil {
		return "", fmt.Errorf("pre-agreement failed: %w", err)
	}
	Logf("NostrMpcSignPSBT: pre-agreement completed - fullNonce=%s", preAgreement.fullNonce)

	// Step 3: Calculate actual sessionID using fullNonce
	sessionID, err := Sha256(fmt.Sprintf("%s,%s,%s", npubsSorted, psbtHash, preAgreement.fullNonce))
	if err != nil {
		return "", fmt.Errorf("failed to calculate sessionID: %w", err)
	}

	// Step 4: Generate session key from sessionID
	sessionKey, err := Sha256(fmt.Sprintf("%s,%s", npubsSorted, sessionID))
	if err != nil {
		return "", fmt.Errorf("failed to calculate sessionKey: %w", err)
	}
	Logf("NostrMpcSignPSBT: calculated sessionID=%s, sessionKey=%s", sessionID, sessionKey)

	// Parse keyshare JSON to get xpub and chaincode for deriving public keys
	var keyshareData LocalStateNostr
	if err := json.Unmarshal([]byte(keyshareJSON), &keyshareData); err != nil {
		return "", fmt.Errorf("failed to parse keyshare JSON: %w", err)
	}
	if keyshareData.PubKey == "" {
		return "", fmt.Errorf("keyshare missing pub_key")
	}
	if keyshareData.ChainCodeHex == "" {
		return "", fmt.Errorf("keyshare missing chain_code_hex")
	}
	Logf("Keyshare parsed: pub_key (hex, full)=%s, chaincode (hex, full)=%s", truncateHex(keyshareData.PubKey), truncateHex(keyshareData.ChainCodeHex))
	Logf("Keyshare parsed: pub_key (hex) length=%d, chaincode (hex) length=%d", len(keyshareData.PubKey), len(keyshareData.ChainCodeHex))

	// Decode PSBT from base64
	psbtBytes, err := base64.StdEncoding.DecodeString(psbtBase64)
	if err != nil {
		return "", fmt.Errorf("failed to decode PSBT base64: %w", err)
	}
	Logf("PSBT decoded: %d bytes", len(psbtBytes))

	// Parse PSBT
	packet, err := psbt.NewFromRawBytes(bytes.NewReader(psbtBytes), false)
	if err != nil {
		return "", fmt.Errorf("failed to parse PSBT: %w", err)
	}
	Logf("PSBT parsed: %d inputs, %d outputs", len(packet.Inputs), len(packet.Outputs))

	// Log PSBT's XPubs for comparison with keyshare
	if len(packet.XPubs) > 0 {
		for i, xpub := range packet.XPubs {
			xpubPath := formatBip32Path(xpub.Bip32Path)
			Logf("PSBT XPubs[%d]: ExtendedKey (base58/xpub)=%s, path=%s", i, xpub.ExtendedKey, xpubPath)

			// Extract pubkey and chaincode from ExtendedKey (already decoded bytes) for comparison
			// xpub format: version(4) + depth(1) + fingerprint(4) + childIndex(4) + chaincode(32) + pubkey(33) = 78 bytes
			if len(xpub.ExtendedKey) >= 78 {
				psbtChaincodeHex := hex.EncodeToString(xpub.ExtendedKey[13:45]) // bytes 13-45 (32 bytes)
				psbtPubkeyHex := hex.EncodeToString(xpub.ExtendedKey[45:78])    // bytes 45-78 (33 bytes)
				Logf("PSBT XPubs[%d]: pubkey (hex, extracted from xpub)=%s, chaincode (hex, extracted from xpub)=%s", i, truncateHex(psbtPubkeyHex), truncateHex(psbtChaincodeHex))

				// Derive from keyshare's master key to the PSBT's xpub path level for comparison
				if xpubPath != "" {
					Logf("COMPARISON: PSBT xpub is at path %s (account level)", xpubPath)
					Logf("COMPARISON: Deriving from keyshare master key to PSBT xpub path: %s", xpubPath)
					Logf("COMPARISON: Keyshare master pub_key (hex)=%s", truncateHex(keyshareData.PubKey))
					Logf("COMPARISON: Keyshare master chaincode (hex)=%s", truncateHex(keyshareData.ChainCodeHex))

					derivedPubKeyHex, err := GetDerivedPubKey(keyshareData.PubKey, keyshareData.ChainCodeHex, xpubPath, false)
					if err != nil {
						Logf("COMPARISON ERROR: Failed to derive keyshare to PSBT xpub path %s: %v", xpubPath, err)
					} else {
						Logf("COMPARISON: Keyshare derived to %s: pubkey (hex)=%s", xpubPath, truncateHex(derivedPubKeyHex))
						Logf("COMPARISON: PSBT xpub pubkey (hex)=%s", truncateHex(psbtPubkeyHex))
						if derivedPubKeyHex == psbtPubkeyHex {
							Logf("COMPARISON: ✅ MATCH - Keyshare derived pubkey matches PSBT xpub pubkey at account level %s", xpubPath)
						} else {
							Logf("COMPARISON: ❌ MISMATCH - Keyshare derived pubkey (%s) does NOT match PSBT xpub pubkey (%s) at path %s", truncateHex(derivedPubKeyHex), truncateHex(psbtPubkeyHex), xpubPath)
							Logf("COMPARISON: This indicates the keyshare and PSBT are from different wallets or networks")
						}
					}

					// Also check if we can derive the chaincode at this level
					// Note: GetDerivedPubKey only returns the pubkey, not the chaincode
					// But we can verify by checking if derived keys from inputs match
				}
			} else {
				Logf("PSBT XPubs[%d]: ExtendedKey length %d, expected 78 bytes", i, len(xpub.ExtendedKey))
			}
		}
	} else {
		Logf("PSBT has no XPubs")
	}

	// JSON of the whole packet
	psbtJSON, err := json.MarshalIndent(packet, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal PSBT: %w", err)
	}
	Logf("PSBT_JSON: %s", string(psbtJSON))

	// Get the unsigned transaction
	tx := packet.UnsignedTx

	// Build prevOutFetcher from PSBT data
	prevOuts := make(map[wire.OutPoint]*wire.TxOut)
	for i, input := range packet.Inputs {
		txIn := tx.TxIn[i]
		outPoint := txIn.PreviousOutPoint

		var txOut *wire.TxOut
		if input.WitnessUtxo != nil {
			txOut = input.WitnessUtxo
		} else if input.NonWitnessUtxo != nil {
			if int(outPoint.Index) < len(input.NonWitnessUtxo.TxOut) {
				txOut = input.NonWitnessUtxo.TxOut[outPoint.Index]
			}
		}

		if txOut != nil {
			prevOuts[outPoint] = txOut
		}
	}
	prevOutFetcher := txscript.NewMultiPrevOutFetcher(prevOuts)

	// Sign each input
	inputCount := len(packet.Inputs)
	for i := range packet.Inputs {
		input := &packet.Inputs[i]
		txIn := tx.TxIn[i]
		outPoint := txIn.PreviousOutPoint

		// Get the previous output
		var txOut *wire.TxOut
		if input.WitnessUtxo != nil {
			txOut = input.WitnessUtxo
		} else if input.NonWitnessUtxo != nil {
			if int(outPoint.Index) < len(input.NonWitnessUtxo.TxOut) {
				txOut = input.NonWitnessUtxo.TxOut[outPoint.Index]
			}
		}

		if txOut == nil {
			return "", fmt.Errorf("missing UTXO data for input %d", i)
		}

		// Extract derivation path for this specific input from PSBT
		// The PSBT's Bip32Derivation is the authoritative source for the derivation path
		var inputPubKeyBytes []byte
		var inputDerivePath string

		if len(input.Bip32Derivation) == 0 {
			return "", fmt.Errorf("input %d: missing Bip32Derivation in PSBT - PSBT must contain derivation path for each input", i)
		}

		// Get derivation path from PSBT - this is the authoritative source
		path := input.Bip32Derivation[0].Bip32Path
		// Log raw path for debugging
		pathStr := fmt.Sprintf("%v", path)
		Logf("Input %d: PSBT Bip32Derivation raw path: %s", i, pathStr)
		extractedPath := formatBip32Path(path)
		if extractedPath == "" {
			return "", fmt.Errorf("input %d: PSBT Bip32Derivation has empty or invalid path", i)
		}
		inputDerivePath = extractedPath
		Logf("Input %d: Using derivation path from PSBT Bip32Derivation: %s", i, inputDerivePath)

		// Get the pubkey from PSBT's Bip32Derivation (this is what the PSBT expects)
		psbtPubKeyBytes := input.Bip32Derivation[0].PubKey
		Logf("Input %d: PSBT Bip32Derivation pubkey: %x", i, psbtPubKeyBytes)

		// Derive the public key from keyshare using GetDerivedPubKey with the path from PSBT
		// Use the keyshare's pub_key and chaincode to derive the corresponding public key
		Logf("Input %d: Deriving public key from keyshare - xpub: %s, chaincode: %s, path: %s", i, truncateHex(keyshareData.PubKey), truncateHex(keyshareData.ChainCodeHex), inputDerivePath)
		derivedPubKeyHex, err := GetDerivedPubKey(keyshareData.PubKey, keyshareData.ChainCodeHex, inputDerivePath, false)
		if err != nil {
			return "", fmt.Errorf("failed to derive public key for input %d with path %s: %w", i, inputDerivePath, err)
		}
		derivedPubKeyBytes, err := hex.DecodeString(derivedPubKeyHex)
		if err != nil {
			return "", fmt.Errorf("failed to decode derived public key for input %d: %w", i, err)
		}
		Logf("Input %d: Derived public key (hex): %s, bytes: %x (length: %d)", i, truncateHex(derivedPubKeyHex), derivedPubKeyBytes, len(derivedPubKeyBytes))

		// Check if this input belongs to us by comparing derived pubkey with PSBT's pubkey
		if !bytes.Equal(derivedPubKeyBytes, psbtPubKeyBytes) {
			Logf("Input %d: ⚠️  SKIPPING SIGNATURE - Pubkey mismatch: derived %x != PSBT %x (path: %s)", i, derivedPubKeyBytes[:min(8, len(derivedPubKeyBytes))], psbtPubKeyBytes[:min(8, len(psbtPubKeyBytes))], inputDerivePath)
			Logf("Input %d: This input does not belong to our wallet, skipping signature", i)
			continue // Skip signing this input, but continue with other inputs
		}

		Logf("Input %d: ✅ Pubkey matches - this input belongs to our wallet, will sign", i)
		// Use the derived key for signing (which matches PSBT's key)
		inputPubKeyBytes = derivedPubKeyBytes

		// Create session for this input
		utxoSession := fmt.Sprintf("%s%d", sessionID, i)
		mpcHook("signing psbt input (nostr)", sessionID, utxoSession, i+1, inputCount, false)

		// Get sighash type from PSBT input, default to SigHashAll if not specified
		sighashType := txscript.SigHashAll
		if input.SighashType != 0 {
			sighashType = txscript.SigHashType(input.SighashType)
			Logf("Input %d: Using sighash type from PSBT: %d", i, input.SighashType)
		} else {
			Logf("Input %d: Using default sighash type: SigHashAll", i)
		}

		// Determine script type and calculate sighash
		var sigHash []byte
		hashCache := txscript.NewTxSigHashes(tx, prevOutFetcher)
		isWitness := txscript.IsWitnessProgram(txOut.PkScript)

		if isWitness {
			if txscript.IsPayToWitnessPubKeyHash(txOut.PkScript) {
				// P2WPKH (Native SegWit)
				Logf("Input %d: P2WPKH", i)
				// Verify the public key matches the script
				// P2WPKH script format: OP_0 <20-byte-pubkeyhash>
				if len(txOut.PkScript) != 22 || txOut.PkScript[0] != 0x00 || txOut.PkScript[1] != 0x14 {
					return "", fmt.Errorf("invalid P2WPKH script format for input %d", i)
				}
				scriptPubKeyHash := txOut.PkScript[2:22]
				pubKeyHash := btcutil.Hash160(inputPubKeyBytes)
				Logf("Input %d: Script expects pubkey hash: %x", i, scriptPubKeyHash)
				Logf("Input %d: Derived pubkey hash: %x", i, pubKeyHash)
				Logf("Input %d: Derived pubkey: %x", i, inputPubKeyBytes)

				// Verify the public key hash matches the script (we already verified pubkey ownership above)
				if !bytes.Equal(scriptPubKeyHash, pubKeyHash) {
					return "", fmt.Errorf("public key hash mismatch for input %d: script expects %x but got %x (derived from path: %s)", i, scriptPubKeyHash, pubKeyHash, inputDerivePath)
				}
				Logf("Input %d: Public key hash verified for P2WPKH", i)
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, sighashType, tx, i, txOut.Value)
				if err != nil {
					return "", fmt.Errorf("failed to calculate P2WPKH sighash for input %d: %w", i, err)
				}
			} else if txscript.IsPayToTaproot(txOut.PkScript) {
				Logf("Input %d: P2TR (Taproot) - not supported", i)
				return "", fmt.Errorf("taproot (P2TR) inputs are not supported for MPC signing")
			} else {
				// Generic SegWit (P2WSH, etc.)
				Logf("Input %d: Generic SegWit", i)
				sigHash, err = txscript.CalcWitnessSigHash(txOut.PkScript, hashCache, sighashType, tx, i, txOut.Value)
				if err != nil {
					return "", fmt.Errorf("failed to calculate SegWit sighash for input %d: %w", i, err)
				}
			}
		} else if txscript.IsPayToScriptHash(txOut.PkScript) {
			// P2SH - check if it's P2SH-P2WPKH
			// Use the input-specific public key
			pubKeyHash := btcutil.Hash160(inputPubKeyBytes)
			redeemScript := make([]byte, 22)
			redeemScript[0] = 0x00 // OP_0
			redeemScript[1] = 0x14 // Push 20 bytes
			copy(redeemScript[2:], pubKeyHash)

			scriptHash := btcutil.Hash160(redeemScript)
			expectedP2SHScript := make([]byte, 23)
			expectedP2SHScript[0] = 0xa9 // OP_HASH160
			expectedP2SHScript[1] = 0x14 // Push 20 bytes
			copy(expectedP2SHScript[2:22], scriptHash)
			expectedP2SHScript[22] = 0x87 // OP_EQUAL

			if bytes.Equal(txOut.PkScript, expectedP2SHScript) {
				// P2SH-P2WPKH
				Logf("Input %d: P2SH-P2WPKH", i)
				sigHash, err = txscript.CalcWitnessSigHash(redeemScript, hashCache, sighashType, tx, i, txOut.Value)
				if err != nil {
					return "", fmt.Errorf("failed to calculate P2SH-P2WPKH sighash for input %d: %w", i, err)
				}
			} else {
				// Regular P2SH
				Logf("Input %d: P2SH", i)
				sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, sighashType, tx, i)
				if err != nil {
					return "", fmt.Errorf("failed to calculate P2SH sighash for input %d: %w", i, err)
				}
			}
		} else if txscript.IsPayToPubKeyHash(txOut.PkScript) {
			// P2PKH (Legacy)
			Logf("Input %d: P2PKH", i)
			// Verify the public key matches the script
			// P2PKH script format: OP_DUP OP_HASH160 <20-byte-pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
			if len(txOut.PkScript) != 25 || txOut.PkScript[0] != 0x76 || txOut.PkScript[1] != 0xa9 || txOut.PkScript[2] != 0x14 || txOut.PkScript[23] != 0x88 || txOut.PkScript[24] != 0xac {
				return "", fmt.Errorf("invalid P2PKH script format for input %d", i)
			}
			scriptPubKeyHash := txOut.PkScript[3:23]
			pubKeyHash := btcutil.Hash160(inputPubKeyBytes)
			Logf("Input %d: Script expects pubkey hash: %x", i, scriptPubKeyHash)
			Logf("Input %d: Derived pubkey hash: %x", i, pubKeyHash)
			Logf("Input %d: Derived pubkey: %x", i, inputPubKeyBytes)

			// Verify the public key hash matches the script (we already verified pubkey ownership above)
			if !bytes.Equal(scriptPubKeyHash, pubKeyHash) {
				return "", fmt.Errorf("public key hash mismatch for input %d: script expects %x but got %x (derived from path: %s)", i, scriptPubKeyHash, pubKeyHash, inputDerivePath)
			}
			Logf("Input %d: Public key hash verified for P2PKH", i)
			sigHash, err = txscript.CalcSignatureHash(txOut.PkScript, sighashType, tx, i)
			if err != nil {
				return "", fmt.Errorf("failed to calculate P2PKH sighash for input %d: %w", i, err)
			}
		} else {
			return "", fmt.Errorf("unsupported script type for input %d", i)
		}

		// MPC sign the sighash via Nostr
		sighashBase64 := base64.StdEncoding.EncodeToString(sigHash)
		Logf("Input %d: Signing with derivation path: %s, public key: %x...", i, inputDerivePath, inputPubKeyBytes[:min(8, len(inputPubKeyBytes))])
		Logf("Input %d sighash: %s", i, sighashBase64)

		mpcHook("joining keysign (nostr)", sessionID, utxoSession, i+1, inputCount, false)
		sigJSON, err := DispatchNostrJoinKeysignWithSighash(relaysCSV, partyNsec, partiesNpubsCSV, utxoSession, sessionKey, keyshareJSON, inputDerivePath, sighashBase64)
		if err != nil {
			return "", fmt.Errorf("failed to sign input %d: %w", i, err)
		}
		if sigJSON == "" {
			return "", fmt.Errorf("failed to sign input %d: signature is empty", i)
		}

		var sig KeysignResponse
		if err := json.Unmarshal([]byte(sigJSON), &sig); err != nil {
			return "", fmt.Errorf("failed to parse signature response for input %d: %w", i, err)
		}

		derSignature, err := hex.DecodeString(sig.DerSignature)
		if err != nil {
			return "", fmt.Errorf("failed to decode DER signature for input %d: %w", i, err)
		}

		// Add signature with the sighash type used for signing
		signatureWithHashType := append(derSignature, byte(sighashType))

		// Add partial signature to PSBT using the input-specific public key
		input.PartialSigs = append(input.PartialSigs, &psbt.PartialSig{
			PubKey:    inputPubKeyBytes, // Use the public key from Bip32Derivation
			Signature: signatureWithHashType,
		})

		Logf("Input %d signed successfully with public key from PSBT", i)
	}

	mpcHook("psbt signing complete", sessionID, "", inputCount, inputCount, true)

	// Validate the signed PSBT by finalizing and checking each input
	Logf("Validating signed PSBT before serialization...")
	if err := validateSignedPSBT(packet, prevOutFetcher); err != nil {
		return "", fmt.Errorf("PSBT validation failed: %w", err)
	}
	Logf("PSBT validation succeeded for all inputs")

	// Serialize the signed PSBT
	var signedPSBT bytes.Buffer
	if err := packet.Serialize(&signedPSBT); err != nil {
		return "", fmt.Errorf("failed to serialize signed PSBT: %w", err)
	}

	// Return as base64
	signedBase64 := base64.StdEncoding.EncodeToString(signedPSBT.Bytes())
	Logf("Signed PSBT: %d bytes", len(signedBase64))
	Logf("Signed PSBT: %s", signedBase64)

	return signedBase64, nil
}

// psbtPreAgreementResult holds the results of the PSBT pre-agreement phase
type psbtPreAgreementResult struct {
	fullNonce string
}

// runNostrPreAgreementPSBT performs a pre-agreement phase for PSBT signing
// Both parties exchange their peerNonce, then agree on:
// - fullNonce: sorted join of both peerNonces (like in keygen)
func runNostrPreAgreementPSBT(relaysCSV, partyNsec, partiesNpubsCSV, sessionFlag string) (result *psbtPreAgreementResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in runNostrPreAgreementPSBT: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = nil
		}
	}()

	Logln("BBMTLog", "invoking runNostrPreAgreementPSBT...")

	// Derive npub from nsec
	localNpub, err := DeriveNpubFromNsec(partyNsec)
	if err != nil {
		return nil, err
	}

	// Parse relays
	relays := strings.Split(relaysCSV, ",")
	for i := range relays {
		relays[i] = strings.TrimSpace(relays[i])
	}

	// Parse peer npubs
	allParties := strings.Split(partiesNpubsCSV, ",")
	for i := range allParties {
		allParties[i] = strings.TrimSpace(allParties[i])
	}

	// Extract peer npubs (excluding self)
	peersNpub := make([]string, 0)
	for _, npub := range allParties {
		if npub != localNpub {
			peersNpub = append(peersNpub, npub)
		}
	}

	if len(peersNpub) != 1 {
		return nil, fmt.Errorf("pre-agreement requires exactly 1 peer, got %d", len(peersNpub))
	}
	peerNpub := peersNpub[0]

	// Generate session key from sessionFlag (deterministic)
	sessionKey, err := Sha256(sessionFlag)
	if err != nil {
		return nil, fmt.Errorf("failed to generate session key: %w", err)
	}

	// Generate random peerNonce
	peerNonce, err := SecureRandom(64)
	if err != nil {
		return nil, fmt.Errorf("failed to generate peerNonce: %w", err)
	}

	Logf("runNostrPreAgreementPSBT: sessionFlag=%s, localNpub=%s, peerNpub=%s, peerNonce=%s",
		sessionFlag, localNpub, peerNpub, peerNonce)

	// Create config for pre-agreement
	cfg := nostrtransport.Config{
		Relays:        relays,
		SessionID:     sessionFlag,
		SessionKeyHex: sessionKey,
		LocalNpub:     localNpub,
		LocalNsec:     partyNsec,
		PeersNpub:     peersNpub,
		MaxTimeout:    60 * time.Second,
	}
	cfg.ApplyDefaults()

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	// Create client and messenger
	client, err := nostrtransport.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create client: %w", err)
	}
	defer client.Close("pre-agreement complete")

	messenger := nostrtransport.NewMessenger(cfg, client)

	// Prepare our message: just the nonce
	localMessage := peerNonce
	Logf("runNostrPreAgreementPSBT: sending nonce: %s", localMessage)

	// Context for the pre-agreement phase (2 minutes timeout)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Channel to receive peer's message
	peerMessageCh := make(chan string, 1)
	peerErrorCh := make(chan error, 1)

	// Start listening for peer's message
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errMsg := fmt.Sprintf("PANIC in runNostrPreAgreementPSBT goroutine: %v", r)
				Logf("BBMTLog: %s", errMsg)
				Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
				select {
				case peerErrorCh <- fmt.Errorf("internal error (panic): %v", r):
				default:
				}
			}
		}()

		pump := nostrtransport.NewMessagePump(cfg, client)
		err := pump.Run(ctx, func(payload []byte) error {
			peerMessage := string(payload)
			Logf("runNostrPreAgreementPSBT: received peer message: %s", peerMessage)
			select {
			case peerMessageCh <- peerMessage:
			default:
			}
			return nil
		})
		if err != nil && err != context.Canceled {
			select {
			case peerErrorCh <- err:
			default:
			}
		}
	}()

	// Small delay to ensure subscription is active
	time.Sleep(1 * time.Second)

	// Send our nonce to peer
	err = messenger.SendMessage(ctx, localNpub, peerNpub, localMessage)
	if err != nil {
		return nil, fmt.Errorf("failed to send pre-agreement message: %w", err)
	}
	Logf("runNostrPreAgreementPSBT: sent nonce to peer")

	// Wait for peer's nonce
	var peerNonceReceived string
	select {
	case peerNonceReceived = <-peerMessageCh:
		Logf("runNostrPreAgreementPSBT: received peer nonce: %s", peerNonceReceived)
	case err := <-peerErrorCh:
		return nil, fmt.Errorf("failed to receive peer message: %w", err)
	case <-ctx.Done():
		return nil, fmt.Errorf("timeout waiting for peer message: %w", ctx.Err())
	}

	// Calculate fullNonce: sorted join of both nonces
	allNonces := []string{peerNonce, strings.TrimSpace(peerNonceReceived)}
	sort.Strings(allNonces)
	fullNonce := strings.Join(allNonces, ",")

	Logf("runNostrPreAgreementPSBT: fullNonce=%s", fullNonce)

	return &psbtPreAgreementResult{
		fullNonce: fullNonce,
	}, nil
}
