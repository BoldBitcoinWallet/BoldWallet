#!/bin/bash

# Script to generate dSYM files for embedded frameworks (Tss.framework and hermesvm.framework)
# This should be run as a build phase after archiving

set -e

# Get the archive path from Xcode environment variables or find the latest archive
if [[ -n "$ARCHIVE_PATH" ]]; then
    ARCHIVE_PATH="$ARCHIVE_PATH"
elif [[ -n "$DWARF_DSYM_FOLDER_PATH" ]]; then
    # If running from Xcode build phase, derive archive path from dSYM folder
    # DWARF_DSYM_FOLDER_PATH is typically: /path/to/archive.xcarchive/dSYMs
    ARCHIVE_PATH="${DWARF_DSYM_FOLDER_PATH%/dSYMs}"
elif [[ -n "$ARCHIVE_PRODUCTS_PATH" ]]; then
    # ARCHIVE_PRODUCTS_PATH is typically: /path/to/archive.xcarchive/Products
    ARCHIVE_PATH="${ARCHIVE_PRODUCTS_PATH%/Products}"
elif [[ "$ACTION" == "install" ]] && [[ -n "$CONFIGURATION_BUILD_DIR" ]]; then
    # During archive, try to find the archive being created
    # This is a fallback - may not always work
    ARCHIVE_PATH=$(ls -dt ~/Library/Developer/Xcode/Archives/*/BoldWallet*.xcarchive 2>/dev/null | head -1)
else
    # Fallback: find the latest archive
    ARCHIVE_PATH=$(ls -dt ~/Library/Developer/Xcode/Archives/*/BoldWallet*.xcarchive 2>/dev/null | head -1)
fi

if [[ -z "$ARCHIVE_PATH" ]] || [[ ! -d "$ARCHIVE_PATH" ]]; then
    echo "⚠️  Archive path not found. This script should be run after archiving."
    echo "   If running manually, set ARCHIVE_PATH environment variable."
    echo "   Current ACTION: ${ACTION:-not set}"
    exit 0  # Don't fail the build if archive not found
fi

echo "📦 Using Archive Path: $ARCHIVE_PATH"

# Ensure dSYMs directory exists
DSYM_DIR="$ARCHIVE_PATH/dSYMs"
mkdir -p "$DSYM_DIR"

echo "🔍 Existing dSYM files:"
find "$DSYM_DIR" -name "*.dSYM" 2>/dev/null || echo "   (none found)"

# Find the app bundle
APP_BUNDLE=$(find "$ARCHIVE_PATH/Products/Applications" -name "*.app" -type d | head -1)

if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "⚠️  App bundle not found in archive. Skipping dSYM generation."
    exit 0
fi

FRAMEWORKS_DIR="$APP_BUNDLE/Frameworks"
if [[ ! -d "$FRAMEWORKS_DIR" ]]; then
    echo "⚠️  Frameworks directory not found. Skipping dSYM generation."
    exit 0
fi

# Generate dSYM for Tss.framework
TSS_FRAMEWORK="$FRAMEWORKS_DIR/Tss.framework"
if [[ -d "$TSS_FRAMEWORK" ]] && [[ -f "$TSS_FRAMEWORK/Tss" ]]; then
    echo "📍 Found Tss.framework at: $TSS_FRAMEWORK"
    TSS_DSYM="$DSYM_DIR/Tss.framework.dSYM"
    echo "🔨 Generating dSYM for Tss.framework..."
    dsymutil "$TSS_FRAMEWORK/Tss" -o "$TSS_DSYM" 2>&1 || {
        echo "⚠️  Failed to generate dSYM for Tss.framework (this is non-fatal)"
    }
    if [[ -d "$TSS_DSYM" ]]; then
        echo "✅ Tss.framework dSYM generated at: $TSS_DSYM"
    fi
else
    echo "⚠️  Tss.framework not found in app bundle"
fi

# Generate dSYM for hermesvm.framework (Hermes)
HERMES_FRAMEWORK="$FRAMEWORKS_DIR/hermesvm.framework"
if [[ -d "$HERMES_FRAMEWORK" ]] && [[ -f "$HERMES_FRAMEWORK/hermesvm" ]]; then
    echo "📍 Found hermesvm.framework at: $HERMES_FRAMEWORK"
    HERMES_DSYM="$DSYM_DIR/hermesvm.framework.dSYM"
    echo "🔨 Generating dSYM for hermesvm.framework..."
    dsymutil "$HERMES_FRAMEWORK/hermesvm" -o "$HERMES_DSYM" 2>&1 || {
        echo "⚠️  Failed to generate dSYM for hermesvm.framework (this is non-fatal)"
    }
    if [[ -d "$HERMES_DSYM" ]]; then
        echo "✅ hermesvm.framework dSYM generated at: $HERMES_DSYM"
    fi
else
    # Try alternative location (sometimes it's just hermes.framework)
    HERMES_ALT="$FRAMEWORKS_DIR/hermes.framework"
    if [[ -d "$HERMES_ALT" ]] && [[ -f "$HERMES_ALT/hermes" ]]; then
        echo "📍 Found hermes.framework at: $HERMES_ALT"
        HERMES_DSYM="$DSYM_DIR/hermes.framework.dSYM"
        echo "🔨 Generating dSYM for hermes.framework..."
        dsymutil "$HERMES_ALT/hermes" -o "$HERMES_DSYM" 2>&1 || {
            echo "⚠️  Failed to generate dSYM for hermes.framework (this is non-fatal)"
        }
        if [[ -d "$HERMES_DSYM" ]]; then
            echo "✅ hermes.framework dSYM generated at: $HERMES_DSYM"
        fi
    else
        echo "⚠️  hermesvm.framework/hermes.framework not found in app bundle"
    fi
fi

echo ""
echo "📂 Final dSYM files:"
find "$DSYM_DIR" -name "*.dSYM" 2>/dev/null || echo "   (none found)"

echo "🎉 dSYM generation complete!"

