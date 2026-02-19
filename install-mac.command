#!/bin/bash
# Crypto Trading Journal - Installer for macOS
# Doppelklick auf diese Datei oder: chmod +x install-mac.command && ./install-mac.command

set -e
cd "$(dirname "$0")"

# Farben
GREEN='\033[92m'
RED='\033[91m'
YELLOW='\033[93m'
CYAN='\033[96m'
GRAY='\033[90m'
BOLD='\033[1m'
RESET='\033[0m'

MANDATORY_MISSING=0

echo ""
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo -e "  ${CYAN}${BOLD}     Crypto Trading Journal - Installer       ${RESET}"
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${GRAY}Pruefe System-Voraussetzungen...${RESET}"
echo ""

# ══════════════════════════════════════════
#  CHECK 1: Xcode Command Line Tools
# ══════════════════════════════════════════
if xcode-select -p &>/dev/null; then
    echo -e "  ${GREEN}[OK]${RESET}  Xcode CLI Tools    Gefunden"
else
    echo -e "  ${RED}[!!]${RESET}  Xcode CLI Tools    ${RED}Nicht gefunden${RESET}"
    echo -e "  ${GRAY}       Wird jetzt installiert...${RESET}"
    xcode-select --install 2>/dev/null || true
    echo -e "  ${YELLOW}[!]${RESET}  Bitte das Xcode-Installationsfenster bestaetigen und danach dieses Script erneut starten."
    echo ""
    read -p "  Weiter mit Enter (falls bereits installiert)..."
fi

# ══════════════════════════════════════════
#  CHECK 2: Node.js 20+
# ══════════════════════════════════════════
if command -v node &>/dev/null; then
    NODE_VER=$(node -v)
    NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 20 ]; then
        echo -e "  ${GREEN}[OK]${RESET}  Node.js            ${NODE_VER}"
    else
        echo -e "  ${RED}[!!]${RESET}  Node.js            ${NODE_VER} ${RED}(Version 20+ erforderlich)${RESET}"
        MANDATORY_MISSING=1
    fi
else
    echo -e "  ${RED}[!!]${RESET}  Node.js            ${RED}Nicht gefunden${RESET}"
    MANDATORY_MISSING=1
fi

# ══════════════════════════════════════════
#  CHECK 3: npm
# ══════════════════════════════════════════
if command -v npm &>/dev/null; then
    NPM_VER=$(npm -v)
    echo -e "  ${GREEN}[OK]${RESET}  npm                v${NPM_VER}"
else
    echo -e "  ${RED}[!!]${RESET}  npm                ${RED}Nicht gefunden${RESET}"
    MANDATORY_MISSING=1
fi

# ══════════════════════════════════════════
#  CHECK 4: Python 3
# ══════════════════════════════════════════
PY_OK=0
if command -v python3 &>/dev/null; then
    PY_VER=$(python3 --version 2>&1 | awk '{print $2}')
    echo -e "  ${GREEN}[OK]${RESET}  Python             ${PY_VER}"
    PY_OK=1
elif command -v python &>/dev/null; then
    PY_VER=$(python --version 2>&1 | awk '{print $2}')
    PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
    if [ "$PY_MAJOR" = "3" ]; then
        echo -e "  ${GREEN}[OK]${RESET}  Python             ${PY_VER}"
        PY_OK=1
    fi
fi
if [ "$PY_OK" = "0" ]; then
    echo -e "  ${RED}[!!]${RESET}  Python 3           ${RED}Nicht gefunden${RESET}"
    MANDATORY_MISSING=1
fi

# ══════════════════════════════════════════
#  CHECK 5: Ollama (optional)
# ══════════════════════════════════════════
if command -v ollama &>/dev/null; then
    echo -e "  ${GREEN}[OK]${RESET}  Ollama             Gefunden ${GRAY}(optional)${RESET}"
else
    echo -e "  ${YELLOW}[--]${RESET}  Ollama             ${YELLOW}Nicht installiert${RESET} ${GRAY}(optional, fuer lokale KI)${RESET}"
fi

# ══════════════════════════════════════════
#  CHECK 6: Git (optional)
# ══════════════════════════════════════════
if command -v git &>/dev/null; then
    GIT_VER=$(git --version | awk '{print $3}')
    echo -e "  ${GREEN}[OK]${RESET}  Git                ${GIT_VER} ${GRAY}(optional)${RESET}"
else
    echo -e "  ${YELLOW}[--]${RESET}  Git                ${YELLOW}Nicht installiert${RESET} ${GRAY}(optional)${RESET}"
fi

