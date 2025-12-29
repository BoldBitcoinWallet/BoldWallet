#!/bin/bash

set -e

# Build bold-spend for multiple platforms
BINARY_NAME="bold-spend"
MAIN_PATH="./tss/cmd/bold-spend"

echo "Building bold-spend for multiple platforms..."

# Linux AMD64
echo "Building for Linux AMD64..."
GOOS=linux GOARCH=amd64 go build -o "bin/${BINARY_NAME}-linux-amd64" "$MAIN_PATH"
echo "✓ Linux AMD64: bin/${BINARY_NAME}-linux-amd64"

# Linux ARM64
echo "Building for Linux ARM64..."
GOOS=linux GOARCH=arm64 go build -o "bin/${BINARY_NAME}-linux-arm64" "$MAIN_PATH"
echo "✓ Linux ARM64: bin/${BINARY_NAME}-linux-arm64"

# macOS AMD64 (Intel)
echo "Building for macOS AMD64 (Intel)..."
GOOS=darwin GOARCH=amd64 go build -o "bin/${BINARY_NAME}-darwin-amd64" "$MAIN_PATH"
echo "✓ macOS AMD64: bin/${BINARY_NAME}-darwin-amd64"

# macOS ARM64 (Apple Silicon)
echo "Building for macOS ARM64 (Apple Silicon)..."
GOOS=darwin GOARCH=arm64 go build -o "bin/${BINARY_NAME}-darwin-arm64" "$MAIN_PATH"
echo "✓ macOS ARM64: bin/${BINARY_NAME}-darwin-arm64"

# Windows AMD64
echo "Building for Windows AMD64..."
GOOS=windows GOARCH=amd64 go build -o "bin/${BINARY_NAME}-windows-amd64.exe" "$MAIN_PATH"
echo "✓ Windows AMD64: bin/${BINARY_NAME}-windows-amd64.exe"

# Windows ARM64
echo "Building for Windows ARM64..."
GOOS=windows GOARCH=arm64 go build -o "bin/${BINARY_NAME}-windows-arm64.exe" "$MAIN_PATH"
echo "✓ Windows ARM64: bin/${BINARY_NAME}-windows-arm64.exe"

echo ""
echo "All builds complete! Binaries are in the bin/ directory:"
ls -lh bin/${BINARY_NAME}-*
