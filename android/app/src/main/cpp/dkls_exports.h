// DKLs C API from libbbmtmobile.so (unified bbmtmobile build; JNI uses Dkls* only).
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

extern char *DklsHelloDkg(void);
extern void DklsFree(char *p);
extern char *DklsLanJoinKeygen(char *key, char *parties, char *session, char *server,
                               char *chaincode, char *sessionKey, char *encKey, char *decKey);
extern char *DklsNostrJoinKeygen(char *relays, char *nsec, char *peers, char *session,
                                 char *sessionKey, char *chaincode);
extern char *DklsNostrJoinKeysign(char *relays, char *nsec, char *peers, char *session,
                                  char *sessionKey, char *keyshare, char *message);
extern char *DklsMpcSignPSBT(char *server, char *key, char *parties, char *session,
                             char *sessionKey, char *encKey, char *decKey, char *keyshare,
                             char *psbt);
extern char *DklsNostrMpcSignPSBT(char *relays, char *nsec, char *parties, char *npubsSorted,
                                  char *keyshare, char *psbt);
extern char *DklsMpcSendBTCWithUTXOs(char *server, char *key, char *parties, char *session,
                                    char *sessionKey, char *encKey, char *decKey, char *keyshare,
                                    char *btcPub, char *toAddress, char *amount, char *fees,
                                    char *utxos, char *change);
extern char *DklsNostrMpcSendBTCWithUTXOs(char *relays, char *nsec, char *parties,
                                          char *npubsSorted, char *balance, char *keyshare,
                                          char *toAddress, char *amount, char *fees,
                                          char *utxos, char *change);
extern char *DklsCancelMpcSession(char *sessionID);
extern char *DklsCancelNostrMpc(void);

#ifdef __cplusplus
}
#endif
