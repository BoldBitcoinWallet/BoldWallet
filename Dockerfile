FROM debian:bullseye
ARG fdroid=false
ENV fdroid=${fdroid}
# install java and node
RUN apt update && apt install -y curl git openjdk-17-jdk \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt install -y nodejs unzip

# install go
RUN curl -LO https://go.dev/dl/go1.24.2.linux-amd64.tar.gz \
  && tar -C /usr/local -xzf go1.24.2.linux-amd64.tar.gz \
  && rm go1.24.2.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

# install android
RUN curl -LO https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip \
  && unzip commandlinetools-linux-9477386_latest.zip -d /android-sdk \
  && rm commandlinetools-linux-9477386_latest.zip

ENV ANDROID_HOME="/android-sdk"
ENV ANDROID_NDK_HOME="$ANDROID_HOME/ndk/25.1.8937393"
ENV PATH="$ANDROID_HOME/cmdline-tools/bin:$PATH"

RUN yes | /android-sdk/cmdline-tools/bin/sdkmanager --sdk_root=$ANDROID_HOME \
    "platforms;android-21" "build-tools;33.0.0" "ndk;25.1.8937393"

# install gomobile
ENV PATH="$PATH:/root/go/bin"
RUN go install golang.org/x/mobile/cmd/gomobile@latest \
  && gomobile init

# Build Wallet
WORKDIR /BoldWallet
COPY . .

# conditional F-Droid build switch
RUN if [ "$fdroid" = "true" ]; then \
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
