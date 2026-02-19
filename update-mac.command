#!/bin/bash
# TJ Trading Journal — Update (macOS)
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
echo -e "${CYAN}${BOLD}  TJ Trading Journal — Update             ${RESET}"
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
    echo -e "${GRAY}  git pull origin master...${RESET}"
    git pull origin master
    if [ $? -ne 0 ]; then
        echo -e "${RED}[X] Git pull fehlgeschlagen!${RESET}"
        echo -e "${YELLOW}  Tipp: Lokale Aenderungen? Versuche: git stash && git pull && git stash pop${RESET}"
        exit 1
    fi
    echo -e "${GREEN}[OK]${RESET} Code aktualisiert"
else
    echo -e "${YELLOW}[!] Git nicht installiert — automatisches Update nicht moeglich.${RESET}"
    echo ""
    echo -e "${BOLD}Manuelles Update:${RESET}"
    echo "  1. Lade das neueste Release herunter:"
    echo -e "     ${CYAN}https://github.com/Mouses007/TJ-Trading-Journal/releases${RESET}"
    echo "  2. Entpacke die Dateien in diesen Ordner"
    echo -e "  3. ${RED}WICHTIG: tradenote.db NICHT ueberschreiben!${RESET}"
    echo "  4. Druecke Enter um fortzufahren..."
    read
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
