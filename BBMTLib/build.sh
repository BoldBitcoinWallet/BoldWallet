#!/bin/bash
echo "building gomobile tss lib"
go mod tidy

# Install gomobile if not already installed
if ! command -v gomobile &> /dev/null; then
    echo "gomobile not found, installing..."
    go install golang.org/x/mobile/cmd/gomobile@latest
    # Add Go bin directory to PATH if not already there
    export PATH="$PATH:$(go env GOPATH)/bin"
fi

gomobile init
export GOFLAGS="-mod=mod"
gomobile bind -v -target=android -androidapi 21 github.com/BoldBitcoinWallet/BBMTLib/tss
cp tss.aar ../android/app/libs/tss.aar
cp tss-sources.jar ../android/app/libs/tss-sources.jar

# Run go mod tidy again at the end to ensure go.mod/go.sum are up to date
# This ensures any dependencies added during the build are included
echo "Updating go.mod/go.sum..."
go mod tidy
