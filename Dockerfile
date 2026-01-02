# syntax=docker/dockerfile:1.4
# Explicitly specify platform: works on Linux (native) and macOS (emulation)
FROM --platform=linux/amd64 debian:bookworm AS base

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
RUN --mount=type=cache,target=/root/.android \
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

WORKDIR /BoldWallet

# Copy dependency files first for better caching
# These layers only invalidate when dependencies change, not code
COPY package.json package-lock.json ./
COPY patches/ ./patches/

# Install npm dependencies with cache mount (BuildKit feature)
# Cache persists across builds, only downloads new/changed packages
# Using npm install instead of npm ci for better compatibility
RUN --mount=type=cache,target=/root/.npm \
    npm install --build-from-source --prefer-offline --no-audit --legacy-peer-deps

# Copy Go dependency files
COPY BBMTLib/go.mod BBMTLib/go.sum ./BBMTLib/

# Download Go modules with cache mount
# Run go mod tidy first to ensure all dependencies are resolved
# Download all modules including transitive dependencies - cache persists across builds
RUN --mount=type=cache,target=/root/go/pkg/mod \
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
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/go/pkg/mod \
    if [ -n "$git_ref" ]; then \
    echo "Replacing from GitHub"; \
    rm -rf /BoldWallet/* /BoldWallet/.[!.]*; \
    git clone https://github.com/BoldBitcoinWallet/BoldWallet.git /tmp/BoldWallet; \
    cd /tmp/BoldWallet && git checkout "$git_ref"; \
    cp -r /tmp/BoldWallet/* /BoldWallet/; \
    cp -r /tmp/BoldWallet/.[!.]* /BoldWallet/ 2>/dev/null || true; \
    rm -rf /tmp/BoldWallet; \
    # Reinstall dependencies after git clone (uses cache) \
    npm install --build-from-source --prefer-offline --no-audit --legacy-peer-deps; \
    cd BBMTLib && go mod download; \
fi

# Conditional F-Droid build modifications
RUN --mount=type=cache,target=/root/.npm \
    if [ "$fdroid" = "true" ]; then \
    sed -i '/react-native-vision-camera/d' package.json; \
    mv components/QRScanner.foss.tsx components/QRScanner.tsx 2>/dev/null || true; \
    # Reinstall after package.json change (uses cache) \
    npm install --build-from-source --prefer-offline --no-audit --legacy-peer-deps; \
    # Apply F-Droid patches \
    sed -i -e '/installReferrerVersion/,+12d' node_modules/react-native-device-info/android/build.gradle 2>/dev/null || true; \
fi

# Build Go library (uses cached Go modules)
# Add cache mount so build.sh can use cached modules
WORKDIR /BoldWallet/BBMTLib
RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    bash build.sh

# Build Android APK (uses cached npm and Gradle dependencies)
WORKDIR /BoldWallet/android
# Cache Gradle wrapper downloads, build cache, and dependencies
# GRADLE_USER_HOME defaults to ~/.gradle
RUN --mount=type=cache,target=/root/.gradle/caches \
    --mount=type=cache,target=/root/.gradle/wrapper \
    --mount=type=cache,target=/BoldWallet/android/.gradle \
    bash release.sh

# Keep builder as final stage for file extraction
# APK location: /BoldWallet/android/app/build/outputs/apk/release/app-release.apk
# Mapping location: /BoldWallet/android/app/build/outputs/mapping/release/mapping.txt
FROM builder AS final
