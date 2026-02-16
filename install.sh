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

# Desktop-Verknüpfung erstellen
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_FILE="$HOME/Schreibtisch/TJ-Trading-Journal.desktop"
# Fallback für englische Systeme
if [ ! -d "$HOME/Schreibtisch" ]; then
    DESKTOP_FILE="$HOME/Desktop/TJ-Trading-Journal.desktop"
fi

sed "s|INSTALL_PATH|$INSTALL_DIR|g" "$INSTALL_DIR/TJ-Trading-Journal.desktop" > "$DESKTOP_FILE"
chmod +x "$DESKTOP_FILE"
echo "Desktop-Verknüpfung erstellt: $DESKTOP_FILE"

echo ""
echo "================================"
echo "  Installation abgeschlossen!"
echo "================================"
echo ""
echo "Starten mit:  Doppelklick auf 'TJ Trading Journal' auf dem Desktop"
echo "Oder manuell: ./start-linux.sh"
echo ""
