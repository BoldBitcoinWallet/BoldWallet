if [[ -z "$1" ]]; then
  echo "❌ Usage: $0 <TargetName>"
  exit 1
fi

TARGET_NAME=$1

export ARCHIVE_PATH=$(ls -dt ~/Library/Developer/Xcode/Archives/*/"$TARGET_NAME"*.xcarchive | head -1)
echo "📦 Using Archive Path: $ARCHIVE_PATH"

if [[ ! -d "$ARCHIVE_PATH" ]]; then
  echo "❌ Archive not found for target: $TARGET_NAME! Please archive the project first in Xcode."
  exit 1
fi

echo "🔍 Existing dSYM files:"
find "$ARCHIVE_PATH/dSYMs" -name "*.dSYM"

export HERMES_BINARY=$(find "$ARCHIVE_PATH/Products/Applications" -name "hermes.framework" -type d)
echo "📍 Hermes Binary Path: $HERMES_BINARY"

if [[ ! -d "$HERMES_BINARY" ]]; then
  echo "❌ Hermes framework not found!"
  exit 1
fi

dsymutil "$HERMES_BINARY/hermes" -o "$ARCHIVE_PATH/dSYMs/hermes.framework.dSYM"
echo "✅ Hermes dSYM generated at: $ARCHIVE_PATH/dSYMs/hermes.framework.dSYM"

echo "📂 Final dSYM files:"
find "$ARCHIVE_PATH/dSYMs" -name "*.dSYM"

echo "🎉 Done! Hermes dSYM successfully generated!"

