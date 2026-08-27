#include <jni.h>
#include <android/log.h>
#include <mutex>
#include <stdlib.h>
#include <string.h>

// Angle brackets: per-ABI jniLibs/<abi>/libbbmtmobile.h (GoInt32 on armeabi-v7a, GoInt64 on arm64).
// Do not use quotes — cpp/libbbmtmobile.h is arm64-only (IDE convenience) and breaks v7a builds.
#include <libbbmtmobile.h>

#include "bbmt_jni_string.h"
#include "dkls_exports.h"

extern "C" char *BbmtSecureRandom(int length);

namespace {

JavaVM *g_jvm = nullptr;
jobject g_hook_module = nullptr;
jmethodID g_deliver_mpc_hook_mid = nullptr;
jmethodID g_deliver_go_log_mid = nullptr;
std::mutex g_hook_mutex;

void bbmt_hook_trampoline(const char *msg) {
  if (msg == nullptr) {
    return;
  }
  JNIEnv *env = nullptr;
  bool detach = false;
  if (g_jvm == nullptr) {
    return;
  }
  jint get_env = g_jvm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
  if (get_env == JNI_EDETACHED) {
    if (g_jvm->AttachCurrentThread(&env, nullptr) != 0) {
      return;
    }
    detach = true;
  } else if (get_env != JNI_OK) {
    return;
  }

  std::lock_guard<std::mutex> lock(g_hook_mutex);
  if (g_hook_module != nullptr && g_deliver_mpc_hook_mid != nullptr) {
    jstring jmsg = env->NewStringUTF(msg);
    if (jmsg != nullptr) {
      env->CallVoidMethod(g_hook_module, g_deliver_mpc_hook_mid, jmsg);
      env->DeleteLocalRef(jmsg);
    }
  }

  if (detach) {
    g_jvm->DetachCurrentThread();
  }
}

void bbmt_go_log_trampoline(const char *msg) {
  if (msg == nullptr) {
    return;
  }
  JNIEnv *env = nullptr;
  bool detach = false;
  if (g_jvm == nullptr) {
    return;
  }
  jint get_env = g_jvm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
  if (get_env == JNI_EDETACHED) {
    if (g_jvm->AttachCurrentThread(&env, nullptr) != 0) {
      return;
    }
    detach = true;
  } else if (get_env != JNI_OK) {
    return;
  }

  std::lock_guard<std::mutex> lock(g_hook_mutex);
  if (g_hook_module != nullptr && g_deliver_go_log_mid != nullptr) {
    jstring jmsg = env->NewStringUTF(msg);
    if (jmsg != nullptr) {
      env->CallVoidMethod(g_hook_module, g_deliver_go_log_mid, jmsg);
      env->DeleteLocalRef(jmsg);
    }
  }

  if (detach) {
    g_jvm->DetachCurrentThread();
  }
}

void clear_bbmt_hook_listener(JNIEnv *env) {
  std::lock_guard<std::mutex> lock(g_hook_mutex);
  BbmtSetHookListener(nullptr);
  BbmtSetGoLogListener(nullptr);
  if (g_hook_module != nullptr && env != nullptr) {
    env->DeleteGlobalRef(g_hook_module);
    g_hook_module = nullptr;
  }
  g_deliver_mpc_hook_mid = nullptr;
  g_deliver_go_log_mid = nullptr;
}

}  // namespace

