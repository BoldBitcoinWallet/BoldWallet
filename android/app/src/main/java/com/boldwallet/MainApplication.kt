package com.boldwallet

import android.app.Application
import cl.json.RNSharePackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.learnium.RNDeviceInfo.RNDeviceInfo
import com.reactlibrary.BarcodeZxingScanPackage
import com.rnbiometrics.ReactNativeBiometricsPackage
import com.rnfs.RNFSPackage
import com.swmansion.gesturehandler.RNGestureHandlerPackage

class MainApplication : Application(), ReactApplication {
    override val reactHost: ReactHost by lazy {
        getDefaultReactHost(
            context = applicationContext,
            packageList = PackageList(this).packages.apply {
                add(BBMTLibNativePackage())
                add(MpcKeepAlivePackage())
                add(KeyshareSharePackage())
                add(IncomingUrlPackage())
                add(IconChangerPackage())
                add(RNGestureHandlerPackage())
                add(RNDeviceInfo())
                add(RNFSPackage())
                add(RNSharePackage())
                add(ReactNativeBiometricsPackage())
                add(BarcodeZxingScanPackage())
            },
        )
    }

    override fun onCreate() {
        super.onCreate()
        IconChangerModule.ensureDefaultLauncher(this)
        loadReactNative(this)
    }
}
