#!/bin/bash
# Crypto Trading Journal — Update (macOS)
set -e
cd "$(dirname "$0")"

GREEN='\033[92m'
RED='\033[91m'
YELLOW='\033[93m'
CYAN='\033[96m'
GRAY='\033[90m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo -e "${CYAN}${BOLD}  Crypto Trading Journal — Update             ${RESET}"
echo -e "${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo ""

# Node.js Check
if ! command -v node &>/dev/null; then
    echo -e "${RED}[X] Node.js nicht gefunden! Bitte zuerst install-mac.command ausfuehren.${RESET}"
    exit 1
fi
echo -e "${GREEN}[OK]${RESET} Node.js gefunden"

# Datenbank-Backup
echo ""
echo -e "${CYAN}[1/4]${RESET} Datenbank-Backup..."
if [ -f "tradenote.db" ]; then
    cp tradenote.db tradenote.db.backup
    echo -e "${GREEN}[OK]${RESET} Backup erstellt: tradenote.db.backup"
else
    echo -e "${YELLOW}[!]${RESET} Keine Datenbank gefunden — Neuinstallation? Kein Backup noetig."
fi

# Code aktualisieren
echo ""
echo -e "${CYAN}[2/4]${RESET} Code aktualisieren..."
if command -v git &>/dev/null; then
    echo -e "${GRAY}  git fetch origin master...${RESET}"
    git fetch origin master
    if [ $? -ne 0 ]; then
        echo -e "${RED}[X] Git fetch fehlgeschlagen!${RESET}"
        echo -e "${YELLOW}  Tipp: Keine Internetverbindung? Remote korrekt konfiguriert?${RESET}"
        exit 1
    fi
    echo -e "${GRAY}  git reset --hard origin/master...${RESET}"
    git reset --hard origin/master
    if [ $? -ne 0 ]; then
        echo -e "${RED}[X] Git reset fehlgeschlagen!${RESET}"
        exit 1
    fi
    echo -e "${GREEN}[OK]${RESET} Code aktualisiert"
else
    echo -e "${RED}[X] Git nicht installiert — Update nicht moeglich.${RESET}"
    echo ""
    echo -e "${BOLD}Git installieren:${RESET}"
    echo -e "  ${CYAN}brew install git${RESET}"
    echo -e "  Oder: ${CYAN}xcode-select --install${RESET}"
    echo ""
    echo -e "  Danach dieses Script erneut starten."
    exit 1
fi

# npm install
echo ""
echo -e "${CYAN}[3/4]${RESET} Abhaengigkeiten aktualisieren..."
echo -e "${GRAY}  npm install...${RESET}"
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}[X] npm install fehlgeschlagen!${RESET}"
    exit 1
fi
echo -e "${GREEN}[OK]${RESET} Abhaengigkeiten aktualisiert"

# Build
echo ""
echo -e "${CYAN}[4/4]${RESET} Frontend bauen..."
echo -e "${GRAY}  npm run build...${RESET}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}[X] Build fehlgeschlagen!${RESET}"
    exit 1
fi
echo -e "${GREEN}[OK]${RESET} Frontend gebaut"

# Erfolg
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Update erfolgreich!                     ${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Datenbank:${RESET} Alle Daten erhalten"
if [ -f "tradenote.db.backup" ]; then
    echo -e "  ${BOLD}Backup:${RESET}    tradenote.db.backup"
fi
echo ""
echo -e "  ${CYAN}Starte mit: ./start-mac.command${RESET}"
echo ""
