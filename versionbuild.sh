#!/usr/bin/env bash
# Bump app version and build number across Android, iOS, and package.json.
# Usage: ./versionbuild.sh <version> <build>
#   e.g. ./versionbuild.sh 3.0.5 55

set -e

VERSION="${1:?Usage: $0 <version> <build>   e.g. $0 3.0.5 55}"
BUILD="${2:?Usage: $0 <version> <build>   e.g. $0 3.0.5 55}"

# Validate build is a positive integer
if ! [[ "$BUILD" =~ ^[0-9]+$ ]]; then
  echo "Error: build must be a positive integer (got: $BUILD)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Android: android/app/build.gradle
GRADLE="${ROOT}/android/app/build.gradle"
if [[ -f "$GRADLE" ]]; then
  if [[ "$(uname)" == Darwin ]]; then
    sed -i '' "s/versionCode [0-9]*/versionCode $BUILD/" "$GRADLE"
    sed -i '' "s/versionName \"[^\"]*\"/versionName \"$VERSION\"/" "$GRADLE"
  else
    sed -i "s/versionCode [0-9]*/versionCode $BUILD/" "$GRADLE"
    sed -i "s/versionName \"[^\"]*\"/versionName \"$VERSION\"/" "$GRADLE"
  fi
  echo "Android: versionName=$VERSION versionCode=$BUILD"
else
  echo "Warning: $GRADLE not found" >&2
fi

# iOS: ios/BoldWallet.xcodeproj/project.pbxproj
PBXPROJ="${ROOT}/ios/BoldWallet.xcodeproj/project.pbxproj"
if [[ -f "$PBXPROJ" ]]; then
  if [[ "$(uname)" == Darwin ]]; then
    sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $BUILD;/g" "$PBXPROJ"
    sed -i '' "s/MARKETING_VERSION = [0-9.]*;/MARKETING_VERSION = $VERSION;/g" "$PBXPROJ"
  else
    sed -i "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $BUILD;/g" "$PBXPROJ"
    sed -i "s/MARKETING_VERSION = [0-9.]*;/MARKETING_VERSION = $VERSION;/g" "$PBXPROJ"
  fi
  echo "iOS: MARKETING_VERSION=$VERSION CURRENT_PROJECT_VERSION=$BUILD"
else
  echo "Warning: $PBXPROJ not found" >&2
fi

# package.json
PKG="${ROOT}/package.json"
if [[ -f "$PKG" ]]; then
  if [[ "$(uname)" == Darwin ]]; then
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PKG"
  else
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PKG"
  fi
  echo "package.json: version=$VERSION"
else
  echo "Warning: $PKG not found" >&2
fi

echo "Done. Version $VERSION ($BUILD)."
