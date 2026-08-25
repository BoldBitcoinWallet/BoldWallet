#import "BbmtBridge.h"

#if __has_include("libbbmtmobile_go.h")
#import "libbbmtmobile_go.h"
#define BBMT_STATIC 1
#else
#error "Run BBMTLib/build-dkls.sh ios to generate libbbmtmobile_go.h"
#endif

static void (*pBbmtFree)(char *);
static BOOL resolveFree(void);

static char *dupC(NSString *s) {
  if (!s) return strdup("");
  const char *u = s.UTF8String;
  return u ? strdup(u) : strdup("");
}

static NSString *wrap(char *cstr) {
  (void)resolveFree();
  if (!cstr) return @"";
  NSString *out = [NSString stringWithUTF8String:cstr] ?: @"";
  if (pBbmtFree) pBbmtFree(cstr);
  return out;
}

static BOOL resolveFree(void) {
#if BBMT_STATIC
  pBbmtFree = BbmtFree;
  return pBbmtFree != nullptr;
#else
  return NO;
#endif
}

extern "C" char *BbmtSecureRandom(int length);

static void (^s_hookBlock)(NSString *) = nil;
static void (^s_logBlock)(NSString *) = nil;

static void hook_trampoline(const char *msg) {
  if (!msg || !s_hookBlock) return;
  NSString *s = [NSString stringWithUTF8String:msg];
  if (s) s_hookBlock(s);
}

static void log_trampoline(const char *msg) {
  if (!msg || !s_logBlock) return;
  NSString *s = [NSString stringWithUTF8String:msg];
  if (s) s_logBlock(s);
}

@implementation BbmtBridge

+ (BOOL)isAvailable { return resolveFree(); }

+ (void)setHookListener:(void (^)(NSString *))listener {
  s_hookBlock = [listener copy];
  BbmtSetHookListener(listener ? hook_trampoline : NULL);
}

+ (void)setGoLogListener:(void (^)(NSString *))listener {
  s_logBlock = [listener copy];
  BbmtSetGoLogListener(listener ? log_trampoline : NULL);
}

+ (NSString *)helloDkg { return wrap(DklsHelloDkg()); }

#define BBMT_DKLS_8(NAME, FN, A, B, C, D, E, F, G, H) \
+ (NSString *)NAME:(NSString *)a parties:(NSString *)b session:(NSString *)c server:(NSString *)d chaincode:(NSString *)e sessionKey:(NSString *)f encKey:(NSString *)g decKey:(NSString *)h { \
  char *ka=dupC(a), *kb=dupC(b), *kc=dupC(c), *kd=dupC(d), *ke=dupC(e), *kf=dupC(f), *kg=dupC(g), *kh=dupC(h); \
  NSString *out = wrap(FN(ka, kb, kc, kd, ke, kf, kg, kh)); \
  free(ka); free(kb); free(kc); free(kd); free(ke); free(kf); free(kg); free(kh); return out; \
}

BBMT_DKLS_8(lanJoinKeygenWithKey, DklsLanJoinKeygen, key, parties, session, server, chaincode, sessionKey, encKey, decKey)

+ (NSString *)nostrJoinKeygenWithRelays:(NSString *)relays nsec:(NSString *)nsec peers:(NSString *)peers session:(NSString *)session sessionKey:(NSString *)sessionKey chaincode:(NSString *)chaincode {
  char *r=dupC(relays),*n=dupC(nsec),*p=dupC(peers),*s=dupC(session),*sk=dupC(sessionKey),*c=dupC(chaincode);
  NSString *out = wrap(DklsNostrJoinKeygen(r,n,p,s,sk,c));
  free(r);free(n);free(p);free(s);free(sk);free(c); return out;
}



