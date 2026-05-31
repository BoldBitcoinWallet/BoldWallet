#pragma once

#include <jni.h>

// Declared in libbbmtmobile.h — include that header once per .cpp before this file.
extern void BbmtFree(char *p);

// Convert a Go-exported C string to a jstring and release with BbmtFree (DklsFree is an alias).
inline jstring bbmt_jni_to_jstring(JNIEnv *env, char *cstr) {
  if (cstr == nullptr) {
    return env->NewStringUTF("");
  }
  jstring out = env->NewStringUTF(cstr);
  BbmtFree(cstr);
  return out;
}
