FROM debian:bookworm
ARG fdroid=false
ENV fdroid=${fdroid}
ARG git_ref=""
ENV git_ref=${git_ref}
# install java and node
RUN apt update && apt install -y curl git openjdk-17-jdk unzip \
  && curl -Lo node.tar.gz https://nodejs.org/dist/v20.19.5/node-v20.19.5-linux-x64.tar.gz \
  && echo "4eba5fbe1fb10753bc06e42f001a91c5cec16798b7764a3e9257adc59af47fe1  node.tar.gz" | sha256sum -c - \
  && tar xzf node.tar.gz --strip-components=1 -C /usr/local/ \
  && rm node.tar.gz

# install go
RUN curl -LO https://go.dev/dl/go1.24.10.linux-amd64.tar.gz \
  && tar -C /usr/local -xzf go1.24.10.linux-amd64.tar.gz \
  && rm go1.24.10.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

# install android
RUN curl -LO https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
  && unzip commandlinetools-linux-13114758_latest.zip -d /android-sdk \
  && rm commandlinetools-linux-13114758_latest.zip

ENV ANDROID_HOME="/android-sdk"
ENV ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
ENV PATH="$ANDROID_HOME/cmdline-tools/bin:$PATH"

RUN yes | /android-sdk/cmdline-tools/bin/sdkmanager --sdk_root=$ANDROID_HOME \
    "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"

# install gomobile
ENV PATH="$PATH:/root/go/bin"
RUN go install golang.org/x/mobile/cmd/gomobile@a159579294ab4bbc756b8ac66a320913d003cf99 \
  && gomobile init

# Build Wallet
COPY . /BoldWallet
RUN if [ -z "$git_ref" ]; then \
    echo "Using local code"; \
else \
    echo "Replacing from GitHub"; \
    rm -r /BoldWallet; \
    git clone https://github.com/BoldBitcoinWallet/BoldWallet.git /BoldWallet; \
    cd /BoldWallet && git checkout "$git_ref"; \
fi

# BoldWallet Root
WORKDIR /BoldWallet

# conditional F-Droid build switch
RUN if [ "$fdroid" = "true" ]; then \
    sed -i '/react-native-vision-camera/d' package.json; \
    mv /BoldWallet/screens/SendBitcoinModal.foss.tsx /BoldWallet/screens/SendBitcoinModal.tsx; \
  fi
  
# npm install
RUN npm i

RUN if [ "$fdroid" = "true" ]; then \
    sed -i -e '/installReferrerVersion/,+12d' node_modules/react-native-device-info/android/build.gradle; \
  fi

# gomobile lib
WORKDIR /BoldWallet/BBMTLib
RUN sh build.sh

# android release APK
WORKDIR /BoldWallet/android
RUN sh release.sh
