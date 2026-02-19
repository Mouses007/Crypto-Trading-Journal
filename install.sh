#!/bin/bash
# TJ Trading Journal - Installer for Linux (Ubuntu/Mint/Debian/Fedora/Arch)
# Ausfuehren: chmod +x install.sh && ./install.sh

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
echo -e "  ${CYAN}${BOLD}     TJ Trading Journal - Installer       ${RESET}"
echo -e "  ${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${GRAY}Pruefe System-Voraussetzungen...${RESET}"
echo ""

# ══════════════════════════════════════════
#  CHECK 1: Node.js 20+
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
#  CHECK 2: npm
# ══════════════════════════════════════════
if command -v npm &>/dev/null; then
    NPM_VER=$(npm -v)
    echo -e "  ${GREEN}[OK]${RESET}  npm                v${NPM_VER}"
else
    echo -e "  ${RED}[!!]${RESET}  npm                ${RED}Nicht gefunden${RESET}"
    MANDATORY_MISSING=1
fi

# ══════════════════════════════════════════
#  CHECK 3: Python 3
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
#  CHECK 4: Build-Tools (gcc, make)
# ══════════════════════════════════════════
BUILD_OK=1
if ! command -v gcc &>/dev/null; then
    BUILD_OK=0
fi
if ! command -v make &>/dev/null; then
    BUILD_OK=0
fi

if [ "$BUILD_OK" = "1" ]; then
    GCC_VER=$(gcc --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+\.\d+' | head -1)
    echo -e "  ${GREEN}[OK]${RESET}  Build-Tools        gcc ${GCC_VER:-gefunden}, make gefunden"
else
    echo -e "  ${RED}[!!]${RESET}  Build-Tools        ${RED}gcc/make nicht gefunden${RESET}"
    MANDATORY_MISSING=1
fi

# ══════════════════════════════════════════
#  CHECK 5: Port 8080 frei
# ══════════════════════════════════════════
PORT_FREE=1
if command -v ss &>/dev/null; then
    if ss -tlnp 2>/dev/null | grep -q ":8080 "; then
        PORT_FREE=0
    fi
elif command -v netstat &>/dev/null; then
    if netstat -tlnp 2>/dev/null | grep -q ":8080 "; then
        PORT_FREE=0
    fi
fi

if [ "$PORT_FREE" = "1" ]; then
    echo -e "  ${GREEN}[OK]${RESET}  Port 8080          Frei"
else
    echo -e "  ${YELLOW}[!]${RESET}  Port 8080          ${YELLOW}Belegt${RESET} ${GRAY}(anderer Dienst laeuft auf 8080)${RESET}"
fi

# ══════════════════════════════════════════
#  CHECK 6: Ollama (optional)
# ══════════════════════════════════════════
if command -v ollama &>/dev/null; then
    echo -e "  ${GREEN}[OK]${RESET}  Ollama             Gefunden ${GRAY}(optional)${RESET}"
else
    echo -e "  ${YELLOW}[--]${RESET}  Ollama             ${YELLOW}Nicht installiert${RESET} ${GRAY}(optional, fuer lokale KI)${RESET}"
fi

# ══════════════════════════════════════════
#  CHECK 7: Git (optional)
# ══════════════════════════════════════════
if command -v git &>/dev/null; then
    GIT_VER=$(git --version | awk '{print $3}')
    echo -e "  ${GREEN}[OK]${RESET}  Git                ${GIT_VER} ${GRAY}(optional)${RESET}"
else
    echo -e "  ${YELLOW}[--]${RESET}  Git                ${YELLOW}Nicht installiert${RESET} ${GRAY}(optional)${RESET}"
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
    echo -e "  ${BOLD}Bitte installiere folgende Komponenten:${RESET}"
    echo ""

    # Distro erkennen fuer passende Installationsbefehle
    DISTRO="unknown"
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            ubuntu|debian|linuxmint|pop) DISTRO="debian" ;;
            fedora|rhel|centos|rocky|alma) DISTRO="fedora" ;;
            arch|manjaro|endeavouros) DISTRO="arch" ;;
        esac
    fi

    if ! command -v node &>/dev/null || [ "${NODE_MAJOR:-0}" -lt 20 ]; then
        echo -e "  ${CYAN}Node.js 20+:${RESET}"
        case "$DISTRO" in
            debian)
                echo "     curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
                echo "     sudo apt-get install -y nodejs"
                ;;
            fedora)
                echo "     curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -"
                echo "     sudo dnf install -y nodejs"
                ;;
            arch)
                echo "     sudo pacman -S nodejs npm"
                ;;
            *)
                echo "     https://nodejs.org/ (LTS-Version herunterladen)"
                ;;
        esac
        echo ""
    fi

    if [ "$PY_OK" = "0" ]; then
        echo -e "  ${CYAN}Python 3:${RESET}"
        case "$DISTRO" in
            debian) echo "     sudo apt-get install -y python3" ;;
            fedora) echo "     sudo dnf install -y python3" ;;
            arch)   echo "     sudo pacman -S python" ;;
            *)      echo "     https://www.python.org/downloads/" ;;
        esac
        echo ""
    fi

    if [ "$BUILD_OK" = "0" ]; then
        echo -e "  ${CYAN}Build-Tools (gcc, make):${RESET}"
        case "$DISTRO" in
            debian) echo "     sudo apt-get install -y build-essential" ;;
            fedora) echo "     sudo dnf groupinstall -y 'Development Tools'" ;;
            arch)   echo "     sudo pacman -S base-devel" ;;
            *)      echo "     Installiere gcc und make ueber deinen Paketmanager" ;;
        esac
        echo ""
    fi

    echo -e "  ${GRAY}Nach der Installation dieses Script erneut starten.${RESET}"
    echo ""
    exit 1