# ══════════════════════════════════════════
#  CHECK 7: Homebrew (optional)
# ══════════════════════════════════════════
if command -v brew &>/dev/null; then
    echo -e "  ${GREEN}[OK]${RESET}  Homebrew           Gefunden ${GRAY}(optional)${RESET}"
else
    echo -e "  ${YELLOW}[--]${RESET}  Homebrew           ${YELLOW}Nicht installiert${RESET} ${GRAY}(optional)${RESET}"
fi

echo ""
echo -e "  ${GRAY}══════════════════════════════════════════${RESET}"
echo ""

# ══════════════════════════════════════════
#  Pflicht-Komponenten fehlen?
# ══════════════════════════════════════════
if [ "$MANDATORY_MISSING" = "1" ]; then
    echo -e "  ${RED}${BOLD}Fehlende Pflicht-Komponenten!${RESET}"
    echo -e "  ${RED}Die Installation kann nicht fortgesetzt werden.${RESET}"
    echo ""
    echo -e "  ${BOLD}Empfohlene Installation via Homebrew:${RESET}"
    echo ""

    if ! command -v brew &>/dev/null; then
        echo -e "  ${CYAN}1. Homebrew installieren:${RESET}"
        echo '     /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
        echo ""
    fi

    if ! command -v node &>/dev/null || [ "${NODE_MAJOR:-0}" -lt 20 ]; then
        echo -e "  ${CYAN}Node.js 20+:${RESET}"
        echo "     brew install node@20"
        echo "     Oder: https://nodejs.org/"
        echo ""
    fi

    if [ "$PY_OK" = "0" ]; then
        echo -e "  ${CYAN}Python 3:${RESET}"
        echo "     brew install python3"
        echo "     Oder: https://www.python.org/downloads/"
        echo ""
    fi

    echo -e "  ${GRAY}Nach der Installation dieses Script erneut starten.${RESET}"
    echo ""
    exit 1
fi

# ══════════════════════════════════════════
#  Hinweise
# ══════════════════════════════════════════
if ! command -v ollama &>/dev/null; then
    echo -e "  ${YELLOW}Hinweis:${RESET} Ollama ist nicht installiert."
    echo -e "  Fuer lokale KI-Berichte: ${CYAN}https://ollama.ai/${RESET}"
    echo ""
fi

# ══════════════════════════════════════════
#  Installation starten
# ══════════════════════════════════════════
echo -e "  ${BOLD}Alle Voraussetzungen erfuellt - starte Installation...${RESET}"
echo ""

echo -e "  [1/2] Installiere Abhaengigkeiten..."
echo ""
npm install
if [ $? -ne 0 ]; then
    echo ""
    echo -e "  ${RED}FEHLER bei npm install!${RESET}"
    echo -e "  ${YELLOW}Tipp: Versuche 'xcode-select --install' falls Build-Fehler auftreten${RESET}"
    exit 1
fi

echo ""
echo -e "  [2/2] Baue Frontend..."
echo ""
npm run build
if [ $? -ne 0 ]; then
    echo ""
    echo -e "  ${RED}FEHLER beim Frontend-Build!${RESET}"
    exit 1
fi

# ══════════════════════════════════════════
#  Desktop-Verknuepfung erstellen
# ══════════════════════════════════════════
echo ""
echo -e "  Erstelle Desktop-Verknuepfung..."

INSTALL_DIR="$(pwd)"
DESKTOP_DIR="$HOME/Desktop"

# .command-Datei als Shortcut auf dem Desktop
SHORTCUT="$DESKTOP_DIR/Crypto Trading Journal.command"
cat > "$SHORTCUT" << INNEREOF
#!/bin/bash
cd "$INSTALL_DIR"
./start-mac.command
INNEREOF
chmod +x "$SHORTCUT"

if [ -f "$SHORTCUT" ]; then
    echo -e "  ${GREEN}[OK]${RESET} Desktop-Verknuepfung erstellt"
else
    echo -e "  ${YELLOW}[!]${RESET} Desktop-Verknuepfung konnte nicht erstellt werden"
fi

# ══════════════════════════════════════════
#  Erfolg
# ══════════════════════════════════════════
echo ""
echo -e "  ${GREEN}══════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}${BOLD}  Installation erfolgreich abgeschlossen!${RESET}"
echo -e "  ${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Starten:${RESET}   Doppelklick auf 'Crypto Trading Journal' am Desktop"
echo -e "  ${BOLD}Oder:${RESET}      ./start-mac.command"
echo -e "  ${BOLD}Browser:${RESET}   http://localhost:8080"
echo ""
