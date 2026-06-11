# BoldWallet — Development setup (new machine)

End-to-end guide to set up a **fresh Linux or macOS** machine, build native MPC libraries, compile a **release APK**, and install on **Android emulators or devices**.

BoldWallet is a **React Native** mobile app. JavaScript dependencies alone are not enough: you must build **native** artifacts (`libbbmtmobile.so`, `libdkls_jni.so`) before Android will run.

---

## What you are building

| Layer | Toolchain | Output |
|-------|-----------|--------|
| JS / React Native | Node 20+, npm | `node_modules/`, Metro bundle (debug) |
| MPC / TSS (Rust) | Rust, `cargo-ndk` | `libtss` static libs per Android ABI |
| MPC / TSS (Go) | Go 1.24+ | `android/app/src/main/jniLibs/*/libbbmtmobile.so`, `libdkls_jni.so` |
| Android app | JDK 17, SDK, NDK, Gradle | `android/app/build/outputs/apk/release/app-release.apk` |

---

## Repository layout

`libtss` is a **separate** git repo and must sit **next to** BoldWallet (not inside it):

```
~/code/
├── BoldWallet/     ← clone this repo
└── libtss/         ← created by setup script (section 4)
```

---

## 1. Requirements checklist

Install or verify each item before building.

### All platforms

| Requirement | Version | Verify with |
|-------------|---------|-------------|
| **Git** | recent | `git --version` |
| **Node.js** | **≥ 20** (project README: **20.18.1**) | `node -v` |
| **npm** | bundled with Node | `npm -v` |
| **Go** | **1.24+** | `go version` |
| **Rust** | stable | `rustc --version` |
| **cargo-ndk** | latest | `cargo ndk --version` |

### Android (Linux or macOS)

| Requirement | Version | Verify with |
|-------------|---------|-------------|
| **JDK** | **17** | `java -version` |
| **Android SDK** | Platform **android-35**, Build-Tools **35.0.0** | `sdkmanager --list` |
| **Android NDK** | **27.1.12297006** (see `android/build.gradle`) | `ls "$ANDROID_NDK_HOME"` |
| **adb** | from SDK | `adb version` |

### iOS (macOS only)

- Xcode, CocoaPods — [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment).

### Disk and time (rough guide)

- **SDK + NDK + npm + Rust**: several GB
- **First `./release.sh`**: often **15–30+ minutes** (Gradle downloads and compiles)
- **First `BBMTLib/build-all.sh`**: several minutes (depends on CPU)

---

## 2. Shell environment (set on every new machine)

Add this block to `~/.bashrc` or `~/.zshrc` and run `source ~/.bashrc` (adjust paths if yours differ).

```bash
# --- Node (nvm) ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# --- Go (use ONE of these install locations) ---
export PATH="/usr/local/go/bin:$HOME/sdk/go/bin:$PATH"

# --- Rust ---
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

# --- Android ---
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$ANDROID_HOME/ndk/27.1.12297006}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# --- Java (Linux apt example; macOS: use /usr/libexec/java_home -v 17) ---
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="$JAVA_HOME/bin:$PATH"
```

**Sanity check** (all should succeed):

```bash
node -v          # v20.x
go version       # go1.24+
rustc --version
cargo ndk --version
java -version    # 17
echo "$ANDROID_HOME"
test -d "$ANDROID_NDK_HOME"
adb version
```

> **Common mistake:** `build-all.sh` prints `Go: not found` while Rust steps succeed. Go is installed but **not on `PATH`** in that shell — fix the block above.

---

## 3. Install system dependencies

### Linux (Ubuntu / Debian) — full new machine

```bash
# Base tools
sudo apt update
sudo apt install -y git curl unzip openjdk-17-jdk-headless

# Node 20 via nvm (recommended; avoids old system Node 18)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 20
nvm alias default 20
node -v

# Go 1.24+ (system-wide; or use ~/sdk — see below)
curl -LO https://go.dev/dl/go1.24.2.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go1.24.2.linux-amd64.tar.gz

# Go without sudo (user install)
# mkdir -p ~/sdk && curl -LO ... && tar -C ~/sdk -xzf go1.24.2.linux-amd64.tar.gz
# mv ~/sdk/go ~/sdk/go1.24.2 && ln -sf ~/sdk/go1.24.2 ~/sdk/go

# Rust + Android cross-compile targets
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
cargo install cargo-ndk
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android

# Android SDK (user install)
mkdir -p "$HOME/Android/Sdk/cmdline-tools"
cd /tmp
curl -LO https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -q commandlinetools-linux-13114758_latest.zip
rm -rf "$HOME/Android/Sdk/cmdline-tools/latest"
mv cmdline-tools "$HOME/Android/Sdk/cmdline-tools/latest"

export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

yes | sdkmanager --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "ndk;27.1.12297006"
```

