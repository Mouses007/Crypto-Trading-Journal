#!/bin/bash
# Crypto Trading Journal - Installer for Linux (Ubuntu/Mint/Debian/Fedora/Arch)
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
echo -e "  ${CYAN}${BOLD}     Crypto Trading Journal - Installer       ${RESET}"
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
#  CHECK 7: Git (erforderlich fuer Updates)
# ══════════════════════════════════════════
GIT_OK=0
if command -v git &>/dev/null; then
    GIT_OK=1
    GIT_VER=$(git --version | awk '{print $3}')
    echo -e "  ${GREEN}[OK]${RESET}  Git                ${GIT_VER}"
else
    echo -e "  ${RED}[!!]${RESET}  Git                ${RED}Nicht gefunden${RESET} ${GRAY}(erforderlich fuer Updates)${RESET}"
    MANDATORY_MISSING=1
fi

echo ""
echo -e "  ${GRAY}══════════════════════════════════════════${RESET}"
echo ""

# ══════════════════════════════════════════
#  Pflicht-Komponenten fehlen? → Auto-Installation anbieten
# ══════════════════════════════════════════
if [ "$MANDATORY_MISSING" = "1" ]; then
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

    NEED_NODE=0
    NEED_PYTHON=0
    NEED_BUILD=0
    NEED_GIT=0

    if ! command -v node &>/dev/null || [ "${NODE_MAJOR:-0}" -lt 20 ]; then
        NEED_NODE=1
    fi
    if [ "$PY_OK" = "0" ]; then
        NEED_PYTHON=1
    fi
    if [ "$BUILD_OK" = "0" ]; then
        NEED_BUILD=1
    fi
    if [ "$GIT_OK" = "0" ]; then
        NEED_GIT=1
    fi

    # Pruefen ob automatische Installation moeglich ist
    if [ "$DISTRO" = "unknown" ]; then
        echo -e "  ${RED}${BOLD}Fehlende Pflicht-Komponenten!${RESET}"
        echo -e "  ${RED}Deine Linux-Distribution wurde nicht erkannt.${RESET}"
        echo -e "  ${RED}Bitte installiere die fehlenden Pakete manuell:${RESET}"
        echo ""
        [ "$NEED_NODE" = "1" ] && echo -e "  ${CYAN}- Node.js 20+${RESET}  →  https://nodejs.org/"
        [ "$NEED_PYTHON" = "1" ] && echo -e "  ${CYAN}- Python 3${RESET}"
        [ "$NEED_BUILD" = "1" ] && echo -e "  ${CYAN}- Build-Tools (gcc, make)${RESET}"
        [ "$NEED_GIT" = "1" ] && echo -e "  ${CYAN}- Git${RESET}  →  https://git-scm.com/"
        echo ""
        echo -e "  ${GRAY}Danach dieses Script erneut starten.${RESET}"
        echo ""
        exit 1
    fi

    # Fehlende Pakete auflisten
    echo -e "  ${YELLOW}${BOLD}Fehlende Pflicht-Komponenten gefunden:${RESET}"
    echo ""
    [ "$NEED_NODE" = "1" ] && echo -e "    ${CYAN}•${RESET} Node.js 20+"
    [ "$NEED_PYTHON" = "1" ] && echo -e "    ${CYAN}•${RESET} Python 3"
    [ "$NEED_BUILD" = "1" ] && echo -e "    ${CYAN}•${RESET} Build-Tools (gcc, make)"
    [ "$NEED_GIT" = "1" ] && echo -e "    ${CYAN}•${RESET} Git"
    echo ""

    echo -en "  ${BOLD}Sollen die fehlenden Pakete jetzt automatisch installiert werden? [J/n]:${RESET} "
    read -r ANSWER
    echo ""

    # Standard ist Ja (Enter = Ja)
    if [ -z "$ANSWER" ] || echo "$ANSWER" | grep -iq "^[jy]"; then

        echo -e "  ${BOLD}Installiere fehlende Pakete...${RESET}"
        echo ""

        # ── Git ──
        if [ "$NEED_GIT" = "1" ]; then
            echo -e "  ${CYAN}→ Installiere Git...${RESET}"
            case "$DISTRO" in
                debian) sudo apt-get update -qq && sudo apt-get install -y git ;;
                fedora) sudo dnf install -y git ;;
                arch)   sudo pacman -S --noconfirm git ;;
            esac
            echo ""
        fi

        # ── Build-Tools ──
        if [ "$NEED_BUILD" = "1" ]; then
            echo -e "  ${CYAN}→ Installiere Build-Tools...${RESET}"
            case "$DISTRO" in
                debian) sudo apt-get update -qq && sudo apt-get install -y build-essential ;;
                fedora) sudo dnf groupinstall -y 'Development Tools' ;;
                arch)   sudo pacman -S --noconfirm base-devel ;;
            esac
            echo ""
        fi

        # ── Python 3 ──
        if [ "$NEED_PYTHON" = "1" ]; then
            echo -e "  ${CYAN}→ Installiere Python 3...${RESET}"
            case "$DISTRO" in
                debian) sudo apt-get install -y python3 ;;
                fedora) sudo dnf install -y python3 ;;
                arch)   sudo pacman -S --noconfirm python ;;
            esac
            echo ""
        fi

        # ── Node.js 20+ ──
        if [ "$NEED_NODE" = "1" ]; then
            echo -e "  ${CYAN}→ Installiere Node.js 20+...${RESET}"
            case "$DISTRO" in
                debian)
                    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                    ;;
                fedora)
                    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                    sudo dnf install -y nodejs
                    ;;
                arch)
                    sudo pacman -S --noconfirm nodejs npm
                    ;;
            esac
            echo ""
        fi

        # ── Ergebnis pruefen ──
        echo ""
        echo -e "  ${GRAY}Pruefe Installation...${RESET}"
        echo ""

        STILL_MISSING=0

        if command -v node &>/dev/null; then
            NEW_NODE_VER=$(node -v)
            NEW_NODE_MAJOR=$(echo "$NEW_NODE_VER" | sed 's/v//' | cut -d. -f1)
            if [ "$NEW_NODE_MAJOR" -ge 20 ]; then
                echo -e "  ${GREEN}[OK]${RESET}  Node.js            ${NEW_NODE_VER}"
            else
                echo -e "  ${RED}[!!]${RESET}  Node.js            ${NEW_NODE_VER} ${RED}(immer noch < 20)${RESET}"
                STILL_MISSING=1
            fi
        else
            echo -e "  ${RED}[!!]${RESET}  Node.js            ${RED}Installation fehlgeschlagen${RESET}"
            STILL_MISSING=1
        fi

        if command -v python3 &>/dev/null; then
            echo -e "  ${GREEN}[OK]${RESET}  Python 3           $(python3 --version 2>&1 | awk '{print $2}')"
        elif [ "$NEED_PYTHON" = "1" ]; then
            echo -e "  ${RED}[!!]${RESET}  Python 3           ${RED}Installation fehlgeschlagen${RESET}"
            STILL_MISSING=1
        fi

        if command -v gcc &>/dev/null && command -v make &>/dev/null; then
            echo -e "  ${GREEN}[OK]${RESET}  Build-Tools        gcc + make gefunden"
        elif [ "$NEED_BUILD" = "1" ]; then
            echo -e "  ${RED}[!!]${RESET}  Build-Tools        ${RED}Installation fehlgeschlagen${RESET}"
            STILL_MISSING=1
        fi

        if command -v git &>/dev/null; then
            echo -e "  ${GREEN}[OK]${RESET}  Git                $(git --version | awk '{print $3}')"
            GIT_OK=1
        elif [ "$NEED_GIT" = "1" ]; then
            echo -e "  ${RED}[!!]${RESET}  Git                ${RED}Installation fehlgeschlagen${RESET}"
            STILL_MISSING=1
        fi

        echo ""

        if [ "$STILL_MISSING" = "1" ]; then
            echo -e "  ${RED}Einige Pakete konnten nicht installiert werden.${RESET}"
            echo -e "  ${GRAY}Bitte manuell installieren und dieses Script erneut starten.${RESET}"
            echo ""
            exit 1
        fi

        echo -e "  ${GREEN}Alle Pakete erfolgreich installiert!${RESET}"
        echo ""

    else
        # Benutzer will nicht automatisch installieren → manuelle Befehle zeigen
        echo -e "  ${BOLD}Bitte installiere die Pakete manuell:${RESET}"
        echo ""

        if [ "$NEED_NODE" = "1" ]; then
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
            esac
            echo ""
        fi

        if [ "$NEED_PYTHON" = "1" ]; then
            echo -e "  ${CYAN}Python 3:${RESET}"
            case "$DISTRO" in
                debian) echo "     sudo apt-get install -y python3" ;;
                fedora) echo "     sudo dnf install -y python3" ;;
                arch)   echo "     sudo pacman -S python" ;;
            esac
            echo ""
        fi

        if [ "$NEED_BUILD" = "1" ]; then
            echo -e "  ${CYAN}Build-Tools (gcc, make):${RESET}"
            case "$DISTRO" in
                debian) echo "     sudo apt-get install -y build-essential" ;;
                fedora) echo "     sudo dnf groupinstall -y 'Development Tools'" ;;
                arch)   echo "     sudo pacman -S base-devel" ;;
            esac
            echo ""
        fi

        if [ "$NEED_GIT" = "1" ]; then
            echo -e "  ${CYAN}Git:${RESET}"
            case "$DISTRO" in
                debian) echo "     sudo apt-get install -y git" ;;
                fedora) echo "     sudo dnf install -y git" ;;
                arch)   echo "     sudo pacman -S git" ;;
            esac
            echo ""
        fi

        echo -e "  ${GRAY}Danach dieses Script erneut starten.${RESET}"
        echo ""
        exit 1
    fi
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
# ══════════════════════════════════════════
#  Git-Repository initialisieren (fuer Auto-Updates)
# ══════════════════════════════════════════
if [ ! -d ".git" ]; then
    if [ "$GIT_OK" = "1" ]; then
        echo -e "  ${CYAN}Git-Repository initialisieren (fuer Auto-Updates)...${RESET}"
        git init >/dev/null 2>&1
        git remote add origin https://github.com/Mouses007/Crypto-Trading-Journal.git >/dev/null 2>&1
        if git fetch origin master >/dev/null 2>&1; then
            echo -e "  ${GREEN}[OK]${RESET}  Git-Repository     Initialisiert"
        else
            echo -e "  ${YELLOW}[!]${RESET}   Git-Repository     Konnte nicht initialisiert werden"
            echo -e "  ${GRAY}       Auto-Updates sind moeglicherweise nicht verfuegbar${RESET}"
        fi
        echo ""
    else
        echo -e "  ${YELLOW}Hinweis:${RESET} Ohne Git sind keine Auto-Updates moeglich."
        echo -e "  ${GRAY}Installiere Git und starte den Installer erneut fuer Update-Support.${RESET}"
        echo ""
    fi
else
    echo -e "  ${GREEN}[OK]${RESET}  Git-Repository     Vorhanden"
    echo ""
fi

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
DESKTOP_FILE="$DESKTOP_DIR/Crypto-Trading-Journal.desktop"
if [ -f "$INSTALL_DIR/Crypto-Trading-Journal.desktop" ]; then
    sed "s|INSTALL_PATH|$INSTALL_DIR|g" "$INSTALL_DIR/Crypto-Trading-Journal.desktop" > "$DESKTOP_FILE"
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
Name=Crypto Trading Journal
Comment=Trading Journal starten
Exec=bash -c 'cd "$INSTALL_DIR" && ./start-linux.sh'
Icon=$INSTALL_DIR/src/assets/icon.png
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
echo -e "  ${BOLD}Starten:${RESET}   Doppelklick auf 'Crypto Trading Journal' am Desktop"
echo -e "  ${BOLD}Oder:${RESET}      ./start-linux.sh"
echo -e "  ${BOLD}Browser:${RESET}   http://localhost:8080"
echo ""
