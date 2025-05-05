package com.boldwallet

import android.app.Application
import cl.json.RNSharePackage
import com.airbnb.android.react.lottie.LottiePackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import com.learnium.RNDeviceInfo.RNDeviceInfo
import com.rnbarcodezxing.BarcodeZXingPackage
import com.rnbiometrics.ReactNativeBiometricsPackage
import com.rnfs.RNFSPackage
import com.swmansion.gesturehandler.RNGestureHandlerPackage

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> =
                PackageList(this).packages.apply {
                    add(BBMTLibNativePackage())
                    add(RNGestureHandlerPackage())
                    add(RNDeviceInfo())
                    add(RNFSPackage())
                    add(RNSharePackage())
                    add(ReactNativeBiometricsPackage())
                    add(BarcodeZXingPackage())
                    add(LottiePackage())
                }

            override fun getJSMainModuleName(): String = "index"

            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }

    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, OpenSourceMergedSoMapping)
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            load()
        }
    }
}