#define to_jstring bbmt_jni_to_jstring

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_helloDkgJni(JNIEnv *env, jclass) {
  return to_jstring(env, DklsHelloDkg());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtGenerateKeyPairJni(JNIEnv *env, jclass) {
  return to_jstring(env, BbmtGenerateKeyPair());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtSha256Jni(JNIEnv *env, jclass, jstring msg) {
  const char *m = env->GetStringUTFChars(msg, nullptr);
  jstring out = to_jstring(env, BbmtSha256(const_cast<char *>(m)));
  env->ReleaseStringUTFChars(msg, m);
  return out;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtSecureRandomJni(JNIEnv *env, jclass, jint length) {
  return to_jstring(env, BbmtSecureRandom(static_cast<int>(length)));
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtFetchDataJni(
    JNIEnv *env, jclass, jstring url, jstring decKey, jstring payload) {
  const char *u = env->GetStringUTFChars(url, nullptr);
  const char *d = env->GetStringUTFChars(decKey, nullptr);
  const char *p = env->GetStringUTFChars(payload, nullptr);
  char *out = BbmtFetchData(
      const_cast<char *>(u), const_cast<char *>(d), const_cast<char *>(p));
  env->ReleaseStringUTFChars(url, u);
  env->ReleaseStringUTFChars(decKey, d);
  env->ReleaseStringUTFChars(payload, p);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtPublishDataJni(
    JNIEnv *env, jclass, jstring port, jstring timeout, jstring encKey,
    jstring data, jstring mode) {
  const char *po = env->GetStringUTFChars(port, nullptr);
  const char *to = env->GetStringUTFChars(timeout, nullptr);
  const char *ek = env->GetStringUTFChars(encKey, nullptr);
  const char *da = env->GetStringUTFChars(data, nullptr);
  const char *mo = env->GetStringUTFChars(mode, nullptr);
  char *out = BbmtPublishData(
      const_cast<char *>(po), const_cast<char *>(to), const_cast<char *>(ek),
      const_cast<char *>(da), const_cast<char *>(mo));
  env->ReleaseStringUTFChars(port, po);
  env->ReleaseStringUTFChars(timeout, to);
  env->ReleaseStringUTFChars(encKey, ek);
  env->ReleaseStringUTFChars(data, da);
  env->ReleaseStringUTFChars(mode, mo);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtListenForPeersJni(
    JNIEnv *env, jclass, jstring id, jstring pubkey, jstring port,
    jstring timeout, jstring mode) {
  const char *i = env->GetStringUTFChars(id, nullptr);
  const char *pk = env->GetStringUTFChars(pubkey, nullptr);
  const char *po = env->GetStringUTFChars(port, nullptr);
  const char *to = env->GetStringUTFChars(timeout, nullptr);
  const char *mo = env->GetStringUTFChars(mode, nullptr);
  char *out = BbmtListenForPeers(
      const_cast<char *>(i), const_cast<char *>(pk), const_cast<char *>(po),
      const_cast<char *>(to), const_cast<char *>(mo));
  env->ReleaseStringUTFChars(id, i);
  env->ReleaseStringUTFChars(pubkey, pk);
  env->ReleaseStringUTFChars(port, po);
  env->ReleaseStringUTFChars(timeout, to);
  env->ReleaseStringUTFChars(mode, mo);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtDiscoverPeersJni(
    JNIEnv *env, jclass, jstring id, jstring pubkey, jstring localIP,
    jstring remoteIP, jstring port, jstring timeout, jstring mode) {
  const char *i = env->GetStringUTFChars(id, nullptr);
  const char *pk = env->GetStringUTFChars(pubkey, nullptr);
  const char *lip = env->GetStringUTFChars(localIP, nullptr);
  const char *rip = env->GetStringUTFChars(remoteIP, nullptr);
  const char *po = env->GetStringUTFChars(port, nullptr);
  const char *to = env->GetStringUTFChars(timeout, nullptr);
  const char *mo = env->GetStringUTFChars(mode, nullptr);
  char *out = BbmtDiscoverPeers(
      const_cast<char *>(i), const_cast<char *>(pk), const_cast<char *>(lip),
      const_cast<char *>(rip), const_cast<char *>(po), const_cast<char *>(to),
      const_cast<char *>(mo));
  env->ReleaseStringUTFChars(id, i);
  env->ReleaseStringUTFChars(pubkey, pk);
  env->ReleaseStringUTFChars(localIP, lip);
  env->ReleaseStringUTFChars(remoteIP, rip);
  env->ReleaseStringUTFChars(port, po);
  env->ReleaseStringUTFChars(timeout, to);
  env->ReleaseStringUTFChars(mode, mo);
  return to_jstring(env, out);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtRunRelayJni(JNIEnv *env, jclass, jstring port) {
  const char *p = env->GetStringUTFChars(port, nullptr);
  jstring out = to_jstring(env, BbmtRunRelay(const_cast<char *>(p)));
  env->ReleaseStringUTFChars(port, p);
  return out;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtStopRelayJni(JNIEnv *env, jclass) {
  return to_jstring(env, BbmtStopRelay());
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
    jstring sessionKey,
    jstring encKey,
    jstring decKey) {
  const char *k = env->GetStringUTFChars(key, nullptr);
  const char *p = env->GetStringUTFChars(parties, nullptr);
  const char *s = env->GetStringUTFChars(session, nullptr);
  const char *sv = env->GetStringUTFChars(server, nullptr);
  const char *c = env->GetStringUTFChars(chaincode, nullptr);
  const char *sk = env->GetStringUTFChars(sessionKey, nullptr);
  const char *ek = env->GetStringUTFChars(encKey, nullptr);
  const char *dk = env->GetStringUTFChars(decKey, nullptr);
  char *out = DklsLanJoinKeygen(
      const_cast<char *>(k), const_cast<char *>(p), const_cast<char *>(s),
      const_cast<char *>(sv), const_cast<char *>(c), const_cast<char *>(sk),
      const_cast<char *>(ek), const_cast<char *>(dk));
  env->ReleaseStringUTFChars(key, k);
  env->ReleaseStringUTFChars(parties, p);
  env->ReleaseStringUTFChars(session, s);
  env->ReleaseStringUTFChars(server, sv);
  env->ReleaseStringUTFChars(chaincode, c);
  env->ReleaseStringUTFChars(sessionKey, sk);
  env->ReleaseStringUTFChars(encKey, ek);
  env->ReleaseStringUTFChars(decKey, dk);
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

extern "C" JNIEXPORT void JNICALL
Java_com_boldwallet_DklsNative_setBbmtHookListenerJni(JNIEnv *env, jclass, jobject module) {
  clear_bbmt_hook_listener(env);
  if (module == nullptr) {
    return;
  }
  env->GetJavaVM(&g_jvm);
  jclass module_cls = env->GetObjectClass(module);
  g_deliver_mpc_hook_mid =
      env->GetMethodID(module_cls, "deliverMpcHook", "(Ljava/lang/String;)V");
  g_deliver_go_log_mid =
      env->GetMethodID(module_cls, "deliverGoLog", "(Ljava/lang/String;)V");
  if (g_deliver_mpc_hook_mid == nullptr || g_deliver_go_log_mid == nullptr) {
    return;
  }
  std::lock_guard<std::mutex> lock(g_hook_mutex);
  g_hook_module = env->NewGlobalRef(module);
  BbmtSetHookListener(&bbmt_hook_trampoline);
  BbmtSetGoLogListener(&bbmt_go_log_trampoline);
}

extern "C" JNIEXPORT void JNICALL
Java_com_boldwallet_DklsNative_clearBbmtHookListenerJni(JNIEnv *env, jclass) {
  clear_bbmt_hook_listener(env);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtParsePSBTDetailsJni(JNIEnv *env, jclass, jstring psbt) {
  const char *p = env->GetStringUTFChars(psbt, nullptr);
  jstring out = to_jstring(env, BbmtParsePSBTDetails(const_cast<char *>(p)));
  env->ReleaseStringUTFChars(psbt, p);
  return out;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_boldwallet_DklsNative_bbmtPsbtIdentityHashJni(JNIEnv *env, jclass, jstring psbt) {
  const char *p = env->GetStringUTFChars(psbt, nullptr);
  jstring out = to_jstring(env, BbmtPsbtIdentityHash(const_cast<char *>(p)));
  env->ReleaseStringUTFChars(psbt, p);
  return out;
}

