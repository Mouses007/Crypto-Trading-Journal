#!/bin/bash
# Crypto Trading Journal - Manuelles Update
# Bei Update-Problemen: Diese Datei in den Installationsordner legen und ausfuehren:
#   chmod +x update.sh && ./update.sh

set -e
cd "$(dirname "$0")"

GREEN='\033[92m'
RED='\033[91m'
CYAN='\033[96m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo -e "  ${CYAN}${BOLD}   Crypto Trading Journal - Update        ${RESET}"
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo ""

# Pruefen ob wir im richtigen Ordner sind
if [ ! -f "package.json" ]; then
    echo -e "  ${RED}FEHLER: package.json nicht gefunden!${RESET}"
    echo -e "  Bitte lege diese Datei in den Installationsordner."
    echo ""
    exit 1
fi

OLD_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)" 2>/dev/null || echo "unbekannt")
echo -e "  Aktuelle Version: ${BOLD}v${OLD_VERSION}${RESET}"
echo ""

# Git-Repository pruefen / einrichten
if [ ! -d ".git" ]; then
    echo -e "  ${CYAN}Git-Repository wird eingerichtet...${RESET}"
    git init
    git remote add origin https://github.com/Mouses007/Crypto-Trading-Journal.git
fi

# Update holen
echo -e "  ${CYAN}[1/4] Lade neueste Version...${RESET}"
git fetch origin master

echo -e "  ${CYAN}[2/4] Installiere neueste Version...${RESET}"
git reset --hard origin/master

echo -e "  ${CYAN}[3/4] Installiere Abhaengigkeiten...${RESET}"
npm install

echo -e "  ${CYAN}[4/4] Baue Frontend...${RESET}"
npm run build

NEW_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)" 2>/dev/null || echo "unbekannt")

echo ""
echo -e "  ${GREEN}══════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}${BOLD}  Update erfolgreich!${RESET}"
echo -e "  ${GREEN}  v${OLD_VERSION} → v${NEW_VERSION}${RESET}"
echo -e "  ${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  Server neu starten mit: ${BOLD}./start-linux.sh${RESET}"
echo ""
