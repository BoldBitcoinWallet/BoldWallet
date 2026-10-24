#pragma once

#include <jni.h>

#include <initializer_list>

// Declared in libbbmtmobile.h — include that header once per .cpp before this file.
extern void BbmtFree(char *p);

// F11: null + oversize guard for jstring bridge args. Null from Kotlin is
// JNI-fatal in GetStringUTFChars, and an unchecked arg would copy unbounded
// memory before Go's 8 MiB seam cap rejects it. Callers return a typed
// "error:..." jstring when this is false. The 16 MiB ceiling sits above
// Go's cap so no legitimately-sized arg is rejected here.
constexpr jsize kBbmtJniMaxStringBytes = 16 * 1024 * 1024;

inline bool bbmt_jni_check_strings(JNIEnv *env, std::initializer_list<jstring> strs) {
  for (jstring s : strs) {
    if (s == nullptr) {
      return false;
    }
    if (env->GetStringUTFLength(s) > kBbmtJniMaxStringBytes) {
      return false;
    }
  }
  return true;
}

// Convert a Go-exported C string to a jstring and release with BbmtFree (DklsFree is an alias).
inline jstring bbmt_jni_to_jstring(JNIEnv *env, char *cstr) {
  if (cstr == nullptr) {
    return env->NewStringUTF("");
  }
  jstring out = env->NewStringUTF(cstr);
  BbmtFree(cstr);
  return out;
}
