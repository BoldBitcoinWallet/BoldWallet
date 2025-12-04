package com.boldwallet

import android.os.Bundle
import android.content.ComponentName
import android.content.pm.PackageManager
import android.util.Log
import android.content.SharedPreferences
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "BoldWallet"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        // react-native-navigation
        super.onCreate(null)
    }
}
