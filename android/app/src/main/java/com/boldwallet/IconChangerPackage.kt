package com.boldwallet // Or whatever your IconChangerModule's package is

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import java.util.ArrayList

class IconChangerPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        val modules = ArrayList<NativeModule>()
        modules.add(IconChangerModule(reactContext)) // Assuming your IconChangerModule constructor takes ReactApplicationContext
        return modules
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return java.util.Collections.emptyList() // Or return your view managers if you have any
    }
}