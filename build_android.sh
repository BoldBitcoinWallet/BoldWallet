echo "🧼 Cleaning and building APK..."
cd android
./gradlew clean
./gradlew assembleRelease

echo "✅ APK build finished."