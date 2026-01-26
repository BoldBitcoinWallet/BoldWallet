#!/bin/bash

# Font Setup Script for BoldWallet
# Sets up Inter and JetBrains Mono fonts for professional Bitcoin wallet UI

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}BoldWallet Font Setup${NC}"
echo -e "${YELLOW}Inter + JetBrains Mono - Professional Typography${NC}"
echo "================================================"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FONTS_DIR="$SCRIPT_DIR"

echo -e "Setting up fonts in: ${YELLOW}$FONTS_DIR${NC}"

# Create fonts directory if it doesn't exist
mkdir -p "$FONTS_DIR"

# Function to create placeholder font file
create_placeholder() {
    local filename="$1"
    local description="$2"
    local filepath="$FONTS_DIR/$filename"

    if [[ ! -f "$filepath" ]]; then
        echo -e "Creating placeholder: ${YELLOW}$filename${NC}"
        echo "# $description - PLACEHOLDER FILE" > "$filepath"
        echo "# This is a placeholder. Replace with actual TTF font file." >> "$filepath"
        echo "# Download from the official source and replace this file." >> "$filepath"
        echo "# File should be approximately 300-400KB for Inter, 250-300KB for JetBrains Mono." >> "$filepath"
    else
        echo -e "✅ ${GREEN}$filename already exists${NC}"
    fi
}

echo -e "\n${BLUE}Creating font placeholders...${NC}"

# Create Inter font placeholders
create_placeholder "Inter-Regular.ttf" "Inter Regular (400) - UI text"
create_placeholder "Inter-Medium.ttf" "Inter Medium (500) - Emphasized UI text"
create_placeholder "Inter-SemiBold.ttf" "Inter SemiBold (600) - Headers and buttons"

# Create JetBrains Mono placeholders
create_placeholder "JetBrainsMono-Regular.ttf" "JetBrains Mono Regular (400) - Bitcoin addresses and hashes"

echo -e "\n${YELLOW}Font Download Instructions:${NC}"
echo "=========================================="

echo -e "\n${BLUE}1. Download Inter fonts:${NC}"
echo "   Visit: https://rsms.me/inter/"
echo "   - Click 'Download Inter' button"
echo "   - Extract the ZIP file"
echo "   - Copy the following files from the 'extras/ttf' folder:"
echo "     • Inter-Regular.ttf"
echo "     • Inter-Medium.ttf"
echo "     • Inter-SemiBold.ttf"

echo -e "\n${BLUE}2. Download JetBrains Mono fonts:${NC}"
echo "   Visit: https://www.jetbrains.com/lp/mono/"
echo "   - Click 'Download font' button"
echo "   - Extract the ZIP file"
echo "   - Copy the following files from the 'fonts/ttf' folder:"
echo "     • JetBrainsMono-Regular.ttf"
echo "     • JetBrainsMono-Medium.ttf (optional)"
echo "     • JetBrainsMono-Bold.ttf (optional)"

echo -e "\n${BLUE}3. Alternative - Google Fonts:${NC}"
echo "   Inter: https://fonts.google.com/specimen/Inter"
echo "   JetBrains Mono: https://fonts.google.com/specimen/JetBrains+Mono"
echo "   - Select weights: 400, 500, 600"
echo "   - Download and extract TTF files"

echo -e "\n${YELLOW}Important Notes:${NC}"
echo "• Replace the placeholder files with actual TTF font files"
echo "• Inter-Regular.ttf, Inter-Medium.ttf, Inter-SemiBold.ttf are REQUIRED"
echo "• JetBrainsMono-Regular.ttf is REQUIRED for Bitcoin addresses"
echo "• JetBrains Mono Medium/Bold are optional (will fallback to Regular)"
echo "• Ligatures will be automatically disabled for JetBrains Mono"

echo -e "\n${GREEN}Font Philosophy:${NC}"
echo "• Inter: Quietly powerful, serious, trustworthy UI"
echo "• JetBrains Mono: Precision for addresses, no character ambiguity"
echo "• Typography that disappears — Bitcoin stays"

echo -e "\n${BLUE}Verification:${NC}"
echo "After downloading real fonts, run this command to verify:"
echo "ls -la $FONTS_DIR/*.ttf | awk '{if(\$5 > 100000) print \$9, \"✅ (\"\$5/1024\"KB)\"; else print \$9, \"❌ Too small\"}'"

echo -e "\n${GREEN}Next Steps:${NC}"
echo "1. Download the actual font files using the instructions above"
echo "2. Replace the placeholder files in this directory"
echo "3. Continue with the font implementation setup"

echo -e "\n${YELLOW}Ready to build professional Bitcoin wallet typography! 🚀${NC}"