+ (NSString *)spendingHash:(NSString *)sender receiver:(NSString *)receiver amount:(long long)amount {
  char *a=dupC(sender), *b=dupC(receiver);
  NSString *out = wrap(BbmtSpendingHash(a, b, (long long)amount));
  free(a); free(b); return out;
}
+ (NSString *)estimateFees:(NSString *)sender receiver:(NSString *)receiver amount:(long long)amount {
  char *a=dupC(sender), *b=dupC(receiver);
  NSString *out = wrap(BbmtEstimateFees(a, b, (long long)amount));
  free(a); free(b); return out;
}
+ (NSString *)localPreParams:(NSString *)ppmFile timeoutMinutes:(long)timeoutMinutes {
  char *p=dupC(ppmFile);
  NSString *out = wrap(BbmtLocalPreParams(p, (long)timeoutMinutes));
  free(p); return out;
}
+ (NSString *)getDerivedPubKey:(NSString *)hexPub hexChain:(NSString *)hexChain path:(NSString *)path isEdDSA:(BOOL)isEdDSA {
  char *a=dupC(hexPub), *b=dupC(hexChain), *c=dupC(path);
  NSString *out = wrap(BbmtGetDerivedPubKey(a, b, c, isEdDSA ? 1 : 0));
  free(a); free(b); free(c); return out;
}

