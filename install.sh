#!/bin/bash
# TJ Trading Journal - Installer for Linux (Ubuntu/Mint/Debian)

set -e

echo "================================"
echo "  TJ Trading Journal Installer"
echo "================================"
echo ""

# Check if Node.js is installed
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "Node.js gefunden: $NODE_VERSION"
else
    echo "Node.js nicht gefunden. Installiere Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "Node.js $(node -v) installiert."
fi

echo ""

# Install dependencies
echo "Installiere Abhängigkeiten..."
npm install

echo ""

# Build frontend
echo "Baue Frontend..."
npm run build

echo ""
echo "================================"
echo "  Installation abgeschlossen!"
echo "================================"
echo ""
echo "Starten mit:  npm start"
echo "Dann öffne:   http://localhost:8080"
echo ""