Then add the shell block from [section 2](#2-shell-environment-set-on-every-new-machine).

### macOS

```bash
# Homebrew
brew install git node@20 go rust openjdk@17

export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"

# Android Studio is the easiest way to get SDK + NDK 27.1.12297006
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"

source "$HOME/.cargo/env"
cargo install cargo-ndk
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
```

---

## 4. Clone BoldWallet and `libtss`

```bash
mkdir -p ~/code
cd ~/code

git clone https://github.com/BoldBitcoinWallet/BoldWallet.git
cd BoldWallet
```

### `libtss` (pinned revision + patch)

Use the repo script (preferred — pins a known commit):

```bash
cd ~/code/BoldWallet/BBMTLib
bash mobile-deps/libtss/setup-libtss.sh
```

This clones/checks out `libtss` at `~/code/libtss` (sibling of `BoldWallet`) and applies `derive-path-with-chain-code.patch`.

Manual equivalent:

```bash
cd ~/code
LIBTSS_DIR="$(pwd)/libtss"
PATCH="$(pwd)/BoldWallet/BBMTLib/mobile-deps/libtss/derive-path-with-chain-code.patch"
git clone https://github.com/0xCarbon/libtss.git "$LIBTSS_DIR"
git -C "$LIBTSS_DIR" apply "$PATCH"
grep -q DerivePathWithChainCode "$LIBTSS_DIR/libtss-go/tss/derive.go"
```

---

## 5. JavaScript dependencies

Dependencies are **exact-pinned** in `package.json` / `package-lock.json`. Use **`npm ci`** (not `npm update`) for reproducible installs.

```bash
cd ~/code/BoldWallet
node -v    # must be v20+
npm ci     # runs patch-package via postinstall
```

Project `.npmrc` sets `save-exact=true` and `legacy-peer-deps=true`.

---

## 6. Android Gradle: SDK path

Gradle needs `sdk.dir`. Create **`android/local.properties`** (gitignored, machine-local):

```bash
cd ~/code/BoldWallet/android
cat > local.properties <<EOF
sdk.dir=${ANDROID_HOME}
EOF
```

Expand manually if needed, e.g. `sdk.dir=/home/you/Android/Sdk`.

Without this file you get:

```text
SDK location not found. Define a valid SDK location with an ANDROID_HOME
environment variable or by setting the sdk.dir path in local.properties
```

---

## 7. Build native libraries (required once per native change)

```bash
# Ensure section 2 env is loaded
cd ~/code/BoldWallet/BBMTLib
./build-all.sh
```

This runs:

1. **libtss-ffi** (Rust) for host + Android ABIs  
2. **GG18 + DKLs** (Go / gomobile) → `android/app/src/main/jniLibs/`  
3. Host Go smoke tests (may fail on Linux if `liblibtss_ffi.so` is not on `LD_LIBRARY_PATH` — Android artifacts can still be OK)

Verify Android artifacts:

```bash
cd ~/code/BoldWallet
npm run verify:native
```

Expected (gitignored):

```text
android/app/src/main/jniLibs/
├── arm64-v8a/libbbmtmobile.so
├── arm64-v8a/libdkls_jni.so
├── armeabi-v7a/...
└── x86_64/...          ← emulators typically use this ABI
```

**Re-run native build when:** `BBMTLib/`, `libtss`, or Android JNI/cpp changes — not needed for JS-only doc/README commits.

Faster path if libtss is already built:

```bash
cd ~/code/BoldWallet/BBMTLib
./build-dkls.sh android
```

### Docker (APK only, optional)

Builds release APK in a container; good when you do not want a local SDK. See [docker/README.md](../docker/README.md).

```bash
cd ~/code/BoldWallet
./docker/scripts/docker-apk-builder.sh --verbose
```

---

## 8. Build release APK

Uses a **dev keystore** (`android/app/dev-release-key.jks`) for local testing — not for Play Store production.

```bash
cd ~/code/BoldWallet/android
./release.sh
```

Output:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Requires **`keytool`** (from JDK 17). First build downloads Gradle deps and can take **20+ minutes**.

Alternative install target (emulator/device already connected):

```bash
./gradlew installRelease
```

---

## 9. Android emulators — install and launch

### Create and start emulators

- **Android Studio → Device Manager** → Create Virtual Device  
- Use **API 24+** and a **64-bit** system image (**x86_64** on Intel/AMD Linux is typical)  
- Start one or more AVDs  

```bash
emulator -list-avds
emulator -avd YOUR_AVD_NAME &
adb devices
```

You should see `emulator-5554 device`, etc.

### Streamed install on all connected emulators

Release APKs are large (~127 MB); `adb install -r` uses **streamed install** automatically.

**One emulator:**

```bash
APK=~/code/BoldWallet/android/app/build/outputs/apk/release/app-release.apk
adb -s emulator-5554 install -r "$APK"
adb -s emulator-5554 shell am start -n com.boldwallet/.MainActivity
```

**Every running emulator (parallel):**

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
APK=~/code/BoldWallet/android/app/build/outputs/apk/release/app-release.apk"

for s in $(adb devices | awk '/^emulator-/{print $1}'); do
  echo "=== $s ==="
  adb -s "$s" install -r "$APK"
  adb -s "$s" shell am start -n com.boldwallet/.MainActivity
done
```

Or from `android/` after `./release.sh`:

```bash
./push.sh    # installs on all adb devices; does not launch the app
```

> **Release vs debug:** Release APK bundles JS — **Metro (`npm start`) is not required**. For hot reload use debug flow (section 10).

---

## 10. Debug development (Metro + live reload)

| | Release (`./release.sh`) | Debug (`npm run android`) |
|--|---------------------------|---------------------------|
| JS source | Bundled in APK | Loaded from Metro |
| `npm start` | Not needed | **Required** (terminal 1) |
| Install | `adb install -r` | Gradle installs debug variant |

```bash
# Terminal 1
cd ~/code/BoldWallet
npm start

# Terminal 2
npm run android
```

---

## 11. iOS (macOS only)

```bash
cd ~/code/BoldWallet/BBMTLib
./build-all.sh

cd ~/code/BoldWallet/ios
pod install

cd ~/code/BoldWallet
npm start        # terminal 1
npm run ios      # terminal 2
```

---

## 12. After `git pull` — rebuild and reinstall

Typical workflow when you already have a working machine:

```bash
cd ~/code/BoldWallet
git pull

# Reload env (nvm, Go, Android)
source ~/.bashrc   # or your zshrc

# JS (if package-lock changed)
npm ci

# Native (only if BBMTLib/, libtss, or android/jni changed)
cd BBMTLib && ./build-all.sh && cd ..

# APK
cd android && ./release.sh && cd ..

# All emulators
APK=android/app/build/outputs/apk/release/app-release.apk
for s in $(adb devices | awk '/^emulator-/{print $1}'); do
  adb -s "$s" install -r "$APK"
  adb -s "$s" shell am start -n com.boldwallet/.MainActivity
done
```

For **JS-only** changes, `cd android && ./release.sh` may be enough (Gradle rebuilds the bundle).

---

## 13. Verification commands

```bash
cd ~/code/BoldWallet

npm ci
npm run verify:native
npm run check:jni
npm test
npm run lint
```

---

## 14. Troubleshooting

| Problem | What to do |
|---------|------------|
| `go: command not found` in `build-all.sh` | Add Go to `PATH` ([section 2](#2-shell-environment-set-on-every-new-machine)); confirm `go version`. |
| `SDK location not found` | Create `android/local.properties` with `sdk.dir=...` ([section 6](#6-android-gradle-sdk-path)). |
| `JAVA_HOME is not set` (sdkmanager) | Install JDK 17; export `JAVA_HOME` before `sdkmanager` / Gradle. |
| `Missing libbbmtmobile.so` | Run `BBMTLib/build-all.sh` or `./build-dkls.sh android`; then `npm run verify:native`. |
| `cd: .../libtss: No such file` | Run `bash BBMTLib/mobile-deps/libtss/setup-libtss.sh`. |
| `ANDROID_NDK_HOME not set` | Install NDK **27.1.12297006** via `sdkmanager`; export paths ([section 2](#2-shell-environment-set-on-every-new-machine)). |
| Node `EBADENGINE` (Node 18) | `nvm install 20 && nvm use 20`. |
| `npm ci` vs lockfile errors | Use `npm ci`; avoid `npm update` unless intentionally refreshing deps. |
| `verify:native` fails on **arm64** JNI symbol only | **x86_64** emulator builds may still work; check `npm run check:jni` for your target ABI. |
| `build-all.sh` fails at host Go tests | Android `jniLibs` may still be built; check files under `android/app/src/main/jniLibs/`. |
| No device for `run-android` | Start emulator(s) or connect USB device; `adb devices` must show `device`. |
| Install fails: `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Uninstall old APK with different signature: `adb uninstall com.boldwallet`. |
| iOS on Linux | Not supported — use macOS + Xcode. |

---

## 15. Quick reference — brand new machine (ordered)

```bash
# === One-time: OS packages, nvm Node 20, Go, Rust, cargo-ndk, JDK 17, Android SDK+NDK ===
# === Add section 2 to ~/.bashrc and: source ~/.bashrc ===

mkdir -p ~/code && cd ~/code
git clone https://github.com/BoldBitcoinWallet/BoldWallet.git
cd BoldWallet/BBMTLib && bash mobile-deps/libtss/setup-libtss.sh

cd ~/code/BoldWallet
npm ci

# android/local.properties
echo "sdk.dir=${ANDROID_HOME}" > android/local.properties

cd BBMTLib && ./build-all.sh
cd .. && npm run verify:native

cd android && ./release.sh

# Emulators running:
APK=app/build/outputs/apk/release/app-release.apk
for s in $(adb devices | awk '/^emulator-/{print $1}'); do
  adb -s "$s" install -r "$APK"
  adb -s "$s" shell am start -n com.boldwallet/.MainActivity
done
```

---

## Further reading

- [BBMTLib/README.md](../BBMTLib/README.md) — native MPC build overview  
- [BBMTLib/docs/DKLS_MOBILE.md](../BBMTLib/docs/DKLS_MOBILE.md) — DKLs / `libbbmtmobile` architecture  
- [docker/README.md](../docker/README.md) — containerized APK builds  
- [README.md](../README.md) — product overview and recovery CLI  