+ (NSString *)publishData:(NSString *)port timeout:(NSString *)timeout enckey:(NSString *)enckey data:(NSString *)data mode:(NSString *)mode {
  char *k0=dupC(port); char *k1=dupC(timeout); char *k2=dupC(enckey); char *k3=dupC(data); char *k4=dupC(mode);
  NSString *out = wrap(BbmtPublishData(k0, k1, k2, k3, k4));
  free(k0); free(k1); free(k2); free(k3); free(k4); return out;
}
+ (NSString *)fetchData:(NSString *)url decKey:(NSString *)decKey data:(NSString *)data {
  char *k0=dupC(url); char *k1=dupC(decKey); char *k2=dupC(data);
  NSString *out = wrap(BbmtFetchData(k0, k1, k2));
  free(k0); free(k1); free(k2); return out;
}
+ (NSString *)setNetwork:(NSString *)network {
  char *k0=dupC(network);
  NSString *out = wrap(BbmtSetNetwork(k0));
  free(k0); return out;
}
+ (NSString *)getNetwork { return wrap(BbmtGetNetwork()); }
+ (NSString *)runRelay:(NSString *)port {
  char *k0=dupC(port);
  NSString *out = wrap(BbmtRunRelay(k0));
  free(k0); return out;
}
+ (NSString *)stopRelay { return wrap(BbmtStopRelay()); }
+ (NSString *)generateKeyPair { return wrap(BbmtGenerateKeyPair()); }
+ (NSString *)nostrKeypair { return wrap(BbmtNostrKeypair()); }
+ (void)disableLogs { BbmtDisableLogs(); }
+ (NSString *)spendingHashWithUTXOs:(NSString *)utxos receiver:(NSString *)receiver amount:(NSString *)amount {
  char *k0=dupC(utxos); char *k1=dupC(receiver); char *k2=dupC(amount);
  NSString *out = wrap(BbmtSpendingHashWithUTXOs(k0, k1, k2));
  free(k0); free(k1); free(k2); return out;
}
+ (NSString *)estimateFeeWithUTXOs:(NSString *)utxos receiver:(NSString *)receiver amount:(NSString *)amount change:(NSString *)change {
  char *k0=dupC(utxos); char *k1=dupC(receiver); char *k2=dupC(amount); char *k3=dupC(change);
  NSString *out = wrap(BbmtEstimateFeeWithUTXOs(k0, k1, k2, k3));
  free(k0); free(k1); free(k2); free(k3); return out;
}
+ (NSString *)aesEncrypt:(NSString *)data key:(NSString *)key {
  char *k0=dupC(data); char *k1=dupC(key);
  NSString *out = wrap(BbmtAesEncrypt(k0, k1));
  free(k0); free(k1); return out;
}
+ (NSString *)aesDecrypt:(NSString *)data key:(NSString *)key {
  char *k0=dupC(data); char *k1=dupC(key);
  NSString *out = wrap(BbmtAesDecrypt(k0, k1));
  free(k0); free(k1); return out;
}
+ (NSString *)sha256:(NSString *)message {
  char *k0=dupC(message);
  NSString *out = wrap(BbmtSha256(k0));
  free(k0); return out;
}
+ (NSString *)secureRandom:(int)length {
  return wrap(BbmtSecureRandom(length));
}
+ (NSString *)secP256k1RecoverR:(NSString *)r s:(NSString *)s v:(NSString *)v h:(NSString *)h {
  char *k0=dupC(r); char *k1=dupC(s); char *k2=dupC(v); char *k3=dupC(h);
  NSString *out = wrap(BbmtSecP256k1Recover(k0, k1, k2, k3));
  free(k0); free(k1); free(k2); free(k3); return out;
}
+ (NSString *)encodeXpub:(NSString *)hexPub hexChain:(NSString *)hexChain network:(NSString *)network {
  char *k0=dupC(hexPub); char *k1=dupC(hexChain); char *k2=dupC(network);
  NSString *out = wrap(BbmtEncodeXpub(k0, k1, k2));
  free(k0); free(k1); free(k2); return out;
}
+ (NSString *)getOutputDescriptor:(NSString *)hexPub hexChain:(NSString *)hexChain network:(NSString *)network addressType:(NSString *)addressType {
  char *k0=dupC(hexPub); char *k1=dupC(hexChain); char *k2=dupC(network); char *k3=dupC(addressType);
  NSString *out = wrap(BbmtGetOutputDescriptor(k0, k1, k2, k3));
  free(k0); free(k1); free(k2); free(k3); return out;
}
+ (NSString *)appendOutputDescriptorChecksum:(NSString *)descriptorBody {
  char *k0=dupC(descriptorBody);
  NSString *out = wrap(BbmtAppendOutputDescriptorChecksum(k0));
  free(k0); return out;
}
+ (NSString *)pubToP2WPKH:(NSString *)pub network:(NSString *)network {
  char *k0=dupC(pub); char *k1=dupC(network);
  NSString *out = wrap(BbmtPubToP2WPKH(k0, k1));
  free(k0); free(k1); return out;
}
+ (NSString *)pubToP2SHP2WKH:(NSString *)pub network:(NSString *)network {
  char *k0=dupC(pub); char *k1=dupC(network);
  NSString *out = wrap(BbmtPubToP2SHP2WKH(k0, k1));
  free(k0); free(k1); return out;
}
+ (NSString *)pubToP2TR:(NSString *)pub network:(NSString *)network {
  char *k0=dupC(pub); char *k1=dupC(network);
  NSString *out = wrap(BbmtPubToP2TR(k0, k1));
  free(k0); free(k1); return out;
}
+ (NSString *)pubToP2KH:(NSString *)pub network:(NSString *)network {
  char *k0=dupC(pub); char *k1=dupC(network);
  NSString *out = wrap(BbmtPubToP2KH(k0, k1));
  free(k0); free(k1); return out;
}
+ (NSString *)useFeePolicy:(NSString *)policy {
  char *k0=dupC(policy);
  NSString *out = wrap(BbmtUseFeePolicy(k0));
  free(k0); return out;
}
+ (NSString *)useAPI:(NSString *)network base:(NSString *)base {
  char *k0=dupC(network); char *k1=dupC(base);
  NSString *out = wrap(BbmtUseAPI(k0, k1));
  free(k0); free(k1); return out;
}
+ (NSString *)useFeeAPIs:(NSString *)urls {
  char *k0=dupC(urls);
  NSString *out = wrap(BbmtUseFeeAPIs(k0));
  free(k0); return out;
}
+ (NSString *)totalUTXO:(NSString *)address {
  char *k0=dupC(address);
  NSString *out = wrap(BbmtTotalUTXO(k0));
  free(k0); return out;
}
+ (NSString *)hexToNpub:(NSString *)hexKey {
  char *k0=dupC(hexKey);
  NSString *out = wrap(BbmtHexToNpub(k0));
  free(k0); return out;
}
+ (NSString *)postTx:(NSString *)rawTx {
  char *k0=dupC(rawTx);
  NSString *out = wrap(BbmtPostTx(k0));
  free(k0); return out;
}
+ (NSString *)computeTxId:(NSString *)rawTx {
  char *k0=dupC(rawTx);
  NSString *out = wrap(BbmtComputeTxId(k0));
  free(k0); return out;
}
+ (NSString *)parsePSBTDetails:(NSString *)psbt {
  char *k0=dupC(psbt);
  NSString *out = wrap(BbmtParsePSBTDetails(k0));
  free(k0); return out;
}
+ (NSString *)psbtIdentityHash:(NSString *)psbt {
  char *k0=dupC(psbt);
  NSString *out = wrap(BbmtPsbtIdentityHash(k0));
  free(k0); return out;
}

