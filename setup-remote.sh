#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  Crypto Trading Journal - Komplette Einrichtung             ║
# ║  Fuer Ubuntu / Debian / Linux Mint                          ║
# ║                                                              ║
# ║  Dieses Script:                                              ║
# ║  1. Installiert alle Voraussetzungen (Node.js, Git, etc.)   ║
# ║  2. Laedt das Projekt von GitHub herunter                   ║
# ║  3. Baut die Anwendung                                      ║
# ║  4. Erstellt Desktop-Verknuepfung + Autostart (optional)    ║
# ║                                                              ║
# ║  Ausfuehren:                                                 ║
# ║    chmod +x setup-remote.sh && ./setup-remote.sh             ║
# ╚══════════════════════════════════════════════════════════════╝

set -e

# Farben
GREEN='\033[92m'
RED='\033[91m'
YELLOW='\033[93m'
CYAN='\033[96m'
GRAY='\033[90m'
BOLD='\033[1m'
RESET='\033[0m'

# Zielverzeichnis
INSTALL_DIR="$HOME/Crypto-Trading-Journal"
REPO_URL="https://github.com/Mouses007/Crypto-Trading-Journal.git"

echo ""
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "  ${CYAN}${BOLD}   Crypto Trading Journal - Komplette Einrichtung  ${RESET}"
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════════════${RESET}"
echo ""

# ══════════════════════════════════════════
#  SCHRITT 1: System aktualisieren + Pakete installieren
# ══════════════════════════════════════════
echo -e "  ${BOLD}[1/5] Installiere System-Pakete...${RESET}"
echo ""

sudo apt-get update -qq

# Git
if ! command -v git &>/dev/null; then
    echo -e "  ${CYAN}→ Installiere Git...${RESET}"
    sudo apt-get install -y git
fi
echo -e "  ${GREEN}[OK]${RESET}  Git                $(git --version | awk '{print $3}')"

# Build-Tools
if ! command -v gcc &>/dev/null || ! command -v make &>/dev/null; then
    echo -e "  ${CYAN}→ Installiere Build-Tools...${RESET}"
    sudo apt-get install -y build-essential
fi
echo -e "  ${GREEN}[OK]${RESET}  Build-Tools        gcc + make"

# Python 3
if ! command -v python3 &>/dev/null; then
    echo -e "  ${CYAN}→ Installiere Python 3...${RESET}"
    sudo apt-get install -y python3
fi
echo -e "  ${GREEN}[OK]${RESET}  Python 3           $(python3 --version 2>&1 | awk '{print $2}')"

# curl (fuer NodeSource)
if ! command -v curl &>/dev/null; then
    sudo apt-get install -y curl
fi

# Node.js 20+
NEED_NODE=0
if command -v node &>/dev/null; then
    NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -lt 20 ]; then
        NEED_NODE=1
    fi
else
    NEED_NODE=1
fi

if [ "$NEED_NODE" = "1" ]; then
    echo -e "  ${CYAN}→ Installiere Node.js 20+...${RESET}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo -e "  ${GREEN}[OK]${RESET}  Node.js            $(node -v)"
echo -e "  ${GREEN}[OK]${RESET}  npm                v$(npm -v)"

echo ""

# ══════════════════════════════════════════
#  SCHRITT 2: Projekt herunterladen
# ══════════════════════════════════════════
echo -e "  ${BOLD}[2/5] Lade Projekt herunter...${RESET}"
echo ""

if [ -d "$INSTALL_DIR" ]; then
    echo -e "  ${YELLOW}Ordner existiert bereits: $INSTALL_DIR${RESET}"
    echo -e "  ${CYAN}→ Aktualisiere mit git fetch + reset...${RESET}"
    cd "$INSTALL_DIR"
    git fetch origin master
    git reset --hard origin/master
else
    echo -e "  ${CYAN}→ Klone Repository...${RESET}"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

echo -e "  ${GREEN}[OK]${RESET}  Projekt in $INSTALL_DIR"
echo ""

# ══════════════════════════════════════════
#  SCHRITT 3: Abhaengigkeiten installieren
# ══════════════════════════════════════════
echo -e "  ${BOLD}[3/5] Installiere Abhaengigkeiten...${RESET}"
echo ""

