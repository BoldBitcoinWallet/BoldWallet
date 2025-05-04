#!/bin/bash
set -e

export PATH="/usr/local/go/bin:${PATH}"

go version

export ANDROID_HOME="/android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/bin:$PATH"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/android-ndk-r21e"

yes | /android-sdk/cmdline-tools/bin/sdkmanager --sdk_root=$ANDROID_HOME "platforms;android-21" "build-tools;33.0.0" "ndk;25.1.8937393"