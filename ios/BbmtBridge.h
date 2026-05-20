#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Unified BBMT native bridge (single Go runtime: GG18 + DKLs23).
@interface BbmtBridge : NSObject

+ (BOOL)isAvailable;

+ (void)setHookListener:(nullable void (^)(NSString *message))listener;
+ (void)setGoLogListener:(nullable void (^)(NSString *message))listener;

// DKLs23
+ (NSString *)helloDkg;
+ (NSString *)lanJoinKeygenWithKey:(NSString *)key
                          parties:(NSString *)parties
                          session:(NSString *)session
                           server:(NSString *)server
                        chaincode:(NSString *)chaincode
                       sessionKey:(NSString *)sessionKey
                           encKey:(NSString *)encKey
                           decKey:(NSString *)decKey;
+ (NSString *)nostrJoinKeygenWithRelays:(NSString *)relays
                                  nsec:(NSString *)nsec
                                 peers:(NSString *)peers
                               session:(NSString *)session
                            sessionKey:(NSString *)sessionKey
                             chaincode:(NSString *)chaincode;
+ (NSString *)mpcSignPsbtWithServer:(NSString *)server
                                key:(NSString *)key
                            parties:(NSString *)parties
                            session:(NSString *)session
                         sessionKey:(NSString *)sessionKey
                             encKey:(NSString *)encKey
                             decKey:(NSString *)decKey
                           keyshare:(NSString *)keyshare
                               psbt:(NSString *)psbt;
+ (NSString *)nostrMpcSignPsbtWithRelays:(NSString *)relays
                                   nsec:(NSString *)nsec
                                parties:(NSString *)parties
                             npubsSorted:(NSString *)npubsSorted
                               keyshare:(NSString *)keyshare
                                   psbt:(NSString *)psbt;
+ (NSString *)mpcSendBtcWithServer:(NSString *)server
                             key:(NSString *)key
                         parties:(NSString *)parties
                         session:(NSString *)session
                      sessionKey:(NSString *)sessionKey
                          encKey:(NSString *)encKey
                          decKey:(NSString *)decKey
                        keyshare:(NSString *)keyshare
                          btcPub:(NSString *)btcPub
                       toAddress:(NSString *)toAddress
                          amount:(NSString *)amount
                            fees:(NSString *)fees
                           utxos:(NSString *)utxos
                          change:(NSString *)change;
+ (NSString *)nostrMpcSendBtcWithRelays:(NSString *)relays
                                   nsec:(NSString *)nsec
                                parties:(NSString *)parties
                             npubsSorted:(NSString *)npubsSorted
                                balance:(NSString *)balance
                               keyshare:(NSString *)keyshare
                              toAddress:(NSString *)toAddress
                                 amount:(NSString *)amount
                                   fees:(NSString *)fees
                                  utxos:(NSString *)utxos
                                 change:(NSString *)change;
+ (void)cancelMpcSession:(NSString *)sessionID;
+ (void)cancelNostrMpc;

// GG18 / shared TSS (subset used by BBMTLibNativeModule)
+ (NSString *)publishData:(NSString *)port
                  timeout:(NSString *)timeout
                   enckey:(NSString *)enckey
                     data:(NSString *)data
                     mode:(NSString *)mode;
