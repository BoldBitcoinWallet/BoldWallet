package tss

import (
	"crypto/ecdsa"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/bnb-chain/tss-lib/v2/common"
	ecdsaKeygen "github.com/bnb-chain/tss-lib/v2/ecdsa/keygen"
	"github.com/bnb-chain/tss-lib/v2/ecdsa/signing"
	"github.com/bnb-chain/tss-lib/v2/tss"
	blog "github.com/ipfs/go-log/v2"
)

func (s *ServiceImpl) ApplyData(msg string) error {
	s.inboundMessageCh <- msg
	return nil
}

func LocalPreParams(ppmFile string, timeoutMinutes int) (result bool, err error) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("PANIC in LocalPreParams: %v", r)
			Logf("BBMTLog: %s", errMsg)
			Logf("BBMTLog: Stack trace: %s", string(debug.Stack()))
			err = fmt.Errorf("internal error (panic): %v", r)
			result = false
		}
	}()

	Logln("BBMTLog", "ppm generation...")

	if _, err := os.Stat(ppmFile); err != nil {
		if os.IsNotExist(err) {
			Logln("BBMTLog", "ppm file not found...")
		} else {
			return false, fmt.Errorf("failed to generate pre-parameters: %w", err)
		}
		Logln("BBMTLog", "ppm creation...")
		Logln("BBMTLog", "ppm GeneratePreParams...")
		preParams, err := ecdsaKeygen.GeneratePreParams(time.Duration(timeoutMinutes) * time.Minute)
		if err != nil {
			return false, fmt.Errorf("failed to generate pre-parameters: %w", err)
		}
		if len(ppmFile) > 0 {
			Logln("BBMTLog", "ppm saving...")
			if err := savePreParamsToFile(preParams, ppmFile); err != nil {
				return false, fmt.Errorf("failed to save pre-parameters to file: %w", err)
			}
			Logln("BBMTLog", "ppm ok...")
			return true, nil
		} else {
			Logln("BBMTLog", "ppm empty skip saving...")
			return true, nil
		}
	} else {
		Logln("BBMTLog", "ppm file found...")
		Logln("BBMTLog", "ppm loading...")
		_, err := loadPreParamsFromFile(ppmFile)
		if err != nil {
			return false, fmt.Errorf("failed to load pre-parameters from file: %w", err)
		}
		Logln("BBMTLog", "ppm ok...")
		return true, nil
	}
}

func PreParams(ppmFile string) (*ecdsaKeygen.LocalPreParams, error) {
	Logln("BBMTLog", "ppm generation...")

	if _, err := os.Stat(ppmFile); err != nil {
		if os.IsNotExist(err) {
			Logln("BBMTLog", "ppm file not found...")
		} else {
			return nil, fmt.Errorf("failed to generate pre-parameters: %w", err)
		}
		Logln("BBMTLog", "ppm creation...")
		Logln("BBMTLog", "ppm GeneratePreParams...")
		preParams, err := ecdsaKeygen.GeneratePreParams(10 * time.Minute)
		if err != nil {
			return nil, fmt.Errorf("failed to generate pre-parameters: %w", err)
		}
		if len(ppmFile) > 0 {
			Logln("BBMTLog", "ppm saving...")
			if err := savePreParamsToFile(preParams, ppmFile); err != nil {
				return nil, fmt.Errorf("failed to save pre-parameters to file: %w", err)
			}
			Logln("BBMTLog", "ppm ok...")
			return preParams, nil
		} else {
			Logln("BBMTLog", "ppm empty skip saving...")
			return preParams, nil
		}
	} else {
		Logln("BBMTLog", "ppm file found...")
		Logln("BBMTLog", "ppm loading...")
		preParams, err := loadPreParamsFromFile(ppmFile)
		if err != nil {
			return nil, fmt.Errorf("failed to load pre-parameters from file: %w", err)
		}
		Logln("BBMTLog", "ppm ok...")
		return preParams, nil
	}
}

func NewService(msg Messenger, stateAccessor LocalStateAccessor, createPreParam bool, ppmFile string) (*ServiceImpl, error) {
	if msg == nil {
		return nil, errors.New("nil messenger")
	}
	blog.SetAllLoggers(blog.LevelInfo)
	if stateAccessor == nil {
		return nil, errors.New("nil state accessor")
	}
	serviceImp := &ServiceImpl{
		messenger:        msg,
		stateAccessor:    stateAccessor,
		inboundMessageCh: make(chan string),
	}
	if createPreParam {
		ppms, err := PreParams(ppmFile)
		if err != nil {
			return nil, fmt.Errorf("failed preparams %w", err)
		}
		serviceImp.preParams = ppms
	}
	return serviceImp, nil
}

