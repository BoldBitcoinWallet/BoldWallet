#!/bin/bash
echo "building npm install"
npm i

echo "building gomobile tss lib"
cd BBMTLIB
go mod tidy
go get golang.org/x/mobile/bind
export GOFLAGS="-mod=mod"
gomobile bind -v -target=android github.com/BoldBitcoinWallet/BBMTLib/tss
cp tss.aar ../android/app/libs/tss.aar

echo "building android apk"
cd ../android
./release.sh
