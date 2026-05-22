#!/usr/bin/env bash
# Writes .vscode/c_cpp_properties.json for Android JNI (ndkls_jni / bbmt_tss_jni).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="${ROOT}/android"
VSCODE_DIR="${ROOT}/.vscode"
LOCAL_PROPS="${ANDROID_DIR}/local.properties"
NDK_VER="${NDK_VERSION:-27.1.12297006}"

sdk_dir() {
  if [ -n "${ANDROID_HOME:-}" ]; then
    echo "${ANDROID_HOME}"
    return
  fi
  if [ -f "${LOCAL_PROPS}" ]; then
    local line
    line="$(grep -E '^sdk\.dir=' "${LOCAL_PROPS}" | head -1 || true)"
    line="${line#sdk.dir=}"
    echo "${line//\\/\/}"
    return
  fi
  echo "${HOME}/Library/Android/sdk"
}

SDK="$(sdk_dir)"
NDK="${SDK}/ndk/${NDK_VER}"
if [ ! -d "${NDK}" ]; then
  NDK="$(ls -d "${SDK}"/ndk/*/ 2>/dev/null | sort -V | tail -1)"
  NDK="${NDK%/}"
fi
if [ ! -d "${NDK}" ]; then
  echo "Android NDK not found under ${SDK}/ndk (tried ${NDK_VER})" >&2
  exit 1
fi

PREBUILT="$(ls "${NDK}/toolchains/llvm/prebuilt" 2>/dev/null | head -1)"
SYSROOT_REL="ndk/${NDK_VER}/toolchains/llvm/prebuilt/${PREBUILT}/sysroot/usr/include"
ABI_REL="${SYSROOT_REL}/aarch64-linux-android"
CLANG_REL="ndk/${NDK_VER}/toolchains/llvm/prebuilt/${PREBUILT}/bin/aarch64-linux-android24-clang++"
if [ ! -x "${NDK}/toolchains/llvm/prebuilt/${PREBUILT}/bin/aarch64-linux-android24-clang++" ]; then
  CLANG_REL="ndk/${NDK_VER}/toolchains/llvm/prebuilt/${PREBUILT}/bin/clang++"
fi

mkdir -p "${VSCODE_DIR}"
cat > "${VSCODE_DIR}/c_cpp_properties.json" <<EOF
{
  "configurations": [
    {
      "name": "Android JNI (arm64-v8a)",
      "includePath": [
        "\${workspaceFolder}/android/app/src/main/cpp",
        "\${workspaceFolder}/android/app/src/main/jniLibs/arm64-v8a",
        "\${env:ANDROID_HOME}/${SYSROOT_REL}",
        "\${env:ANDROID_HOME}/${ABI_REL}"
      ],
      "defines": ["ANDROID"],
      "compilerPath": "\${env:ANDROID_HOME}/${CLANG_REL}",
      "cStandard": "c17",
      "cppStandard": "c++17",
      "intelliSenseMode": "linux-clang-arm64"
    }
  ],
  "version": 4
}
EOF

echo "Wrote ${VSCODE_DIR}/c_cpp_properties.json (NDK ${NDK_VER}, prebuilt ${PREBUILT})"
echo "Set ANDROID_HOME=${SDK} in your shell or IDE env if IntelliSense still fails."