npm install
if [ $? -ne 0 ]; then
    echo -e "  ${RED}FEHLER bei npm install!${RESET}"
    echo -e "  ${GRAY}Versuche: sudo apt-get install -y build-essential python3${RESET}"
    exit 1
fi

echo ""

# ══════════════════════════════════════════
#  SCHRITT 4: Frontend bauen
# ══════════════════════════════════════════
echo -e "  ${BOLD}[4/5] Baue Frontend...${RESET}"
echo ""

npm run build
if [ $? -ne 0 ]; then
    echo -e "  ${RED}FEHLER beim Frontend-Build!${RESET}"
    exit 1
fi

echo ""

# ══════════════════════════════════════════
#  SCHRITT 5: Start-Script + Desktop-Verknuepfung
# ══════════════════════════════════════════
echo -e "  ${BOLD}[5/5] Erstelle Start-Script und Desktop-Verknuepfung...${RESET}"
echo ""

# Start-Script erstellen
cat > "$INSTALL_DIR/start.sh" << 'STARTEOF'
#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "  Starte Crypto Trading Journal..."
echo "  Oeffne http://localhost:8080 im Browser"
echo ""
echo "  Zum Beenden: Ctrl+C"
echo ""

# Browser oeffnen (nach 2 Sekunden)
(sleep 2 && xdg-open http://localhost:8080 2>/dev/null) &

npm start
STARTEOF
chmod +x "$INSTALL_DIR/start.sh"

# Desktop-Ordner finden
if command -v xdg-user-dir &>/dev/null; then
    DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null)"
fi
if [ -z "$DESKTOP_DIR" ] || [ ! -d "$DESKTOP_DIR" ]; then
    if [ -d "$HOME/Schreibtisch" ]; then
        DESKTOP_DIR="$HOME/Schreibtisch"
    elif [ -d "$HOME/Desktop" ]; then
        DESKTOP_DIR="$HOME/Desktop"
    else
        DESKTOP_DIR="$HOME/Desktop"
        mkdir -p "$DESKTOP_DIR" 2>/dev/null || true
    fi
fi

# .desktop Datei erstellen
DESKTOP_FILE="$DESKTOP_DIR/Crypto-Trading-Journal.desktop"
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=Crypto Trading Journal
Comment=Trading Journal starten
Exec=bash -c 'cd "$INSTALL_DIR" && ./start.sh'
Icon=$INSTALL_DIR/src/assets/icon.png
Terminal=true
Type=Application
Categories=Office;Finance;
EOF
chmod +x "$DESKTOP_FILE"

# GNOME: als vertrauenswuerdig markieren
if command -v gio &>/dev/null; then
    gio set "$DESKTOP_FILE" metadata::trusted true 2>/dev/null || true
fi

echo -e "  ${GREEN}[OK]${RESET}  Start-Script erstellt: $INSTALL_DIR/start.sh"
echo -e "  ${GREEN}[OK]${RESET}  Desktop-Verknuepfung erstellt"

# ══════════════════════════════════════════
#  FERTIG!
# ══════════════════════════════════════════
echo ""
echo -e "  ${GREEN}══════════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}${BOLD}    Installation erfolgreich abgeschlossen!        ${RESET}"
echo -e "  ${GREEN}══════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}So startest du das Trading Journal:${RESET}"
echo ""
echo -e "    ${CYAN}Option 1:${RESET} Doppelklick auf '${BOLD}Crypto Trading Journal${RESET}' am Desktop"
echo -e "    ${CYAN}Option 2:${RESET} Im Terminal: ${BOLD}cd $INSTALL_DIR && ./start.sh${RESET}"
echo ""
echo -e "  ${BOLD}Dann im Browser oeffnen:${RESET} ${CYAN}http://localhost:8080${RESET}"
echo ""
echo -e "  ${BOLD}Updates:${RESET} Werden automatisch in der App angezeigt (gruener Button in der Seitenleiste)"
echo ""
echo -e "  ${GRAY}Erster Start: Gehe zu Einstellungen und richte deine Boerse ein (Bitunix/Bitget API Keys)${RESET}"
echo ""

# Fragen ob direkt starten
echo -en "  ${BOLD}Moechtest du das Trading Journal jetzt starten? [J/n]:${RESET} "
read -r START_NOW
echo ""

if [ -z "$START_NOW" ] || echo "$START_NOW" | grep -iq "^[jy]"; then
    cd "$INSTALL_DIR"
    exec ./start.sh
fi