+ (NSString *)listenForPeers:(NSString *)partyId pubkey:(NSString *)pubkey port:(NSString *)port timeout:(NSString *)timeout mode:(NSString *)mode {
  char *a=dupC(partyId),*b=dupC(pubkey),*c=dupC(port),*d=dupC(timeout),*e=dupC(mode);
  NSString *out = wrap(BbmtListenForPeers(a,b,c,d,e)); free(a);free(b);free(c);free(d);free(e); return out;
}
+ (NSString *)discoverPeers:(NSString *)partyId pubkey:(NSString *)pubkey localIP:(NSString *)localIP remoteIPs:(NSString *)remoteIPs port:(NSString *)port timeout:(NSString *)timeout mode:(NSString *)mode {
  char *a=dupC(partyId),*b=dupC(pubkey),*c=dupC(localIP),*d=dupC(remoteIPs),*e=dupC(port),*f=dupC(timeout),*g=dupC(mode);
  NSString *out = wrap(BbmtDiscoverPeers(a,b,c,d,e,f,g)); free(a);free(b);free(c);free(d);free(e);free(f);free(g); return out;
}
+ (NSString *)joinKeygen:(NSString *)ppmPath key:(NSString *)key parties:(NSString *)parties encKey:(NSString *)encKey decKey:(NSString *)decKey session:(NSString *)session server:(NSString *)server chaincode:(NSString *)chaincode sessionKey:(NSString *)sessionKey {
  char *p=dupC(ppmPath),*k=dupC(key),*pa=dupC(parties),*ek=dupC(encKey),*dk=dupC(decKey),*s=dupC(session),*sv=dupC(server),*c=dupC(chaincode),*sk=dupC(sessionKey);
  NSString *out = wrap(BbmtJoinKeygen(p,k,pa,ek,dk,s,sv,c,sk));
  free(p);free(k);free(pa);free(ek);free(dk);free(s);free(sv);free(c);free(sk); return out;
}
+ (NSString *)nostrJoinKeygen:(NSString *)relays nsec:(NSString *)nsec peers:(NSString *)peers session:(NSString *)session sessionKey:(NSString *)sessionKey chaincode:(NSString *)chaincode ppmPath:(NSString *)ppmPath {
  char *r=dupC(relays),*n=dupC(nsec),*p=dupC(peers),*s=dupC(session),*sk=dupC(sessionKey),*c=dupC(chaincode),*pp=dupC(ppmPath);
  NSString *out = wrap(BbmtNostrJoinKeygen(r,n,p,s,sk,c,pp));
  free(r);free(n);free(p);free(s);free(sk);free(c);free(pp); return out;
}
+ (NSString *)nostrJoinKeysign:(NSString *)relays nsec:(NSString *)nsec peers:(NSString *)peers session:(NSString *)session sessionKey:(NSString *)sessionKey keyshare:(NSString *)keyshare derivePath:(NSString *)derivePath message:(NSString *)message {
  char *r=dupC(relays),*n=dupC(nsec),*p=dupC(peers),*s=dupC(session),*sk=dupC(sessionKey),*ks=dupC(keyshare),*dp=dupC(derivePath),*m=dupC(message);
  NSString *out = wrap(BbmtNostrJoinKeysign(r,n,p,s,sk,ks,dp,m));
  free(r);free(n);free(p);free(s);free(sk);free(ks);free(dp);free(m); return out;
}
+ (NSString *)mpcSignPSBT:(NSString *)server key:(NSString *)key parties:(NSString *)parties session:(NSString *)session sessionKey:(NSString *)sessionKey encKey:(NSString *)encKey decKey:(NSString *)decKey keyshare:(NSString *)keyshare psbt:(NSString *)psbt {
  char *sv=dupC(server),*k=dupC(key),*p=dupC(parties),*s=dupC(session),*sk=dupC(sessionKey),*ek=dupC(encKey),*dk=dupC(decKey),*ks=dupC(keyshare),*pb=dupC(psbt);
  NSString *out = wrap(BbmtMpcSignPSBT(sv,k,p,s,sk,ek,dk,ks,pb));
  free(sv);free(k);free(p);free(s);free(sk);free(ek);free(dk);free(ks);free(pb); return out;
}
+ (NSString *)mpcSendBTCWithUTXOs:(NSString *)server key:(NSString *)key parties:(NSString *)parties session:(NSString *)session sessionKey:(NSString *)sessionKey encKey:(NSString *)encKey decKey:(NSString *)decKey keyshare:(NSString *)keyshare btcPub:(NSString *)btcPub receiver:(NSString *)receiver amount:(NSString *)amount fees:(NSString *)fees utxos:(NSString *)utxos change:(NSString *)change {
  char *sv=dupC(server),*k=dupC(key),*p=dupC(parties),*s=dupC(session),*sk=dupC(sessionKey),*ek=dupC(encKey),*dk=dupC(decKey),*ks=dupC(keyshare),*bp=dupC(btcPub),*ra=dupC(receiver),*am=dupC(amount),*fe=dupC(fees),*ut=dupC(utxos),*ch=dupC(change);
  NSString *out = wrap(BbmtMpcSendBTCWithUTXOs(sv,k,p,s,sk,ek,dk,ks,bp,ra,am,fe,ut,ch));
  free(sv);free(k);free(p);free(s);free(sk);free(ek);free(dk);free(ks);free(bp);free(ra);free(am);free(fe);free(ut);free(ch); return out;
}
+ (NSString *)nostrMpcSendBTCWithUTXOs:(NSString *)relays nsec:(NSString *)nsec parties:(NSString *)parties npubsSorted:(NSString *)npubsSorted balance:(NSString *)balance keyshare:(NSString *)keyshare receiver:(NSString *)receiver amount:(NSString *)amount fees:(NSString *)fees utxos:(NSString *)utxos change:(NSString *)change {
  char *r=dupC(relays),*n=dupC(nsec),*p=dupC(parties),*ns=dupC(npubsSorted),*b=dupC(balance),*ks=dupC(keyshare),*ra=dupC(receiver),*am=dupC(amount),*fe=dupC(fees),*ut=dupC(utxos),*ch=dupC(change);
  NSString *out = wrap(BbmtNostrMpcSendBTCWithUTXOs(r,n,p,ns,b,ks,ra,am,fe,ut,ch));
  free(r);free(n);free(p);free(ns);free(b);free(ks);free(ra);free(am);free(fe);free(ut);free(ch); return out;
}
+ (NSString *)nostrMpcSignPSBT:(NSString *)relays nsec:(NSString *)nsec parties:(NSString *)parties npubsSorted:(NSString *)npubsSorted keyshare:(NSString *)keyshare psbt:(NSString *)psbt {
  char *r=dupC(relays),*n=dupC(nsec),*p=dupC(parties),*ns=dupC(npubsSorted),*ks=dupC(keyshare),*pb=dupC(psbt);
  NSString *out = wrap(BbmtNostrMpcSignPSBT(r,n,p,ns,ks,pb));
  free(r);free(n);free(p);free(ns);free(ks);free(pb); return out;
}

