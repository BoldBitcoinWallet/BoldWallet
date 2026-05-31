// BBMTLibNativeModule.m
// BBMTLib
//
// Created on 30/11/2024.

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(BBMTLibNativeModule, NSObject)

// SHA256 Method
RCT_EXTERN_METHOD(sha256:(NSString *)message resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// ECIES Key Pair Generation
RCT_EXTERN_METHOD(eciesKeypair:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// AES Encryption
RCT_EXTERN_METHOD(aesEncrypt:(NSString *)data key:(NSString *)key resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// AES Decryption
RCT_EXTERN_METHOD(aesDecrypt:(NSString *)data key:(NSString *)key resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// AES encrypt keyshare loaded from RNES-compatible secure storage (no plaintext through JS)
RCT_EXTERN_METHOD(aesEncryptStoredKeyshare:(NSString *)key resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// Pre-Params Method
RCT_EXTERN_METHOD(preparams:(NSString *)outFile timeout:(NSString *)timeout resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// Recover Public Key from Signature
RCT_EXTERN_METHOD(recoverPubkey:(NSString *)r s:(NSString *)s v:(NSString *)v h:(NSString *)h resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// Convert Public Key to Bitcoin Address
RCT_EXTERN_METHOD(btcAddress:(NSString *)compressedPubkey network:(NSString *)network addressType:(NSString *)addressType resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// Call keygen
RCT_EXTERN_METHOD(mpcTssSetup:(NSString *)server
                  partyID:(NSString *)partyID
                  ppmFile:(NSString *)ppmFile
                  partiesCSV:(NSString *)partiesCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  encKey:(NSString *)encKey
                  decKey:(NSString *)decKey
                  chaincode:(NSString *)chaincode
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call getLanIp
RCT_EXTERN_METHOD(getLanIp:(NSString *)peerIP
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call listenForPeer
RCT_EXTERN_METHOD(listenForPeers:(NSString *)id
                  pubkey:(NSString *)pubkey
                  port:(NSString *)port
                  timeout:(NSString *)timeout
                  mode:(NSString *)mode
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call discoverPeer
RCT_EXTERN_METHOD(discoverPeers:(NSString *)id
                  pubkey:(NSString *)pubkey
                  localIp:(NSString *)localIp
                  remoteIp:(NSString *)remoteIp
                  port:(NSString *)port
                  timeout:(NSString *)timeout
                  mode:(NSString *)mode
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call runRelay
RCT_EXTERN_METHOD(runRelay:(NSString *)port
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)


// Call stopRelay
RCT_EXTERN_METHOD(stopRelay:(NSString *)tag
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call fetchData
RCT_EXTERN_METHOD(fetchData:(NSString *)url
                  decKey:(NSString *)decKey
                  payload:(NSString *)payload
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call publishData
RCT_EXTERN_METHOD(publishData:(NSString *)port
                  timeout:(NSString *)timeout
                  encKey:(NSString *)encKey
                  raw:(NSString *)raw
                  mode:(NSString *)mode
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call derivePubkey
RCT_EXTERN_METHOD(derivePubkey:(NSString *)hexPubkey
                  hexChaincode:(NSString *)hexChaincode
                  path:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call encodeXpub - encode public key and chain code to xpub/tpub format
RCT_EXTERN_METHOD(encodeXpub:(NSString *)hexPubkey
                  hexChaincode:(NSString *)hexChaincode
                  network:(NSString *)network
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call getOutputDescriptor - generate output descriptor for watch-only wallet import (Sparrow, etc.)
RCT_EXTERN_METHOD(getOutputDescriptor:(NSString *)hexPubkey
                  hexChaincode:(NSString *)hexChaincode
                  network:(NSString *)network
                  addressType:(NSString *)addressType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(appendOutputDescriptorChecksum:(NSString *)descriptorBody
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call setBtcNetwork
RCT_EXTERN_METHOD(setBtcNetwork:(NSString *)network
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call disableLogs
RCT_EXTERN_METHOD(disableLogging:(NSString *)tag
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call setFeePolicy
RCT_EXTERN_METHOD(setFeePolicy:(NSString *)policy
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call setAPI
RCT_EXTERN_METHOD(setAPI:(NSString *)network
                  baseAPI:(NSString *)baseAPI
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call setFeeAPIs
RCT_EXTERN_METHOD(setFeeAPIs:(NSString *)urls
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call totalUTXO
RCT_EXTERN_METHOD(totalUTXO:(NSString *)address
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call estimateFee
RCT_EXTERN_METHOD(estimateFees:(NSString *)senderAddress
                  receiverAddress:(NSString *)receiverAddress
                  amountSatoshi:(NSString *)amountSatoshi
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call estimateFeeWithUTXOs (multi-path)
RCT_EXTERN_METHOD(estimateFeeWithUTXOs:(NSString *)utxosWithPathsJSON
                  receiverAddress:(NSString *)receiverAddress
                  amountSatoshi:(NSString *)amountSatoshi
                  changeAddress:(NSString *)changeAddress
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call spendingHash
RCT_EXTERN_METHOD(spendingHash:(NSString *)senderAddress
                  receiverAddress:(NSString *)receiverAddress
                  amountSatoshi:(NSString *)amountSatoshi
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call spendingHashWithUTXOs (multi-path)
RCT_EXTERN_METHOD(spendingHashWithUTXOs:(NSString *)utxosWithPathsJSON
                  receiverAddress:(NSString *)receiverAddress
                  amountSatoshi:(NSString *)amountSatoshi
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// mpcSendBTCWithUTXOs with keyshare read from secure storage (RNES-compatible)
RCT_EXTERN_METHOD(mpcSendBTCWithUTXOs:(NSString *)server
                  partyID:(NSString *)partyID
                  partiesCSV:(NSString *)partiesCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  encKey:(NSString *)encKey
                  decKey:(NSString *)decKey
                  publicKey:(NSString *)publicKey
                  receiverAddress:(NSString *)receiverAddress
                  amountSatoshi:(NSString *)amountSatoshi
                  feeSatoshi:(NSString *)feeSatoshi
                  utxosWithPathsJSON:(NSString *)utxosWithPathsJSON
                  changeAddress:(NSString *)changeAddress
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Nostr Keypair Generation
RCT_EXTERN_METHOD(nostrKeypair:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// Hex to Npub Conversion
RCT_EXTERN_METHOD(hexToNpub:(NSString *)hexKey resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// Nostr MPC TSS Setup (Keygen)
RCT_EXTERN_METHOD(nostrMpcTssSetup:(NSString *)relaysCSV
                  partyNsec:(NSString *)partyNsec
                  partiesNpubsCSV:(NSString *)partiesNpubsCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  chaincode:(NSString *)chaincode
                  ppmFile:(NSString *)ppmFile
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Nostr Join Keysign
RCT_EXTERN_METHOD(nostrJoinKeysign:(NSString *)relaysCSV
                  partyNsec:(NSString *)partyNsec
                  partiesNpubsCSV:(NSString *)partiesNpubsCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  keyshareJSON:(NSString *)keyshareJSON
                  derivationPath:(NSString *)derivationPath
                  message:(NSString *)message
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Nostr MPC Send BTC (UTXO multi-path only); nsec read from stored keyshare in native
RCT_EXTERN_METHOD(nostrMpcSendBTC:(NSString *)relaysCSV
                  partiesNpubsCSV:(NSString *)partiesNpubsCSV
                  npubsSorted:(NSString *)npubsSorted
                  balanceSats:(NSString *)balanceSats
                  receiverAddress:(NSString *)receiverAddress
                  amountSatoshi:(NSString *)amountSatoshi
                  estimatedFee:(NSString *)estimatedFee
                  utxosWithPathsJSON:(NSString *)utxosWithPathsJSON
                  changeAddress:(NSString *)changeAddress
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// MPC Sign PSBT (server-based transport); keyshare from native secure storage (RNES)
RCT_EXTERN_METHOD(mpcSignPSBT:(NSString *)server
                  partyID:(NSString *)partyID
                  partiesCSV:(NSString *)partiesCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  encKey:(NSString *)encKey
                  decKey:(NSString *)decKey
                  psbtBase64:(NSString *)psbtBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Nostr MPC Sign PSBT — nsec from native stored keyshare
RCT_EXTERN_METHOD(nostrMpcSignPSBT:(NSString *)relaysCSV
                  partiesNpubsCSV:(NSString *)partiesNpubsCSV
                  npubsSorted:(NSString *)npubsSorted
                  psbtBase64:(NSString *)psbtBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// DKLs23 (libtss) — parallel MPC backend
RCT_EXTERN_METHOD(dklsHelloDkg:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dklsMpcTssSetup:(NSString *)server
                  partyID:(NSString *)partyID
                  partiesCSV:(NSString *)partiesCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  encKey:(NSString *)encKey
                  decKey:(NSString *)decKey
                  chaincode:(NSString *)chaincode
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dklsNostrMpcTssSetup:(NSString *)relaysCSV
                  partyNsec:(NSString *)partyNsec
                  partiesNpubsCSV:(NSString *)partiesNpubsCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  chaincode:(NSString *)chaincode
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dklsCancelMpcSession:(NSString *)sessionID
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dklsCancelNostrMpc:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dklsMpcSignPSBT:(NSString *)server
                  partyID:(NSString *)partyID
                  partiesCSV:(NSString *)partiesCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  encKey:(NSString *)encKey
                  decKey:(NSString *)decKey
                  psbtBase64:(NSString *)psbtBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dklsMpcSendBTCWithUTXOs:(NSString *)server
                  partyID:(NSString *)partyID
                  partiesCSV:(NSString *)partiesCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  encKey:(NSString *)encKey
                  decKey:(NSString *)decKey
                  btcPub:(NSString *)btcPub
                  toAddress:(NSString *)toAddress
                  satoshiAmount:(NSString *)satoshiAmount
                  satoshiFees:(NSString *)satoshiFees
                  utxosWithPathsJSON:(NSString *)utxosWithPathsJSON
                  changeAddress:(NSString *)changeAddress
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dklsNostrMpcSendBTC:(NSString *)relaysCSV
                  partiesNpubsCSV:(NSString *)partiesNpubsCSV
                  npubsSorted:(NSString *)npubsSorted
                  balanceSats:(NSString *)balanceSats
                  toAddress:(NSString *)toAddress
                  satoshiAmount:(NSString *)satoshiAmount
                  satoshiFees:(NSString *)satoshiFees
                  utxosWithPathsJSON:(NSString *)utxosWithPathsJSON
                  changeAddress:(NSString *)changeAddress
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dklsNostrMpcSignPSBT:(NSString *)relaysCSV
                  partiesNpubsCSV:(NSString *)partiesNpubsCSV
                  npubsSorted:(NSString *)npubsSorted
                  psbtBase64:(NSString *)psbtBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Parse PSBT Details
RCT_EXTERN_METHOD(parsePSBTDetails:(NSString *)psbtBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(psbtIdentityHash:(NSString *)psbtBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Broadcast a signed raw tx hex; returns txid on success
RCT_EXTERN_METHOD(postTx:(NSString *)rawTxHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Compute txid from raw tx hex (for filename before broadcast)
RCT_EXTERN_METHOD(computeTxId:(NSString *)rawTxHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Cancel server-based MPC session (sessionID prefix)
RCT_EXTERN_METHOD(cancelMpcSession:(NSString *)sessionID
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Cancel active Nostr MPC operation (best-effort)
RCT_EXTERN_METHOD(cancelNostrMpc:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Minimal keyshare fields for Nostr UI/session prep (full blob never sent to JS)
RCT_EXTERN_METHOD(getKeyshareNostrPrepJSON:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// True when RNES Keychain/EncryptedSharedPreferences has `keyshare` without loading the blob
RCT_EXTERN_METHOD(hasKeyshareInSecureStorage:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