fi

# ══════════════════════════════════════════
#  Hinweise fuer optionale Komponenten
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
    echo ""
    echo -e "  ${YELLOW}Moegliche Ursachen:${RESET}"
    echo "  - Python oder Build-Tools nicht korrekt installiert"
    echo "  - Keine Internetverbindung"
    echo ""
    echo -e "  ${GRAY}Tipp: Versuche 'sudo apt-get install -y build-essential python3'${RESET}"
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

# Desktop-Ordner finden (deutsch/englisch/XDG)
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

# .desktop Datei aus Template erstellen
DESKTOP_FILE="$DESKTOP_DIR/TJ-Trading-Journal.desktop"
if [ -f "$INSTALL_DIR/TJ-Trading-Journal.desktop" ]; then
    sed "s|INSTALL_PATH|$INSTALL_DIR|g" "$INSTALL_DIR/TJ-Trading-Journal.desktop" > "$DESKTOP_FILE"
    chmod +x "$DESKTOP_FILE"
    # GNOME: als vertrauenswuerdig markieren
    if command -v gio &>/dev/null; then
        gio set "$DESKTOP_FILE" metadata::trusted true 2>/dev/null || true
    fi
    echo -e "  ${GREEN}[OK]${RESET} Desktop-Verknuepfung erstellt"
else
    # Fallback: .desktop-Datei direkt erstellen
    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=TJ Trading Journal
Comment=Trading Journal starten
Exec=bash -c 'cd "$INSTALL_DIR" && ./start-linux.sh'
Icon=$INSTALL_DIR/src/assets/tj-logo.png
Terminal=true
Type=Application
Categories=Office;Finance;
EOF
    chmod +x "$DESKTOP_FILE"
    if command -v gio &>/dev/null; then
        gio set "$DESKTOP_FILE" metadata::trusted true 2>/dev/null || true
    fi
    echo -e "  ${GREEN}[OK]${RESET} Desktop-Verknuepfung erstellt"
fi

# ══════════════════════════════════════════
#  Erfolg
# ══════════════════════════════════════════
echo ""
echo -e "  ${GREEN}══════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}${BOLD}  Installation erfolgreich abgeschlossen!${RESET}"
echo -e "  ${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Starten:${RESET}   Doppelklick auf 'TJ Trading Journal' am Desktop"
echo -e "  ${BOLD}Oder:${RESET}      ./start-linux.sh"
echo -e "  ${BOLD}Browser:${RESET}   http://localhost:8080"
echo ""
