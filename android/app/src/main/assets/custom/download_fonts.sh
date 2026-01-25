#!/bin/bash

# Font Download Script for BoldWallet
# Downloads Inter and JetBrains Mono fonts for professional Bitcoin wallet UI

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}BoldWallet Font Download Script${NC}"
echo -e "${YELLOW}Inter + JetBrains Mono - Professional Bitcoin Wallet Typography${NC}"
echo "=========================================================="

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FONTS_DIR="$SCRIPT_DIR"

echo -e "Downloading fonts to: ${YELLOW}$FONTS_DIR${NC}"

# Create fonts directory if it doesn't exist
mkdir -p "$FONTS_DIR"

# Function to download a file with error handling
download_font() {
    local url="$1"
    local filename="$2"
    local filepath="$FONTS_DIR/$filename"

    echo -e "Downloading ${YELLOW}$filename${NC}..."

    if curl -L -f -o "$filepath" "$url"; then
        # Verify the file was downloaded and has reasonable size (> 50KB)
        if [[ -f "$filepath" ]] && [[ $(wc -c < "$filepath") -gt 50000 ]]; then
            echo -e "✅ ${GREEN}$filename downloaded successfully${NC}"
        else
            echo -e "❌ ${RED}$filename download failed - file too small or corrupted${NC}"
            rm -f "$filepath"
            return 1
        fi
    else
        echo -e "❌ ${RED}Failed to download $filename${NC}"
        return 1
    fi
}

# Download Inter fonts
echo -e "\n${YELLOW}Downloading Inter fonts (UI/Normal Text)...${NC}"
echo -e "${GREEN}Perfect for fintech UIs, neutral and trustworthy${NC}"

download_font "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.ttf" "Inter-Regular.ttf"
download_font "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Medium.ttf" "Inter-Medium.ttf"
download_font "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-SemiBold.ttf" "Inter-SemiBold.ttf"

# Download JetBrains Mono fonts
echo -e "\n${YELLOW}Downloading JetBrains Mono fonts (Addresses/Hashes)...${NC}"
echo -e "${GREEN}Engineered for precision, no character ambiguity${NC}"

download_font "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf" "JetBrainsMono-Regular.ttf"

# Try to download Medium and Bold weights if available
download_font "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Medium.ttf" "JetBrainsMono-Medium.ttf" || echo -e "${YELLOW}Note: JetBrainsMono-Medium not available, using Regular for medium weight${NC}"
download_font "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Bold.ttf" "JetBrainsMono-Bold.ttf" || echo -e "${YELLOW}Note: JetBrainsMono-Bold not available, using Regular for bold weight${NC}"

# List downloaded files with sizes
echo -e "\n${GREEN}Download Summary:${NC}"
echo "=================="

total_size=0
required_fonts=("Inter-Regular.ttf" "Inter-Medium.ttf" "Inter-SemiBold.ttf" "JetBrainsMono-Regular.ttf")
optional_fonts=("JetBrainsMono-Medium.ttf" "JetBrainsMono-Bold.ttf")

for font in "${required_fonts[@]}"; do
    filepath="$FONTS_DIR/$font"
    if [[ -f "$filepath" ]]; then
        size=$(wc -c < "$filepath")
        size_kb=$((size / 1024))
        total_size=$((total_size + size))
        echo -e "✅ $font - ${GREEN}${size_kb} KB${NC} (required)"
    else
        echo -e "❌ $font - ${RED}Missing (REQUIRED)${NC}"
    fi
done

for font in "${optional_fonts[@]}"; do
    filepath="$FONTS_DIR/$font"
    if [[ -f "$filepath" ]]; then
        size=$(wc -c < "$filepath")
        size_kb=$((size / 1024))
        total_size=$((total_size + size))
        echo -e "✅ $font - ${GREEN}${size_kb} KB${NC} (optional)"
    else
        echo -e "⚠️  $font - ${YELLOW}Missing (optional)${NC}"
    fi
done

total_size_kb=$((total_size / 1024))
echo "=================="
echo -e "Total size: ${GREEN}${total_size_kb} KB${NC}"

# Check if required fonts were downloaded
missing_required=0
for font in "${required_fonts[@]}"; do
    if [[ ! -f "$FONTS_DIR/$font" ]]; then
        missing_required=$((missing_required + 1))
    fi
done

if [[ $missing_required -eq 0 ]]; then
    echo -e "\n🎉 ${GREEN}All required fonts downloaded successfully!${NC}"
    echo -e "${GREEN}Your Bitcoin wallet now has professional, trust-focused typography${NC}"
    echo -e "\nFont Philosophy:"
    echo -e "• ${YELLOW}Inter${NC} - Quietly powerful, serious, trustworthy UI"
    echo -e "• ${YELLOW}JetBrains Mono${NC} - Precision for addresses, no ambiguity"
    echo -e "• ${GREEN}Typography that disappears - Bitcoin stays${NC}"
else
    echo -e "\n⚠️  ${YELLOW}$missing_required required font(s) failed to download.${NC}"
    echo -e "Please check the download URLs or try downloading manually from:"
    echo "- Inter: https://rsms.me/inter/"
    echo "- JetBrains Mono: https://www.jetbrains.com/lp/mono/"
    exit 1
fi

echo -e "\n${YELLOW}Important Notes:${NC}"
echo "• JetBrains Mono ligatures will be DISABLED in configuration"
echo "• Inter optimized for 14px+ sizes (perfect for mobile)"
echo "• Both fonts tested across Bitcoin wallets and fintech apps"

echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Verify all font files are present in the fonts directory"
echo "2. Continue with platform configuration (Android & iOS)"
echo "3. Update React Native configuration"
echo "4. Modify theme system to use Inter + JetBrains Mono"
echo "5. Test on both platforms - fonts should feel 'invisible'"

echo -e "\n${GREEN}Ready to build a professional Bitcoin wallet! 🚀${NC}"
