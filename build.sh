#!/bin/bash
echo "building npm install"
npm i

echo "building gomobile tss lib"
cd BBMTLib
go mod tidy
go get golang.org/x/mobile/bind
gomobile init
export GOFLAGS="-mod=mod"
gomobile bind -v -target=android -androidapi 21 github.com/BoldBitcoinWallet/BBMTLib/tss
cp tss.aar ../android/app/libs/tss.aar

echo "building android apk"
cd ../android
./release.sh