+ (NSString *)mpcSignPsbtWithServer:(NSString *)server key:(NSString *)key parties:(NSString *)parties session:(NSString *)session sessionKey:(NSString *)sessionKey encKey:(NSString *)encKey decKey:(NSString *)decKey keyshare:(NSString *)keyshare psbt:(NSString *)psbt {
  char *sv=dupC(server),*k=dupC(key),*p=dupC(parties),*s=dupC(session),*sk=dupC(sessionKey),*ek=dupC(encKey),*dk=dupC(decKey),*ks=dupC(keyshare),*pb=dupC(psbt);
  NSString *out = wrap(DklsMpcSignPSBT(sv,k,p,s,sk,ek,dk,ks,pb));
  free(sv);free(k);free(p);free(s);free(sk);free(ek);free(dk);free(ks);free(pb); return out;
}

+ (NSString *)nostrMpcSignPsbtWithRelays:(NSString *)relays nsec:(NSString *)nsec parties:(NSString *)parties npubsSorted:(NSString *)npubsSorted keyshare:(NSString *)keyshare psbt:(NSString *)psbt {
  char *r=dupC(relays),*n=dupC(nsec),*p=dupC(parties),*ns=dupC(npubsSorted),*ks=dupC(keyshare),*pb=dupC(psbt);
  NSString *out = wrap(DklsNostrMpcSignPSBT(r,n,p,ns,ks,pb));
  free(r);free(n);free(p);free(ns);free(ks);free(pb); return out;
}