+ (NSString *)fetchData:(NSString *)url decKey:(NSString *)decKey data:(NSString *)data;
+ (NSString *)setNetwork:(NSString *)network;
+ (NSString *)getNetwork;
+ (NSString *)spendingHash:(NSString *)sender receiver:(NSString *)receiver amount:(long long)amount;
+ (NSString *)spendingHashWithUTXOs:(NSString *)utxos receiver:(NSString *)receiver amount:(NSString *)amount;
+ (NSString *)estimateFees:(NSString *)sender receiver:(NSString *)receiver amount:(long long)amount;
+ (NSString *)estimateFeeWithUTXOs:(NSString *)utxos receiver:(NSString *)receiver amount:(NSString *)amount change:(NSString *)change;
+ (NSString *)runRelay:(NSString *)port;
+ (NSString *)stopRelay;
+ (NSString *)listenForPeers:(NSString *)partyId pubkey:(NSString *)pubkey port:(NSString *)port timeout:(NSString *)timeout mode:(NSString *)mode;
+ (NSString *)discoverPeers:(NSString *)partyId pubkey:(NSString *)pubkey localIP:(NSString *)localIP remoteIPs:(NSString *)remoteIPs port:(NSString *)port timeout:(NSString *)timeout mode:(NSString *)mode;
+ (NSString *)generateKeyPair;
+ (NSString *)aesEncrypt:(NSString *)data key:(NSString *)key;
+ (NSString *)aesDecrypt:(NSString *)data key:(NSString *)key;
+ (NSString *)sha256:(NSString *)message;
+ (NSString *)secP256k1RecoverR:(NSString *)r s:(NSString *)s v:(NSString *)v h:(NSString *)h;
+ (NSString *)getDerivedPubKey:(NSString *)hexPub hexChain:(NSString *)hexChain path:(NSString *)path isEdDSA:(BOOL)isEdDSA;
+ (NSString *)encodeXpub:(NSString *)hexPub hexChain:(NSString *)hexChain network:(NSString *)network;
+ (NSString *)getOutputDescriptor:(NSString *)hexPub hexChain:(NSString *)hexChain network:(NSString *)network addressType:(NSString *)addressType;
+ (NSString *)appendOutputDescriptorChecksum:(NSString *)descriptorBody;
+ (NSString *)pubToP2WPKH:(NSString *)pub network:(NSString *)network;
+ (NSString *)pubToP2SHP2WKH:(NSString *)pub network:(NSString *)network;
+ (NSString *)pubToP2TR:(NSString *)pub network:(NSString *)network;
+ (NSString *)pubToP2KH:(NSString *)pub network:(NSString *)network;
+ (NSString *)useFeePolicy:(NSString *)policy;
+ (NSString *)useAPI:(NSString *)network base:(NSString *)base;
+ (NSString *)useFeeAPIs:(NSString *)urls;
+ (NSString *)totalUTXO:(NSString *)address;
+ (NSString *)localPreParams:(NSString *)ppmFile timeoutMinutes:(long)timeoutMinutes;
+ (NSString *)joinKeygen:(NSString *)ppmPath key:(NSString *)key parties:(NSString *)parties encKey:(NSString *)encKey decKey:(NSString *)decKey session:(NSString *)session server:(NSString *)server chaincode:(NSString *)chaincode sessionKey:(NSString *)sessionKey;
+ (NSString *)nostrKeypair;
+ (NSString *)hexToNpub:(NSString *)hexKey;
+ (NSString *)nostrJoinKeygen:(NSString *)relays nsec:(NSString *)nsec peers:(NSString *)peers session:(NSString *)session sessionKey:(NSString *)sessionKey chaincode:(NSString *)chaincode ppmPath:(NSString *)ppmPath;
+ (NSString *)nostrJoinKeysign:(NSString *)relays nsec:(NSString *)nsec peers:(NSString *)peers session:(NSString *)session sessionKey:(NSString *)sessionKey keyshare:(NSString *)keyshare derivePath:(NSString *)derivePath message:(NSString *)message;
+ (NSString *)postTx:(NSString *)rawTx;
+ (NSString *)computeTxId:(NSString *)rawTx;
+ (void)disableLogs;
+ (NSString *)parsePSBTDetails:(NSString *)psbt;
+ (NSString *)mpcSignPSBT:(NSString *)server key:(NSString *)key parties:(NSString *)parties session:(NSString *)session sessionKey:(NSString *)sessionKey encKey:(NSString *)encKey decKey:(NSString *)decKey keyshare:(NSString *)keyshare psbt:(NSString *)psbt;
+ (NSString *)mpcSendBTCWithUTXOs:(NSString *)server key:(NSString *)key parties:(NSString *)parties session:(NSString *)session sessionKey:(NSString *)sessionKey encKey:(NSString *)encKey decKey:(NSString *)decKey keyshare:(NSString *)keyshare btcPub:(NSString *)btcPub receiver:(NSString *)receiver amount:(NSString *)amount fees:(NSString *)fees utxos:(NSString *)utxos change:(NSString *)change;
+ (NSString *)nostrMpcSendBTCWithUTXOs:(NSString *)relays nsec:(NSString *)nsec parties:(NSString *)parties npubsSorted:(NSString *)npubsSorted balance:(NSString *)balance keyshare:(NSString *)keyshare receiver:(NSString *)receiver amount:(NSString *)amount fees:(NSString *)fees utxos:(NSString *)utxos change:(NSString *)change;
+ (NSString *)nostrMpcSignPSBT:(NSString *)relays nsec:(NSString *)nsec parties:(NSString *)parties npubsSorted:(NSString *)npubsSorted keyshare:(NSString *)keyshare psbt:(NSString *)psbt;

@end

NS_ASSUME_NONNULL_END
