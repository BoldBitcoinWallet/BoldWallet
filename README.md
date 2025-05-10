# Bold Bitcoin Wallet


## 📲 Install it on F-Droid

[<img src="https://f-droid.org/badge/get-it-on.png"
    alt="Get it on F-Droid"
    height="80">](https://f-droid.org/packages/com.boldwallet)

## ➡️ BoldWallet Official Release
**[Download Latest APK Release](https://github.com/BoldBitcoinWallet/BoldWallet/releases/latest)**

> ⚠️ **Important:** This APK is signed with the official BoldWallet keystore.  
> It is **not compatible** with the version distributed via [F-Droid](https://f-droid.org).  
> Always install updates from **one source only** to avoid signature conflicts.

## 📖 Dev Guide
- You can build the Android APK yourself, via Auto Builder or Manual Build as below.
- iOS builds follow React-Native iphone–guide 

## 🪄 Android - Build It Yourself 
### 🔁 Via Auto Builder
Relies on docker (Dockerfile) - guaranteed quick way to compile and release the APK.

Build the APK seamlessly following the steps:
- Optional: edit android/release.sh when needed:
```sh
KEYSTORE_FILE="my-release-key.jks"
KEY_ALIAS="my-key"
KEYSTORE_PASSWORD="your_keystore_password"
KEY_PASSWORD="your_key_password"
```
- Run Docker Script Runner:
```sh
# use sudo if needed for docker
# This will take time given your PC performance (couple of minutes up to 30 minutes)
# When done, the app-release.apk is generated within the BoldWallet folder

> sh docker-apk-builder.sh --fdroid #optional, for F-Droid foss tailored build
> sh docker-apk-builder.sh --fdroid --git=main #optional, which git "branch,tag, or commit-hash" to use
```
![image](https://github.com/user-attachments/assets/eb8f1a45-b2cb-46ec-a061-fc0cb4f10448)
  
### ✍️ Via Manual Build
Manual build, requires manual and extra efforts to compiles the app on your PC.

BoldWallet is a typical React Native Mobile Based App ( android / iOS ).
- Built using node v20.18.1
  - npm install
  - To rebuild the android/app/libs/tss.aar:
    - Check the BBMTLib/README.md, Android Section
  - For Android APK build:
    - cd android
    - ./release.sh
        - APK generated under:
            ./android/app/build/outputs/apk/release/app-release.apk 


----

#### React Native Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
