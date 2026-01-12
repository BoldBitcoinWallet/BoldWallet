# syntax=docker/dockerfile:1.4
# Platform specification: linux/amd64 required for Android builds
# On native Linux x86_64, this is a no-op (native build)
# On macOS/ARM, this enables QEMU emulation
# Base image can be customized via BUILD_BASE_IMAGE arg
# Options: debian:bookworm (default, stable), ubuntu:22.04 (better QEMU support), debian:slim (smaller)
ARG BUILD_BASE_IMAGE=debian:bookworm
FROM --platform=linux/amd64 ${BUILD_BASE_IMAGE} AS base

# Install system dependencies (this layer rarely changes)
RUN apt update && apt install -y --no-install-recommends \
    curl \
    git \
    openjdk-17-jdk \
    unzip \
    gcc \
    libc-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (cached unless Node version changes)
RUN curl -Lo node.tar.gz https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.gz \
    && echo "259e5a8bf2e15ecece65bd2a47153262eda71c0b2c9700d5e703ce4951572784 node.tar.gz" | sha256sum -c - \
    && tar xzf node.tar.gz --strip-components=1 -C /usr/local/ \
    && rm node.tar.gz

# Install Go (cached unless Go version changes)
RUN curl -LO https://go.dev/dl/go1.24.2.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go1.24.2.linux-amd64.tar.gz \
    && rm go1.24.2.linux-amd64.tar.gz

ENV PATH="/usr/local/go/bin:/usr/local/bin:${PATH}"
ENV GOROOT="/usr/local/go"
ENV GOPATH="/root/go"
ENV PATH="/root/go/bin:${PATH}"
# Set GOMODCACHE to use the cache mount location
ENV GOMODCACHE="/root/go/pkg/mod"

# Install Android SDK (cached unless SDK version changes)
RUN curl -LO https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
    && unzip commandlinetools-linux-13114758_latest.zip -d /android-sdk \
    && rm commandlinetools-linux-13114758_latest.zip

ENV ANDROID_HOME="/android-sdk"
ENV ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
ENV PATH="$ANDROID_HOME/cmdline-tools/bin:${PATH}"

# Install Android SDK components (cached unless versions change)
# Cache Android SDK downloads - sdkmanager stores cache in ~/.android
# Note: On macOS with QEMU emulation, cache mounts may not persist perfectly
# Using explicit cache ID to improve persistence across builds
RUN --mount=type=cache,target=/root/.android,id=android-sdk-cache,sharing=shared \
    ANDROID_SDK_ROOT=$ANDROID_HOME \
    yes | /android-sdk/cmdline-tools/bin/sdkmanager --sdk_root=$ANDROID_HOME \
    "platforms;android-21" "build-tools;33.0.0" "ndk;27.1.12297006"

# Install gomobile (cached unless version changes)
# Ensure GOPATH/bin directory exists and add to PATH for this RUN
# Note: gomobile install may compile C code, but we disable CGO to avoid architecture issues
RUN mkdir -p /root/go/bin \
    && CGO_ENABLED=0 go install golang.org/x/mobile/cmd/gomobile@v0.0.0-20250408133729-978277e7eaf7 \
    && /root/go/bin/gomobile init

# Build stage
FROM base AS builder

ARG fdroid=false
ENV fdroid=${fdroid}
ARG git_ref=""
ENV git_ref=${git_ref}
ARG DOCKER_HOST_OS=""
ENV DOCKER_HOST_OS=${DOCKER_HOST_OS}

WORKDIR /BoldWallet

# Copy dependency files first for better caching
# These layers only invalidate when dependencies change, not code
COPY package.json package-lock.json ./
COPY patches/ ./patches/

# Install npm dependencies with cache mount (BuildKit feature)
# Cache persists across builds, only downloads new/changed packages
# Using npm install instead of npm ci for better compatibility
RUN --mount=type=cache,target=/root/.npm,id=npm-cache,sharing=shared \
    npm install --build-from-source --prefer-offline --no-audit --legacy-peer-deps

# Copy Go dependency files
COPY BBMTLib/go.mod BBMTLib/go.sum ./BBMTLib/

# Download Go modules with cache mount
# Run go mod tidy first to ensure all dependencies are resolved
# Download all modules including transitive dependencies - cache persists across builds
RUN --mount=type=cache,target=/root/go/pkg/mod,id=go-modules-cache,sharing=shared \
    cd BBMTLib && \
    go mod tidy && \
    go mod download && \
    # Pre-download all transitive dependencies by building (without actually building)
    # This ensures gomobile and all its dependencies are cached
    go list -deps -f '{{.Module.Path}}' ./tss/... 2>/dev/null | xargs -r go mod download || true