func loadPreParamsFromFile(filePath string) (*ecdsaKeygen.LocalPreParams, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read pre-parameters from file: %w", err)
	}
	var preParams ecdsaKeygen.LocalPreParams
	if err := json.Unmarshal(data, &preParams); err != nil {
		return nil, fmt.Errorf("failed to unmarshal pre-parameters: %w", err)
	}
	return &preParams, nil
}

func savePreParamsToFile(preParams *ecdsaKeygen.LocalPreParams, filePath string) error {
	data, err := json.Marshal(preParams)
	if err != nil {
		return fmt.Errorf("failed to marshal pre-parameters: %w", err)
	}
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write pre-parameters to file: %w", err)
	}
	return nil
}

func (r KeygenRequest) GetAllParties() []string {
	return strings.Split(r.AllParties, ",")
}

func (r KeysignRequest) GetKeysignCommitteeKeys() []string {
	return strings.Split(r.KeysignCommitteeKeys, ",")
}

func (s *ServiceImpl) getParties(allPartyKeys []string, localPartyKey string) ([]*tss.PartyID, *tss.PartyID) {
	var localPartyID *tss.PartyID
	var unSortedPartiesID []*tss.PartyID
	sort.Strings(allPartyKeys)
	for idx, item := range allPartyKeys {
		key := new(big.Int).SetBytes([]byte(item))
		partyID := tss.NewPartyID(strconv.Itoa(idx), item, key)
		if item == localPartyKey {
			localPartyID = partyID
		}
		unSortedPartiesID = append(unSortedPartiesID, partyID)
	}
	partyIDs := tss.SortPartyIDs(unSortedPartiesID)
	return partyIDs, localPartyID
}

func (s *ServiceImpl) KeygenECDSA(req *KeygenRequest) (*KeygenResponse, error) {
	if req.ChainCodeHex == "" {
		return nil, fmt.Errorf("ChainCodeHex is empty")
	}
	chaincode, err := hex.DecodeString(req.ChainCodeHex)
	if err != nil {
		return nil, fmt.Errorf("failed to decode chain code hex, error: %w", err)
	}
	if len(chaincode) != 32 {
		return nil, fmt.Errorf("invalid chain code length")
	}
	partyIDs, localPartyID := s.getParties(req.GetAllParties(), req.LocalPartyID)

	ctx := tss.NewPeerContext(partyIDs)
	curve := tss.S256()
	totalPartiesCount := len(req.GetAllParties())
	threshod, err := GetThreshold(totalPartiesCount)

	if err != nil {
		return nil, fmt.Errorf("failed to get threshold: %w", err)
	}
	params := tss.NewParameters(curve, ctx, localPartyID, totalPartiesCount, threshod)
	outCh := make(chan tss.Message, totalPartiesCount*2)                   // message channel
	endCh := make(chan *ecdsaKeygen.LocalPartySaveData, totalPartiesCount) // result channel
	localState := &LocalState{
		KeygenCommitteeKeys: req.GetAllParties(),
		LocalPartyKey:       req.LocalPartyID,
		ChainCodeHex:        req.ChainCodeHex, // ChainCode will be used later for ECDSA key derivation
	}
	errChan := make(chan struct{})
	localPartyECDSA := ecdsaKeygen.NewLocalParty(params, outCh, endCh, *s.preParams)

	go func() {
		tErr := localPartyECDSA.Start()
		if tErr != nil {
			Logln("BBMTLog", "failed to start keygen process", "error", tErr)
			close(errChan)
		}
	}()
	pubKey, err := s.processKeygen(localPartyECDSA, errChan, outCh, endCh, localState, partyIDs)
	if err != nil {
		Logln("BBMTLog", "failed to process keygen", "error", err)
		return nil, err
	}
	return &KeygenResponse{
		PubKey: pubKey,
	}, nil
}

