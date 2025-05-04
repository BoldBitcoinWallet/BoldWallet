FROM debian:bullseye

RUN apt update && apt install -y curl git openjdk-17-jdk \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt install -y nodejs unzip

RUN curl -LO https://go.dev/dl/go1.24.2.linux-amd64.tar.gz \
  && tar -C /usr/local -xzf go1.24.2.linux-amd64.tar.gz \
  && rm go1.24.2.linux-amd64.tar.gz

ENV PATH="/usr/local/go/bin:${PATH}"
RUN curl -LO https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip \
  && unzip commandlinetools-linux-9477386_latest.zip -d /android-sdk \
  && rm commandlinetools-linux-9477386_latest.zip

ENV ANDROID_HOME="/android-sdk"
ENV ANDROID_NDK_HOME="$ANDROID_HOME/ndk/25.1.8937393"
ENV PATH="$ANDROID_HOME/cmdline-tools/bin:$PATH"

RUN yes | /android-sdk/cmdline-tools/bin/sdkmanager --sdk_root=$ANDROID_HOME \
    "platforms;android-21" "build-tools;33.0.0" "ndk;25.1.8937393"

ENV PATH="$PATH:/root/go/bin"
RUN go install golang.org/x/mobile/cmd/gomobile@latest \
  && gomobile init

## Clone private repo
#ARG GITHUB_PAT
#RUN git clone https://${GITHUB_PAT}@github.com/BoldBitcoinWallet/BoldWallet.git -b f-droid-submission

WORKDIR /BoldWallet

COPY . .

RUN npm i
RUN cd BBMTLib && chmod +x build.sh && sh build.sh
RUN cd android && sh release.sh