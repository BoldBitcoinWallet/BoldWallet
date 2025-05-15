#!/bin/bash
echo "🔄 Initializing submodules..."
git submodule update --init --recursive

echo "📦 Checking out BBMTLib at tag v1.0.0..."
cd BBMTLib
git fetch --tags
git checkout v1.0.0

cd ..
echo "✅ BBMTLib is now at tag v1.0.0"