func (s *ServiceImpl) applyMessageToTssInstance(localParty tss.Party, msg string, sortedPartyIds tss.SortedPartyIDs) (string, error) {
	var msgFromTss MessageFromTss
	originalBytes, err := base64.StdEncoding.DecodeString(msg)
	if err != nil {
		return "", fmt.Errorf("failed to decode message from base64, error: %w", err)
	}
	if err := json.Unmarshal(originalBytes, &msgFromTss); err != nil {
		return "", fmt.Errorf("failed to unmarshal message from json, error: %w, [%s], [%s]", err, msg, originalBytes)
	}
	var fromParty *tss.PartyID
	for _, item := range sortedPartyIds {
		if item.Moniker == msgFromTss.From {
			fromParty = item
			break
		}
	}
	if fromParty == nil {
		return "", fmt.Errorf("failed to find from party,from:%s", msgFromTss.From)
	}
	_, errUpdate := localParty.UpdateFromBytes(msgFromTss.WireBytes, fromParty, msgFromTss.IsBroadcast)
	if errUpdate != nil {
		return "", fmt.Errorf("failed to update from bytes, error: %w", errUpdate)
	}

	return "", nil
}

func (s *ServiceImpl) processKeygen(localParty tss.Party,
	errCh <-chan struct{},
	outCh <-chan tss.Message,
	ecdsaEndCh <-chan *ecdsaKeygen.LocalPartySaveData,
	localState *LocalState,
	sortedPartyIds tss.SortedPartyIDs) (string, error) {

	pubKey := ""
	errChan := make(chan error, 1)

	until := time.Now().Add(time.Duration(keyGenTimeout) * time.Second)

	for {
		select {
		// Handle errors from the error channel
		case <-errCh:
			return "", errors.New("failed to start keygen process")

		// Process outgoing messages
		case outMsg := <-outCh:
			go func() {
				msgData, r, _err := outMsg.WireBytes()
				if _err != nil {
					errChan <- fmt.Errorf("failed to get wire bytes, error: %v", _err)
					return
				}
				jsonBytes, _err := json.MarshalIndent(MessageFromTss{
					WireBytes:   msgData,
					From:        r.From.Moniker,
					IsBroadcast: r.IsBroadcast,
				}, "", "  ")
				if _err != nil {
					errChan <- fmt.Errorf("failed to marshal message to json, error: %v", _err)
					return
				}
				outboundPayload := base64.StdEncoding.EncodeToString(jsonBytes)
				if r.IsBroadcast || r.To == nil {
					for _, item := range localState.KeygenCommitteeKeys {
						if item == localState.LocalPartyKey {
							continue
						}
						if _err := s.messenger.Send(r.From.Moniker, item, outboundPayload); _err != nil {
							errChan <- fmt.Errorf("failed to broadcast message to peer, error: %v", _err)
							return
						}
					}
				} else {
					for _, item := range r.To {
						if _err := s.messenger.Send(r.From.Moniker, item.Moniker, outboundPayload); _err != nil {
							errChan <- fmt.Errorf("failed to send message to peer, error: %v", _err)
							return
						}
					}
				}
			}()

		// Process incoming messages
		case msg := <-s.inboundMessageCh:
			go func() {
				if _, err := s.applyMessageToTssInstance(localParty, msg, sortedPartyIds); err != nil {
					errChan <- fmt.Errorf("failed to apply message to tss instance, error: %w", err)
					return
				}
			}()

		// Handle ECDSA end channel
		case saveData := <-ecdsaEndCh:
			if pubKey == "" {
				var err error
				pubKey, err = GetHexEncodedPubKey(saveData.ECDSAPub)
				if err != nil {
					return "", fmt.Errorf("failed to get hex encoded ecdsa pub key, error: %w", err)
				}
				localState.PubKey = pubKey
				localState.ECDSALocalData = *saveData
				localState.CreatedAt = time.Now().UnixMilli()
				if err := s.saveLocalStateData(localState); err != nil {
					return "", fmt.Errorf("failed to save local state data, error: %w", err)
				}
				Logln("BBMTLog", "pubKey done, finalizing...")
			}

		// Periodic or idle check
		default:
			time.Sleep(250 * time.Millisecond)
			if time.Since(until) > 0 {
				return "", fmt.Errorf("keygen timeout, didn't finish in %d seconds", keyGenTimeout)
			} else {
				select {
				case err := <-errChan:
					return "", err
				default:
					if len(pubKey) > 0 {
						Logln("BBMTLog", "keyshare generated: ", localParty.PartyID().Moniker)
						time.Sleep(250 * time.Millisecond) // give space time for message sender channels
						return pubKey, nil
					}
				}
			}
		}
	}
}

