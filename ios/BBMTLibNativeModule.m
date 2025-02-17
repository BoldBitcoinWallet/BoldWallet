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

// Pre-Params Method
RCT_EXTERN_METHOD(preparams:(NSString *)outFile timeout:(NSString *)timeout resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// Recover Public Key from Signature
RCT_EXTERN_METHOD(recoverPubkey:(NSString *)r s:(NSString *)s v:(NSString *)v h:(NSString *)h resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// Convert Public Key to Bitcoin Address
RCT_EXTERN_METHOD(p2khAddress:(NSString *)compressedPubkey network:(NSString *)network resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

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
RCT_EXTERN_METHOD(getLanIp:(NSString *)tag
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call listenForPeer
RCT_EXTERN_METHOD(listenForPeer:(NSString *)id
                  pubkey:(NSString *)pubkey
                  port:(NSString *)port
                  timeout:(NSString *)timeout
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call discoverPeer
RCT_EXTERN_METHOD(discoverPeer:(NSString *)id
                  pubkey:(NSString *)pubkey
                  localIp:(NSString *)localIp
                  port:(NSString *)port
                  timeout:(NSString *)timeout
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
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call publishData
RCT_EXTERN_METHOD(publishData:(NSString *)port
                  timeout:(NSString *)timeout
                  encKey:(NSString *)encKey
                  raw:(NSString *)raw
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call derivePubkey
RCT_EXTERN_METHOD(derivePubkey:(NSString *)hexPubkey
                  hexChaincode:(NSString *)hexChaincode
                  path:(NSString *)path
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

// Call totalUTXO
RCT_EXTERN_METHOD(totalUTXO:(NSString *)address
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call estimateFee
RCT_EXTERN_METHOD(estimateFee:(NSString *)senderAddress
                  receiverAddress:(NSString *)receiverAddress
                  amountSatoshi:(NSString *)amountSatoshi
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Call mpcSendBTC
RCT_EXTERN_METHOD(mpcSendBTC:(NSString *)server
                  partyID:(NSString *)partyID
                  partiesCSV:(NSString *)partiesCSV
                  sessionID:(NSString *)sessionID
                  sessionKey:(NSString *)sessionKey
                  encKey:(NSString *)encKey
                  decKey:(NSString *)decKey
                  keyshare:(NSString *)keyshare
                  derivation:(NSString *)derivation
                  publicKey:(NSString *)publicKey
                  senderAddress:(NSString *)senderAddress
                  receiverAddress:(NSString *)receiverAddress
                  amountSatoshi:(NSString *)amountSatoshi
                  feeSatoshi:(NSString *)feeSatoshi
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
