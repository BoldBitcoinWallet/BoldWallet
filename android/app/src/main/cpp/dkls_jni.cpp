#include <jni.h>
#include <stdlib.h>
#include <string.h>

#include "dkls_exports.h"

namespace {

jstring to_jstring(JNIEnv *env, char *cstr) {
  if (cstr == nullptr) {
    return env->NewStringUTF("");
  }
  jstring out = env->NewStringUTF(cstr);
  DklsFree(cstr);
  return out;
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_helloDkgJni(JNIEnv *env, jclass) {
  return to_jstring(env, DklsHelloDkg());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_lanJoinKeygenJni(
    JNIEnv *env,
    jclass,
    jstring key,
    jstring parties,
    jstring session,
    jstring server,
    jstring chaincode,
    jstring sessionKey) {
  const char *k = env->GetStringUTFChars(key, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sv = env->GetStringUTFChars(server, nullptr);
  const char *c = env->GetStringUTFChars(chaincode, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  char *out = DklsLanJoinKeygen(
      const_cast<char *>(k), const_cast<char *>(p), const_cast<char *>(s),
      const_cast<char *>(sv), const_cast<char *>(c), const_cast<char *>(sk));
  env->ReleaseStringUTFChars(key, k);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(server, sv);
  env->ReleaseStringUTFChars(chaincode, c);
  env->ReleaseStringUTFChars(sessionKey, sk);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_nostrJoinKeygenJni(
    JNIEnv *env,
    jclass,
    jstring relays,
    jstring nsec,
    jstring peers,
    jstring session,
    jstring sessionKey,
    jstring chaincode) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *p = env->GetStringUTFChars(peers, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *c = env->GetStringUTFChars(chaincode, nullptr);
  char *out = DklsNostrJoinKeygen(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(p),
      const_cast<char *>(s), const_cast<char *>(sk), const_cast<char *>(c));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(peers, p);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(sessionKey, sk);
  env->ReleaseStringUTFChars(chaincode, c);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_nostrJoinKeysignJni(
    JNIEnv *env,
    jclass,
    jstring relays,
    jstring nsec,
    jstring peers,
    jstring session,
    jstring sessionKey,
    jstring keyshare,
    jstring message) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *p = env->GetStringUTFChars(peers, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *m = env->GetStringUTFChars(message, nullptr);
  char *out = DklsNostrJoinKeysign(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(p),
      const_cast<char *>(s), const_cast<char *>(sk), const_cast<char *>(ks),
      const_cast<char *>(m));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(peers, p);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(sessionKey, sk);
  env->ReleaseStringUTFChars(keyshare, ks);
  env->ReleaseStringUTFChars(message, m);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_mpcSignPsbtJni(
    JNIEnv *env,
    jclass,
    jstring server,
    jstring key,
    jstring parties,
    jstring session,
    jstring sessionKey,
    jstring encKey,
    jstring decKey,
    jstring keyshare,
    jstring psbt) {
  const char *sv = env->GetStringUTFChars(server, nullptr);
  const char *k = env->GetStringUTFChars(key, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *ek = env->GetStringUTFChars(encKey, nullptr);
  const char *dk = env->GetStringUTFChars(decKey, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *pb = env->GetStringUTFChars(psbt, nullptr);
  char *out = DklsMpcSignPSBT(
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

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_nostrMpcSignPsbtJni(
    JNIEnv *env,
    jclass,
    jstring relays,
    jstring nsec,
    jstring parties,
    jstring npubsSorted,
    jstring keyshare,
    jstring psbt) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *ns = env->GetStringUTFChars(npubsSorted, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *pb = env->GetStringUTFChars(psbt, nullptr);
  char *out = DklsNostrMpcSignPSBT(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(p),
      const_cast<char *>(ns), const_cast<char *>(ks), const_cast<char *>(pb));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(npubsSorted, ns);
  env->ReleaseStringUTFChars(keyshare, ks);
  env->ReleaseStringUTFChars(psbt, pb);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_mpcSendBtcWithUtxosJni(
    JNIEnv *env,
    jclass,
    jstring server,
    jstring key,
    jstring parties,
    jstring session,
    jstring sessionKey,
    jstring encKey,
    jstring decKey,
    jstring keyshare,
    jstring btcPub,
    jstring toAddress,
    jstring amount,
    jstring fees,
    jstring utxos,
    jstring change) {
  const char *sv = env->GetStringUTFChars(server, nullptr);
  const char *k = env->GetStringUTFChars(key, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *ek = env->GetStringUTFChars(encKey, nullptr);
  const char *dk = env->GetStringUTFChars(decKey, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *bp = env->GetStringUTFChars(btcPub, nullptr);
  const char *ta = env->GetStringUTFChars(toAddress, nullptr);
  const char *am = env->GetStringUTFChars(amount, nullptr);
  const char *fe = env->GetStringUTFChars(fees, nullptr);
  const char *ut = env->GetStringUTFChars(utxos, nullptr);
  const char *ch = env->GetStringUTFChars(change, nullptr);
  char *out = DklsMpcSendBTCWithUTXOs(
      const_cast<char *>(sv), const_cast<char *>(k), const_cast<char *>(p),
      const_cast<char *>(s), const_cast<char *>(sk), const_cast<char *>(ek),
      const_cast<char *>(dk), const_cast<char *>(ks), const_cast<char *>(bp),
      const_cast<char *>(ta), const_cast<char *>(am), const_cast<char *>(fe),
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
  env->ReleaseStringUTFChars(toAddress, ta);
  env->ReleaseStringUTFChars(amount, am);
  env->ReleaseStringUTFChars(fees, fe);
  env->ReleaseStringUTFChars(utxos, ut);
  env->ReleaseStringUTFChars(change, ch);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_nostrMpcSendBtcWithUtxosJni(
    JNIEnv *env,
    jclass,
    jstring relays,
    jstring nsec,
    jstring parties,
    jstring npubsSorted,
    jstring balance,
    jstring keyshare,
    jstring toAddress,
    jstring amount,
    jstring fees,
    jstring utxos,
    jstring change) {
  const char *r = env->GetStringUTFChars(relays, nullptr);
  const char *n = env->GetStringUTFChars(nsec, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *ns = env->GetStringUTFChars(npubsSorted, nullptr);
  const char *b = env->GetStringUTFChars(balance, nullptr);
  const char *ks = env->GetStringUTFChars(keyshare, nullptr);
  const char *ta = env->GetStringUTFChars(toAddress, nullptr);
  const char *am = env->GetStringUTFChars(amount, nullptr);
  const char *fe = env->GetStringUTFChars(fees, nullptr);
  const char *ut = env->GetStringUTFChars(utxos, nullptr);
  const char *ch = env->GetStringUTFChars(change, nullptr);
  char *out = DklsNostrMpcSendBTCWithUTXOs(
      const_cast<char *>(r), const_cast<char *>(n), const_cast<char *>(p),
      const_cast<char *>(ns), const_cast<char *>(b), const_cast<char *>(ks),
      const_cast<char *>(ta), const_cast<char *>(am), const_cast<char *>(fe),
      const_cast<char *>(ut), const_cast<char *>(ch));
  env->ReleaseStringUTFChars(relays, r);
  env->ReleaseStringUTFChars(nsec, n);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(npubsSorted, ns);
  env->ReleaseStringUTFChars(balance, b);
  env->ReleaseStringUTFChars(keyshare, ks);
  env->ReleaseStringUTFChars(toAddress, ta);
  env->ReleaseStringUTFChars(amount, am);
  env->ReleaseStringUTFChars(fees, fe);
  env->ReleaseStringUTFChars(utxos, ut);
  env->ReleaseStringUTFChars(change, ch);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_cancelMpcSessionJni(JNIEnv *env, jclass, jstring sessionID) {
  const char *s = env->GetStringUTFChars(sessionID, nullptr);
  jstring out = to_jstring(env, DklsCancelMpcSession(const_cast<char *>(s)));
  env->ReleaseStringUTFChars(sessionID, s);
  return out;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_cancelNostrMpcJni(JNIEnv *env, jclass) {
  return to_jstring(env, DklsCancelNostrMpc());
}
