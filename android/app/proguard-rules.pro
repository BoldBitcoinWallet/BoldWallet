# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# React Native ProGuard Rules
# Keep React Native classes
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}

# Keep React Native bridge
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep React Native modules
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.views.** { *; }
-keep class com.facebook.react.modules.** { *; }

# Keep React Native third-party modules
-keep class com.reactnativecommunity.** { *; }
-keep class org.reactnative.** { *; }
-keep class com.swmansion.** { *; }
-keep class com.oblador.** { *; }
-keep class com.th3rdwave.** { *; }

# Keep React Native packages (for reflection-based loading)
-keep class * implements com.facebook.react.ReactPackage { *; }
-keep class * extends com.facebook.react.ReactContextBaseJavaModule { *; }
-keep class * extends com.facebook.react.uimanager.ViewManager { *; }

# Keep React Native Device Info
-keep class com.learnium.** { *; }

# Keep React Native Biometrics
-keep class com.rnbiometrics.** { *; }

# Keep React Native Share
-keep class cl.json.** { *; }

# Keep React Native Document Picker
-keep class io.github.elyx0.reactnativedocumentpicker.** { *; }

# Keep React Native Gesture Handler
-keep class com.swmansion.gesturehandler.** { *; }

# Keep React Native Reanimated
-keep class com.swmansion.reanimated.** { *; }

# Keep React Native SVG
-keep class com.horcrux.svg.** { *; }

# Keep React Native Haptic Feedback
-keep class com.mkuczera.** { *; }

# Keep Barcode Scanner
-keep class com.reactnativebarcodescanner.** { *; }

# Keep TSS library (custom native module - Go bindings)
-keep class com.boldwallet.tss.** { *; }
-keep class github.com.BoldBitcoinWallet.BBMTLib.tss.** { *; }
-keep class tss.** { *; }
-keep interface tss.** { *; }

# Keep custom native modules
-keep class com.boldwallet.BBMTLibNativeModule { *; }
-keep class com.boldwallet.BBMTLibNativePackage { *; }
-keep class com.boldwallet.IconChangerPackage { *; }

# Keep MainActivity and Application classes
-keep class com.boldwallet.MainActivity { *; }
-keep class com.boldwallet.MainApplication { *; }

# Keep all classes in the app package (defensive)
-keep class com.boldwallet.** { *; }

# Keep Parcelable implementations
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}

# Keep Serializable classes
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# Keep annotations
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Keep line numbers for better stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep names for native methods (critical for JNI/Go bindings)
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# Keep classes that are referenced in native code
-keepclasseswithmembers class * {
    native <methods>;
}

# Keep enum classes (often used in native bindings)
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Don't warn about missing classes (some may be in native code)
-dontwarn tss.**
-dontwarn com.boldwallet.tss.**
-dontwarn github.com.BoldBitcoinWallet.BBMTLib.tss.**

# Keep classes with @ReactMethod annotation
-keep @com.facebook.react.bridge.ReactMethod class * { *; }
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
