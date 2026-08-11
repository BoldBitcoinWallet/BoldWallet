#include <jni.h>

#include <libbbmtmobile.h>

#include "bbmt_jni_string.h"

#define to_jstring bbmt_jni_to_jstring

extern "C" {

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtSetNetworkJni(JNIEnv *env, jclass, jstring network) {
  const char *n = env->GetStringUTFChars(network, nullptr);
  jstring out = to_jstring(env, BbmtSetNetwork(const_cast<char *>(n)));
  env->ReleaseStringUTFChars(network, n);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtGetNetworkJni(JNIEnv *env, jclass) {
  return to_jstring(env, BbmtGetNetwork());
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtUseFeePolicyJni(JNIEnv *env, jclass, jstring policy) {
  const char *p = env->GetStringUTFChars(policy, nullptr);
  jstring out = to_jstring(env, BbmtUseFeePolicy(const_cast<char *>(p)));
  env->ReleaseStringUTFChars(policy, p);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtUseAPIJni(JNIEnv *env, jclass, jstring network, jstring base) {
  const char *n = env->GetStringUTFChars(network, nullptr);
  const char *b = env->GetStringUTFChars(base, nullptr);
  jstring out = to_jstring(env, BbmtUseAPI(const_cast<char *>(n), const_cast<char *>(b)));
  env->ReleaseStringUTFChars(network, n);
  env->ReleaseStringUTFChars(base, b);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtUseFeeAPIsJni(JNIEnv *env, jclass, jstring urls) {
  const char *u = env->GetStringUTFChars(urls, nullptr);
  jstring out = to_jstring(env, BbmtUseFeeAPIs(const_cast<char *>(u)));
  env->ReleaseStringUTFChars(urls, u);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtTotalUTXOJni(JNIEnv *env, jclass, jstring address) {
  const char *a = env->GetStringUTFChars(address, nullptr);
  jstring out = to_jstring(env, BbmtTotalUTXO(const_cast<char *>(a)));
  env->ReleaseStringUTFChars(address, a);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtSpendingHashJni(
    JNIEnv *env, jclass, jstring sender, jstring receiver, jlong amount) {
  const char *s = env->GetStringUTFChars(sender, nullptr);
  const char *r = env->GetStringUTFChars(receiver, nullptr);
  jstring out = to_jstring(env, BbmtSpendingHash(const_cast<char *>(s), const_cast<char *>(r), amount));
  env->ReleaseStringUTFChars(sender, s);
  env->ReleaseStringUTFChars(receiver, r);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtSpendingHashWithUTXOsJni(
    JNIEnv *env, jclass, jstring utxos, jstring receiver, jstring amount) {
  const char *u = env->GetStringUTFChars(utxos, nullptr);
  const char *r = env->GetStringUTFChars(receiver, nullptr);
  const char *a = env->GetStringUTFChars(amount, nullptr);
  jstring out = to_jstring(env, BbmtSpendingHashWithUTXOs(
      const_cast<char *>(u), const_cast<char *>(r), const_cast<char *>(a)));
  env->ReleaseStringUTFChars(utxos, u);
  env->ReleaseStringUTFChars(receiver, r);
  env->ReleaseStringUTFChars(amount, a);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtEstimateFeesJni(
    JNIEnv *env, jclass, jstring sender, jstring receiver, jlong amount) {
  const char *s = env->GetStringUTFChars(sender, nullptr);
  const char *r = env->GetStringUTFChars(receiver, nullptr);
  jstring out = to_jstring(env, BbmtEstimateFees(const_cast<char *>(s), const_cast<char *>(r), amount));
  env->ReleaseStringUTFChars(sender, s);
  env->ReleaseStringUTFChars(receiver, r);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtEstimateFeeWithUTXOsJni(
    JNIEnv *env, jclass, jstring utxos, jstring receiver, jstring amount, jstring change) {
  const char *u = env->GetStringUTFChars(utxos, nullptr);
  const char *r = env->GetStringUTFChars(receiver, nullptr);
  const char *a = env->GetStringUTFChars(amount, nullptr);
  const char *c = env->GetStringUTFChars(change, nullptr);
  jstring out = to_jstring(env, BbmtEstimateFeeWithUTXOs(
      const_cast<char *>(u), const_cast<char *>(r), const_cast<char *>(a), const_cast<char *>(c)));
  env->ReleaseStringUTFChars(utxos, u);
  env->ReleaseStringUTFChars(receiver, r);
  env->ReleaseStringUTFChars(amount, a);
  env->ReleaseStringUTFChars(change, c);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtPostTxJni(JNIEnv *env, jclass, jstring rawTx) {
  const char *t = env->GetStringUTFChars(rawTx, nullptr);
  jstring out = to_jstring(env, BbmtPostTx(const_cast<char *>(t)));
  env->ReleaseStringUTFChars(rawTx, t);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtComputeTxIdJni(JNIEnv *env, jclass, jstring rawTx) {
  const char *t = env->GetStringUTFChars(rawTx, nullptr);
  jstring out = to_jstring(env, BbmtComputeTxId(const_cast<char *>(t)));
  env->ReleaseStringUTFChars(rawTx, t);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtAesEncryptJni(JNIEnv *env, jclass, jstring data, jstring key) {
  const char *d = env->GetStringUTFChars(data, nullptr);
  const char *k = env->GetStringUTFChars(key, nullptr);
  jstring out = to_jstring(env, BbmtAesEncrypt(const_cast<char *>(d), const_cast<char *>(k)));
  env->ReleaseStringUTFChars(data, d);
  env->ReleaseStringUTFChars(key, k);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtAesDecryptJni(JNIEnv *env, jclass, jstring data, jstring key) {
  const char *d = env->GetStringUTFChars(data, nullptr);
  const char *k = env->GetStringUTFChars(key, nullptr);
  jstring out = to_jstring(env, BbmtAesDecrypt(const_cast<char *>(d), const_cast<char *>(k)));
  env->ReleaseStringUTFChars(data, d);
  env->ReleaseStringUTFChars(key, k);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtSecP256k1RecoverJni(
    JNIEnv *env, jclass, jstring r, jstring s, jstring v, jstring h) {
  const char *rs = env->GetStringUTFChars(r, nullptr);
  const char *ss = env->GetStringUTFChars(s, nullptr);
  const char *vs = env->GetStringUTFChars(v, nullptr);
  const char *hs = env->GetStringUTFChars(h, nullptr);
  jstring out = to_jstring(env, BbmtSecP256k1Recover(
      const_cast<char *>(rs), const_cast<char *>(ss), const_cast<char *>(vs), const_cast<char *>(hs)));
  env->ReleaseStringUTFChars(r, rs);
  env->ReleaseStringUTFChars(s, ss);
  env->ReleaseStringUTFChars(v, vs);
  env->ReleaseStringUTFChars(h, hs);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtGetDerivedPubKeyJni(
    JNIEnv *env, jclass, jstring hexPub, jstring hexChain, jstring path, jint isEdDSA) {
  const char *p = env->GetStringUTFChars(hexPub, nullptr);
  const char *c = env->GetStringUTFChars(hexChain, nullptr);
  const char *pt = env->GetStringUTFChars(path, nullptr);
  jstring out = to_jstring(env, BbmtGetDerivedPubKey(
      const_cast<char *>(p), const_cast<char *>(c), const_cast<char *>(pt), isEdDSA));
  env->ReleaseStringUTFChars(hexPub, p);
  env->ReleaseStringUTFChars(hexChain, c);
  env->ReleaseStringUTFChars(path, pt);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtEncodeXpubJni(
    JNIEnv *env, jclass, jstring hexPub, jstring hexChain, jstring network) {
  const char *p = env->GetStringUTFChars(hexPub, nullptr);
  const char *c = env->GetStringUTFChars(hexChain, nullptr);
  const char *n = env->GetStringUTFChars(network, nullptr);
  jstring out = to_jstring(env, BbmtEncodeXpub(
      const_cast<char *>(p), const_cast<char *>(c), const_cast<char *>(n)));
  env->ReleaseStringUTFChars(hexPub, p);
  env->ReleaseStringUTFChars(hexChain, c);
  env->ReleaseStringUTFChars(network, n);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtGetOutputDescriptorJni(
    JNIEnv *env, jclass, jstring hexPub, jstring hexChain, jstring network, jstring addressType) {
  const char *p = env->GetStringUTFChars(hexPub, nullptr);
  const char *c = env->GetStringUTFChars(hexChain, nullptr);
  const char *n = env->GetStringUTFChars(network, nullptr);
  const char *a = env->GetStringUTFChars(addressType, nullptr);
  jstring out = to_jstring(env, BbmtGetOutputDescriptor(
      const_cast<char *>(p), const_cast<char *>(c), const_cast<char *>(n), const_cast<char *>(a)));
  env->ReleaseStringUTFChars(hexPub, p);
  env->ReleaseStringUTFChars(hexChain, c);
  env->ReleaseStringUTFChars(network, n);
  env->ReleaseStringUTFChars(addressType, a);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtAppendOutputDescriptorChecksumJni(JNIEnv *env, jclass, jstring descriptor) {
  const char *d = env->GetStringUTFChars(descriptor, nullptr);
  jstring out = to_jstring(env, BbmtAppendOutputDescriptorChecksum(const_cast<char *>(d)));
  env->ReleaseStringUTFChars(descriptor, d);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtPubToP2WPKHJni(JNIEnv *env, jclass, jstring pub, jstring network) {
  const char *p = env->GetStringUTFChars(pub, nullptr);
  const char *n = env->GetStringUTFChars(network, nullptr);
  jstring out = to_jstring(env, BbmtPubToP2WPKH(const_cast<char *>(p), const_cast<char *>(n)));
  env->ReleaseStringUTFChars(pub, p);
  env->ReleaseStringUTFChars(network, n);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtPubToP2SHP2WKHJni(JNIEnv *env, jclass, jstring pub, jstring network) {
  const char *p = env->GetStringUTFChars(pub, nullptr);
  const char *n = env->GetStringUTFChars(network, nullptr);
  jstring out = to_jstring(env, BbmtPubToP2SHP2WKH(const_cast<char *>(p), const_cast<char *>(n)));
  env->ReleaseStringUTFChars(pub, p);
  env->ReleaseStringUTFChars(network, n);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtPubToP2TRJni(JNIEnv *env, jclass, jstring pub, jstring network) {
  const char *p = env->GetStringUTFChars(pub, nullptr);
  const char *n = env->GetStringUTFChars(network, nullptr);
  jstring out = to_jstring(env, BbmtPubToP2TR(const_cast<char *>(p), const_cast<char *>(n)));
  env->ReleaseStringUTFChars(pub, p);
  env->ReleaseStringUTFChars(network, n);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtPubToP2KHJni(JNIEnv *env, jclass, jstring pub, jstring network) {
  const char *p = env->GetStringUTFChars(pub, nullptr);
  const char *n = env->GetStringUTFChars(network, nullptr);
  jstring out = to_jstring(env, BbmtPubToP2KH(const_cast<char *>(p), const_cast<char *>(n)));
  env->ReleaseStringUTFChars(pub, p);
  env->ReleaseStringUTFChars(network, n);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtLocalPreParamsJni(
    JNIEnv *env, jclass, jstring ppmFile, jlong timeoutMinutes) {
  const char *f = env->GetStringUTFChars(ppmFile, nullptr);
  jstring out = to_jstring(env, BbmtLocalPreParams(const_cast<char *>(f), timeoutMinutes));
  env->ReleaseStringUTFChars(ppmFile, f);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtJoinKeygenJni(
    JNIEnv *env, jclass, jstring ppmPath, jstring key, jstring parties, jstring encKey,
    jstring decKey, jstring session, jstring server, jstring chaincode, jstring sessionKey) {
  const char *ppm = env->GetStringUTFChars(ppmPath, nullptr);
  const char *k = env->GetStringUTFChars(key, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *ek = env->GetStringUTFChars(encKey, nullptr);
  const char *dk = env->GetStringUTFChars(decKey, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sv = env->GetStringUTFChars(server, nullptr);
  const char *c = env->GetStringUTFChars(chaincode, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  char *out = BbmtJoinKeygen(
      const_cast<char *>(ppm), const_cast<char *>(k), const_cast<char *>(p),
      const_cast<char *>(ek), const_cast<char *>(dk), const_cast<char *>(s),
      const_cast<char *>(sv), const_cast<char *>(c), const_cast<char *>(sk));
  env->ReleaseStringUTFChars(ppmPath, ppm);
  env->ReleaseStringUTFChars(key, k);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(encKey, ek);
  env->ReleaseStringUTFChars(decKey, dk);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(server, sv);
  env->ReleaseStringUTFChars(chaincode, c);
  env->ReleaseStringUTFChars(sessionKey, sk);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrKeypairJni(JNIEnv *env, jclass) {
  return to_jstring(env, BbmtNostrKeypair());
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtHexToNpubJni(JNIEnv *env, jclass, jstring hexKey) {
  const char *h = env->GetStringUTFChars(hexKey, nullptr);
  jstring out = to_jstring(env, BbmtHexToNpub(const_cast<char *>(h)));
  env->ReleaseStringUTFChars(hexKey, h);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrJoinKeygenJni(
    JNIEnv *env, jclass, jstring relays, jstring nsec, jstring peers, jstring session,
    jstring sessionKey, jstring chaincode, jstring ppmPath) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *p = env->GetStringUTFChars(peers, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *c = env->GetStringUTFChars(chaincode, nullptr);
  const char *ppm = env->GetStringUTFChars(ppmPath, nullptr);
  char *out = BbmtNostrJoinKeygen(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(p),
      const_cast<char *>(s), const_cast<char *>(sk), const_cast<char *>(c), const_cast<char *>(ppm));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(peers, p);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(sessionKey, sk);
  env->ReleaseStringUTFChars(chaincode, c);
  env->ReleaseStringUTFChars(ppmPath, ppm);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrJoinKeysignJni(
    JNIEnv *env, jclass, jstring relays, jstring nsec, jstring peers, jstring session,
    jstring sessionKey, jstring keyshare, jstring derivePath, jstring message) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *p = env->GetStringUTFChars(peers, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *dp = env->GetStringUTFChars(derivePath, nullptr);
  const char *m = env->GetStringUTFChars(message, nullptr);
  char *out = BbmtNostrJoinKeysign(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(p),
      const_cast<char *>(s), const_cast<char *>(sk), const_cast<char *>(ks),
      const_cast<char *>(dp), const_cast<char *>(m));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(peers, p);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(sessionKey, sk);
  env->ReleaseStringUTFChars(keyshare, ks);
  env->ReleaseStringUTFChars(derivePath, dp);
  env->ReleaseStringUTFChars(message, m);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtMpcSignPSBTJni(
    JNIEnv *env, jclass, jstring server, jstring key, jstring parties, jstring session,
    jstring sessionKey, jstring encKey, jstring decKey, jstring keyshare, jstring psbt) {
  const char *sv = env->GetStringUTFChars(server, nullptr);
  const char *k = env->GetStringUTFChars(key, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *ek = env->GetStringUTFChars(encKey, nullptr);
  const char *dk = env->GetStringUTFChars(decKey, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *pb = env->GetStringUTFChars(psbt, nullptr);
  char *out = BbmtMpcSignPSBT(
      const_cast<char *>(sv), const_cast<char *>(k), const_cast<char *>(p),
      const_cast<char *>(s), const_cast<char *>(sk), const_cast<char *>(ek),
      const_cast<char *>(dk), const_cast<char *>(ks), const_cast<char *>(pb));
  env->ReleaseStringUTFChars(server, sv);
  env->ReleaseStringUTFChars(key, k);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(sessionKey, sk);
  env->ReleaseStringUTFChars(encKey, ek);
  env->ReleaseStringUTFChars(decKey, dk);
  env->ReleaseStringUTFChars(keyshare, ks);
  env->ReleaseStringUTFChars(psbt, pb);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtMpcSendBTCWithUTXOsJni(
    JNIEnv *env, jclass, jstring server, jstring key, jstring parties, jstring session,
    jstring sessionKey, jstring encKey, jstring decKey, jstring keyshare, jstring btcPub,
    jstring receiver, jstring amount, jstring fees, jstring utxos, jstring change) {
  const char *sv = env->GetStringUTFChars(server, nullptr);
  const char *k = env->GetStringUTFChars(key, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *ek = env->GetStringUTFChars(encKey, nullptr);
  const char *dk = env->GetStringUTFChars(decKey, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *bp = env->GetStringUTFChars(btcPub, nullptr);
  const char *rc = env->GetStringUTFChars(receiver, nullptr);
  const char *am = env->GetStringUTFChars(amount, nullptr);
  const char *fe = env->GetStringUTFChars(fees, nullptr);
  const char *ut = env->GetStringUTFChars(utxos, nullptr);
  const char *ch = env->GetStringUTFChars(change, nullptr);
  char *out = BbmtMpcSendBTCWithUTXOs(
      const_cast<char *>(sv), const_cast<char *>(k), const_cast<char *>(p),
      const_cast<char *>(s), const_cast<char *>(sk), const_cast<char *>(ek),
      const_cast<char *>(dk), const_cast<char *>(ks), const_cast<char *>(bp),
      const_cast<char *>(rc), const_cast<char *>(am), const_cast<char *>(fe),
      const_cast<char *>(ut), const_cast<char *>(ch));
  env->ReleaseStringUTFChars(server, sv);
  env->ReleaseStringUTFChars(key, k);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(sessionKey, sk);
  env->ReleaseStringUTFChars(encKey, ek);
  env->ReleaseStringUTFChars(decKey, dk);
  env->ReleaseStringUTFChars(keyshare, ks);
  env->ReleaseStringUTFChars(btcPub, bp);
  env->ReleaseStringUTFChars(receiver, rc);
  env->ReleaseStringUTFChars(amount, am);
  env->ReleaseStringUTFChars(fees, fe);
  env->ReleaseStringUTFChars(utxos, ut);
  env->ReleaseStringUTFChars(change, ch);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrMpcSendBTCWithUTXOsJni(
    JNIEnv *env, jclass, jstring relays, jstring nsec, jstring parties, jstring npubsSorted,
    jstring balance, jstring keyshare, jstring receiver, jstring amount, jstring fees,
  jstring utxos, jstring change, jstring initiatorNpubHint) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *ns = env->GetStringUTFChars(npubsSorted, nullptr);
  const char *b = env->GetStringUTFChars(balance, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *rc = env->GetStringUTFChars(receiver, nullptr);
  const char *am = env->GetStringUTFChars(amount, nullptr);
  const char *fe = env->GetStringUTFChars(fees, nullptr);
  const char *ut = env->GetStringUTFChars(utxos, nullptr);
  const char *ch = env->GetStringUTFChars(change, nullptr);
    const char *ih = env->GetStringUTFChars(initiatorNpubHint, nullptr);
  char *out = BbmtNostrMpcSendBTCWithUTXOs(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(p),
      const_cast<char *>(ns), const_cast<char *>(b), const_cast<char *>(ks),
      const_cast<char *>(rc), const_cast<char *>(am), const_cast<char *>(fe),
      const_cast<char *>(ut), const_cast<char *>(ch), const_cast<char *>(ih));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(npubsSorted, ns);
  env->ReleaseStringUTFChars(balance, b);
  env->ReleaseStringUTFChars(keyshare, ks);
  env->ReleaseStringUTFChars(receiver, rc);
  env->ReleaseStringUTFChars(amount, am);
  env->ReleaseStringUTFChars(fees, fe);
  env->ReleaseStringUTFChars(utxos, ut);
  env->ReleaseStringUTFChars(change, ch);
  env->ReleaseStringUTFChars(initiatorNpubHint, ih);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrMpcSignPSBTJni(
    JNIEnv *env, jclass, jstring relays, jstring nsec, jstring parties, jstring npubsSorted,
    jstring keyshare, jstring psbt, jstring initiatorNpubHint) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *ns = env->GetStringUTFChars(npubsSorted, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *pb = env->GetStringUTFChars(psbt, nullptr);
    const char *ih = env->GetStringUTFChars(initiatorNpubHint, nullptr);
  char *out = BbmtNostrMpcSignPSBT(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(p),
      const_cast<char *>(ns), const_cast<char *>(ks), const_cast<char *>(pb), const_cast<char *>(ih));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(npubsSorted, ns);
  env->ReleaseStringUTFChars(keyshare, ks);
  env->ReleaseStringUTFChars(psbt, pb);
  env->ReleaseStringUTFChars(initiatorNpubHint, ih);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrServiceStartJni(
    JNIEnv *env, jclass, jstring relays, jstring nsec, jstring npub, jstring peers,
    jstring roomHash, jstring policyJson) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *np = env->GetStringUTFChars(npub, nullptr);
  const char *p = env->GetStringUTFChars(peers, nullptr);
  const char *rh = env->GetStringUTFChars(roomHash, nullptr);
  const char *pj = env->GetStringUTFChars(policyJson, nullptr);
  char *out = BbmtNostrServiceStart(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(np),
      const_cast<char *>(p), const_cast<char *>(rh), const_cast<char *>(pj));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(npub, np);
  env->ReleaseStringUTFChars(peers, p);
  env->ReleaseStringUTFChars(roomHash, rh);
  env->ReleaseStringUTFChars(policyJson, pj);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrServiceSubscribeJni(
    JNIEnv *env, jclass, jstring roomHash) {
  const char *rh = env->GetStringUTFChars(roomHash, nullptr);
  char *out = BbmtNostrServiceSubscribe(const_cast<char *>(rh));
  env->ReleaseStringUTFChars(roomHash, rh);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrServicePublishJni(
    JNIEnv *env, jclass, jstring roomHash, jstring payloadJson) {
  const char *rh = env->GetStringUTFChars(roomHash, nullptr);
  const char *pj = env->GetStringUTFChars(payloadJson, nullptr);
  char *out = BbmtNostrServicePublish(const_cast<char *>(rh), const_cast<char *>(pj));
  env->ReleaseStringUTFChars(roomHash, rh);
  env->ReleaseStringUTFChars(payloadJson, pj);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtNostrServiceStopJni(
    JNIEnv *env, jclass, jstring roomHash) {
  const char *rh = env->GetStringUTFChars(roomHash, nullptr);
  char *out = BbmtNostrServiceStop(const_cast<char *>(rh));
  env->ReleaseStringUTFChars(roomHash, rh);
  return to_jstring(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtCancelMpcSessionJni(JNIEnv *env, jclass, jstring sessionID) {
  const char *s = env->GetStringUTFChars(sessionID, nullptr);
  jstring out = to_jstring(env, BbmtCancelMpcSession(const_cast<char *>(s)));
  env->ReleaseStringUTFChars(sessionID, s);
  return out;
}

JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtCancelNostrMpcJni(JNIEnv *env, jclass) {
  return to_jstring(env, BbmtCancelNostrMpc());
}

JNIEXPORT void JNICALL
Java_com_boldwallet_DklsNative_bbmtDisableLogsJni(JNIEnv *, jclass) {
  BbmtDisableLogs();
}

}  // extern "C"