func (s *ServiceImpl) saveLocalStateData(localState *LocalState) error {
	result, err := json.MarshalIndent(localState, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal local state, error: %w", err)
	}
	if err := s.stateAccessor.SaveLocalState(localState.PubKey, string(result)); err != nil {
		return fmt.Errorf("failed to save local state, error: %w", err)
	}
	return nil
}

func (s *ServiceImpl) KeysignECDSA(req *KeysignRequest) (*KeysignResponse, error) {
	if err := s.validateKeysignRequest(req); err != nil {
		return nil, err
	}
	bytesToSign, err := base64.StdEncoding.DecodeString(req.MessageToSign)
	if err != nil {
		return nil, fmt.Errorf("failed to decode message to sign, error: %w", err)
	}
	// restore the local saved data
	Logln("BBMTLog", "restoring local state...")
	localStateStr, err := s.stateAccessor.GetLocalState(req.PubKey)
	if err != nil {
		return nil, fmt.Errorf("failed to get local state, error: %w", err)
	}

	var localState LocalState
	if err := json.Unmarshal([]byte(localStateStr), &localState); err != nil {
		return nil, fmt.Errorf("failed to unmarshal local state, error: %w", err)
	}
	if localState.ECDSALocalData.ECDSAPub == nil {
		return nil, errors.New("nil ecdsa pub key")
	}
	if localState.ChainCodeHex == "" {
		return nil, errors.New("nil chain code")
	}
	chainCodeBuf, err := hex.DecodeString(localState.ChainCodeHex)
	if err != nil {
		return nil, fmt.Errorf("failed to decode chain code hex, error: %w", err)
	}
	keysignCommittee := req.GetKeysignCommitteeKeys()
	if !Contains(keysignCommittee, localState.LocalPartyKey) {
		return nil, errors.New("local party not in keysign committee")
	}
	keysignPartyIDs, localPartyID := s.getParties(keysignCommittee, localState.LocalPartyKey)

	threshold, err := GetThreshold(len(localState.KeygenCommitteeKeys))
	if err != nil {
		return nil, fmt.Errorf("failed to get threshold: %w", err)
	}
	curve := tss.S256()
	outCh := make(chan tss.Message, len(keysignPartyIDs)*2)
	endCh := make(chan *common.SignatureData, len(keysignPartyIDs))
	errCh := make(chan struct{})
	pathBuf, err := GetDerivePathBytes(req.DerivePath)
	if err != nil || len(pathBuf) == 0 {
		return nil, fmt.Errorf("failed to get derive path bytes, error: %w", err)
	}
	il, derivedKey, err := derivingPubkeyFromPath(localState.ECDSALocalData.ECDSAPub, chainCodeBuf, pathBuf, curve)
	if err != nil {
		return nil, fmt.Errorf("failed to derive key from path, error: %w", err)
	}
	keyDerivationDelta := il
	localKey := []ecdsaKeygen.LocalPartySaveData{localState.ECDSALocalData}
	if err := signing.UpdatePublicKeyAndAdjustBigXj(keyDerivationDelta, localKey, &derivedKey.PublicKey, curve); err != nil {
		return nil, fmt.Errorf("failed to update public key and adjust big xj, error: %w", err)
	}
	ctx := tss.NewPeerContext(keysignPartyIDs)
	params := tss.NewParameters(curve, ctx, localPartyID, len(keysignPartyIDs), threshold)
	m := HashToInt(bytesToSign, curve)
	keysignParty := signing.NewLocalPartyWithKDD(m, params, localKey[0], keyDerivationDelta, outCh, endCh, 0)

	go func() {
		tErr := keysignParty.Start()
		if tErr != nil {
			Logln("BBMTLog", "failed to start keysign process", "error", tErr)
			close(errCh)
		}
	}()
	sig, err := s.processKeySign(keysignParty, errCh, outCh, endCh, keysignPartyIDs)
	if err != nil {
		Logln("BBMTLog", "failed to process keysign", "error", err)
		return nil, err
	}

	// let's verify the signature
	if ecdsa.Verify(localKey[0].ECDSAPub.ToECDSAPubKey(), bytesToSign, new(big.Int).SetBytes(sig.R), new(big.Int).SetBytes(sig.S)) {
		Logln("BBMTLog", "signature is valid")
	} else {
		return nil, fmt.Errorf("invalid signature")
	}
	derSig, err := GetDERSignature(new(big.Int).SetBytes(sig.R), new(big.Int).SetBytes(sig.S))
	if err != nil {
		Logln("BBMTLog", "fail to get DER signature", "error", err)
	}

	return &KeysignResponse{
		Msg:          req.MessageToSign,
		MsgHex:       hex.EncodeToString(bytesToSign),
		R:            hex.EncodeToString(sig.R),
		S:            hex.EncodeToString(sig.S),
		DerSignature: hex.EncodeToString(derSig),
		RecoveryID:   hex.EncodeToString(sig.SignatureRecovery),
	}, nil
}

