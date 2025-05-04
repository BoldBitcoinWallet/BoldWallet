# BoldWallet

## Auto Build
Auto builder rely on docker (Dockerfile), is a guranteed way to compile generate the APK.

It manages internally the needed runtimes (node, go, gomobile, jdk, android sdk & ndk)
- Build the APK seamlessly thru our docker script runner (from a ubuntu/windows machine):
    - Edit android/release.sh if needed:
    ```sh
    KEYSTORE_FILE="my-release-key.jks"
    KEY_ALIAS="my-key"
    KEYSTORE_PASSWORD="your_keystore_password"
    KEY_PASSWORD="your_key_password"
    ```
    - Run Docker Script Runner:
    ```sh
    # use sudo if needed for docker
    sh docker-apk-builder.sh
    ```

- This will take time given your PC performance (couple of minutes up to 30 minutes)

- When done, the **app-release.APK** is generated within the /BoldWallet folder


## Manual Build
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

# React Native Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