# Now copy the rest of the codebase
# This layer invalidates on code changes, but dependencies are already cached
COPY . .

# Handle git_ref if provided (clone from GitHub instead of using local code)
RUN --mount=type=cache,target=/root/.npm,id=npm-cache,sharing=shared \
    --mount=type=cache,target=/root/go/pkg/mod,id=go-modules-cache,sharing=shared \
    if [ -n "$git_ref" ]; then \
    echo "Replacing from GitHub"; \
    rm -rf /BoldWallet/* /BoldWallet/.[!.]*; \
    git clone https://github.com/BoldBitcoinWallet/BoldWallet.git /tmp/BoldWallet; \
    cd /tmp/BoldWallet && git checkout "$git_ref"; \
    cp -r /tmp/BoldWallet/* /BoldWallet/; \
    cp -r /tmp/BoldWallet/.[!.]* /BoldWallet/ 2>/dev/null || true; \
    rm -rf /tmp/BoldWallet; \
    # Explicitly cd to /BoldWallet to restore working directory context \
    cd /BoldWallet; \
    # Reinstall dependencies after git clone (uses cache) \
    npm install --build-from-source --prefer-offline --no-audit --legacy-peer-deps; \
    cd /BoldWallet/BBMTLib && go mod download; \
fi

# Conditional F-Droid build modifications
RUN --mount=type=cache,target=/root/.npm,id=npm-cache,sharing=shared \
    if [ "$fdroid" = "true" ]; then \
    sed -i '/react-native-vision-camera/d' package.json; \
    mv components/QRScanner.foss.tsx components/QRScanner.tsx 2>/dev/null || true; \
    # Reinstall after package.json change (uses cache) \
    npm install --build-from-source --prefer-offline --no-audit --legacy-peer-deps; \
    # Apply F-Droid patches \
    sed -i -e '/installReferrerVersion/,+12d' node_modules/react-native-device-info/android/build.gradle 2>/dev/null || true; \
fi

# Build Go library (uses cached Go modules)
# Inlined from build.sh - optimized for Docker with cache mounts
# Removed redundant go mod tidy/download (already done above with cache mounts)
WORKDIR /BoldWallet/BBMTLib
RUN --mount=type=cache,target=/root/go/pkg/mod,id=go-modules-cache,sharing=shared \
    --mount=type=cache,target=/root/.cache/go-build,id=go-build-cache,sharing=shared \
    echo "building gomobile tss lib" && \
    # gomobile is already installed and initialized in base stage, skip redundant steps \
    export GOFLAGS="-mod=mod" && \
    # Build Android AAR (iOS build not needed for Android APK) \
    /root/go/bin/gomobile bind -v -target=android -androidapi 21 github.com/BoldBitcoinWallet/BBMTLib/tss && \
    # Copy Android artifacts to android/app/libs \
    cp tss.aar ../android/app/libs/tss.aar && \
    cp tss-sources.jar ../android/app/libs/tss-sources.jar

# Build Android APK (uses cached npm and Gradle dependencies)
WORKDIR /BoldWallet/android

# Pre-download Gradle wrapper (cached separately from build)
# This layer only invalidates if gradle wrapper version changes, not when source code changes
RUN --mount=type=cache,target=/root/.gradle/wrapper,id=gradle-wrapper,sharing=shared \
    ./gradlew --version || true

# Build the APK (this layer invalidates when source code changes)
# Gradle wrapper is already downloaded, so this step is faster
# Set DOCKER_BUILD=1 and DOCKER_HOST_OS to ensure appropriate gradle.properties are used
RUN --mount=type=cache,target=/root/.gradle/caches,id=gradle-caches,sharing=shared \
    --mount=type=cache,target=/root/.gradle/wrapper,id=gradle-wrapper,sharing=shared \
    --mount=type=cache,target=/BoldWallet/android/.gradle,id=gradle-project-cache,sharing=shared \
    DOCKER_BUILD=1 DOCKER_HOST_OS=${DOCKER_HOST_OS} bash release.sh

# Keep builder as final stage for file extraction
# APK location: /BoldWallet/android/app/build/outputs/apk/release/app-release.apk
# Mapping location: /BoldWallet/android/app/build/outputs/mapping/release/mapping.txt
FROM builder AS final
