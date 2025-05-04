# Bold Bitcoin Wallet

## 📖 Android Guide
You can build the Android APK yourself, via Auto Builder or Manual Build as below.

### 🔁 Auto Builder

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

> sh docker-apk-builder.sh
```
![image](https://github.com/user-attachments/assets/eb8f1a45-b2cb-46ec-a061-fc0cb4f10448)
  

### ✍️ Manual Build
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