func (s *ServiceImpl) processKeySign(localParty tss.Party,
	errCh <-chan struct{},
	outCh <-chan tss.Message,
	endCh <-chan *common.SignatureData,
	sortedPartyIds tss.SortedPartyIDs) (*common.SignatureData, error) {

	var signature *common.SignatureData = nil
	errChan := make(chan error, 1)

	until := time.Now().Add(time.Duration(keySignTimeout) * time.Second)

	for {
		select {
		case <-errCh:
			return nil, errors.New("failed to start keysign process")
		case msg := <-outCh:
			go func() {
				msgData, r, err := msg.WireBytes()
				if err != nil {
					errChan <- fmt.Errorf("failed to get wire bytes, error: %v", err)
					return
				}
				jsonBytes, err := json.MarshalIndent(MessageFromTss{
					WireBytes:   msgData,
					From:        r.From.Moniker,
					IsBroadcast: r.IsBroadcast,
				}, "", "  ")
				if err != nil {
					errChan <- fmt.Errorf("failed to marshal message to json, error: %w", err)
				}
				// for debug
				Logln("BBMTLog", "send message from ", msg.GetFrom(), "to", msg.GetTo())
				outboundPayload := base64.StdEncoding.EncodeToString(jsonBytes)
				if r.IsBroadcast {
					for _, item := range sortedPartyIds {
						// don't send message to itself
						// the reason we can do this is because we set Monitor to be the participant key
						if item.Moniker == localParty.PartyID().Moniker {
							continue
						}
						if err := s.messenger.Send(r.From.Moniker, item.Moniker, outboundPayload); err != nil {
							errChan <- fmt.Errorf("failed to broadcast message to peer, error: %w", err)
						}
					}
				} else {
					for _, item := range r.To {
						if err := s.messenger.Send(r.From.Moniker, item.Moniker, outboundPayload); err != nil {
							errChan <- fmt.Errorf("failed to send message to peer, error: %w", err)
						}
					}
				}
			}()
		case msg := <-s.inboundMessageCh:
			go func() {
				// apply the message to the tss instance
				if _, err := s.applyMessageToTssInstance(localParty, msg, sortedPartyIds); err != nil {
					errChan <- fmt.Errorf("failed to apply message to tss instance, error: %w", err)
				}
			}()
		case sig := <-endCh: // finished keysign successfully
			if signature == nil {
				signature = sig
			}
		default:
			time.Sleep(250 * time.Millisecond)
			if time.Since(until) > 0 {
				Logln("BBMTLog", "Received timeout to end downloadMessage. Stopping...")
				return nil, fmt.Errorf("keysign timeout, didn't finish in %d seconds", keySignTimeout)
			} else {
				select {
				case err := <-errChan:
					return nil, err
				default:
					if signature != nil {
						Logln("BBMTLog", "signature generated: ", localParty.PartyID().Moniker)
						time.Sleep(250 * time.Millisecond) // give space time for message sender channels
						return signature, nil
					}
				}
			}
		}
	}

}

func (*ServiceImpl) validateKeysignRequest(req *KeysignRequest) error {
	if req == nil {
		return errors.New("nil request")
	}
	if req.KeysignCommitteeKeys == "" {
		return errors.New("nil keysign committee keys")
	}
	if req.LocalPartyKey == "" {
		return errors.New("nil local party key")
	}
	if req.PubKey == "" {
		return errors.New("nil pub key")
	}
	if req.MessageToSign == "" {
		return errors.New("nil message to sign")
	}
	return nil
}