+ (NSString *)mpcSendBtcWithServer:(NSString *)server key:(NSString *)key parties:(NSString *)parties session:(NSString *)session sessionKey:(NSString *)sessionKey encKey:(NSString *)encKey decKey:(NSString *)decKey keyshare:(NSString *)keyshare btcPub:(NSString *)btcPub toAddress:(NSString *)toAddress amount:(NSString *)amount fees:(NSString *)fees utxos:(NSString *)utxos change:(NSString *)change {
  char *sv=dupC(server),*k=dupC(key),*p=dupC(parties),*s=dupC(session),*sk=dupC(sessionKey),*ek=dupC(encKey),*dk=dupC(decKey),*ks=dupC(keyshare),*bp=dupC(btcPub),*ta=dupC(toAddress),*am=dupC(amount),*fe=dupC(fees),*ut=dupC(utxos),*ch=dupC(change);
  NSString *out = wrap(DklsMpcSendBTCWithUTXOs(sv,k,p,s,sk,ek,dk,ks,bp,ta,am,fe,ut,ch));
  free(sv);free(k);free(p);free(s);free(sk);free(ek);free(dk);free(ks);free(bp);free(ta);free(am);free(fe);free(ut);free(ch); return out;
}

+ (NSString *)nostrMpcSendBtcWithRelays:(NSString *)relays nsec:(NSString *)nsec parties:(NSString *)parties npubsSorted:(NSString *)npubsSorted balance:(NSString *)balance keyshare:(NSString *)keyshare toAddress:(NSString *)toAddress amount:(NSString *)amount fees:(NSString *)fees utxos:(NSString *)utxos change:(NSString *)change {
  char *r=dupC(relays),*n=dupC(nsec),*p=dupC(parties),*ns=dupC(npubsSorted),*b=dupC(balance),*ks=dupC(keyshare),*ta=dupC(toAddress),*am=dupC(amount),*fe=dupC(fees),*ut=dupC(utxos),*ch=dupC(change);
  NSString *out = wrap(DklsNostrMpcSendBTCWithUTXOs(r,n,p,ns,b,ks,ta,am,fe,ut,ch));
  free(r);free(n);free(p);free(ns);free(b);free(ks);free(ta);free(am);free(fe);free(ut);free(ch); return out;
}

+ (NSString *)cancelMpcSession:(NSString *)sessionID {
  char *s = dupC(sessionID);
  NSString *out = wrap(BbmtCancelMpcSession(s));
  free(s);
  return out;
}

+ (NSString *)cancelNostrMpc {
  return wrap(BbmtCancelNostrMpc());
}

@end
