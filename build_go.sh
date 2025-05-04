export PATH="/usr/local/go/bin:${PATH}"
export ANDROID_HOME="/android-sdk"
#export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/android-ndk-r21e"
export PATH="$ANDROID_HOME/cmdline-tools/bin:$PATH"

cd /BoldWallet/BBMTLib
export PATH="$HOME/go/bin:$PATH"
go mod tidy
go install golang.org/x/mobile/cmd/gomobile@latest
go get golang.org/x/mobile/bind
gomobile init
export GOFLAGS="-mod=mod"
gomobile bind -v -target=android -androidapi 21 github.com/BoldBitcoinWallet/BBMTLib/tss
