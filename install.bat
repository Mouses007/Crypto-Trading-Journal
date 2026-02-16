@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: ANSI Escape-Zeichen generieren (Windows 10+)
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"

:: Farben definieren
set "GREEN=!ESC![92m"
set "RED=!ESC![91m"
set "YELLOW=!ESC![93m"
set "CYAN=!ESC![96m"
set "WHITE=!ESC![97m"
set "GRAY=!ESC![90m"
set "BOLD=!ESC![1m"
set "RESET=!ESC![0m"

:: Status-Variablen
set "NODE_OK=0"
set "PYTHON_OK=0"
set "VSBUILD_OK=0"
set "OLLAMA_OK=0"
set "GIT_OK=0"
set "NODE_VER="
set "PYTHON_VER="
set "GIT_VER="
set "MANDATORY_MISSING=0"

:: ══════════════════════════════════════════
::  Banner
:: ══════════════════════════════════════════
echo.
echo   !CYAN!══════════════════════════════════════════!RESET!
echo   !CYAN!!BOLD!     TJ Trading Journal - Installer       !RESET!
echo   !CYAN!══════════════════════════════════════════!RESET!
echo.
echo   !GRAY!Pruefe System-Voraussetzungen...!RESET!
echo.

:: ══════════════════════════════════════════
::  CHECK 1: Node.js 20+
:: ══════════════════════════════════════════
where node >nul 2>nul
if !errorlevel!==0 (
    for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
    :: Major-Version extrahieren: v20.11.0 -> 20
    for /f "tokens=1 delims=." %%a in ("!NODE_VER!") do set "NODE_RAW=%%a"
    set "NODE_MAJOR=!NODE_RAW:v=!"
    if !NODE_MAJOR! GEQ 20 (
        set "NODE_OK=1"
        echo   !GREEN![OK]!RESET!  Node.js            !NODE_VER!
    ) else (
        echo   !RED![!!]!RESET!  Node.js            !NODE_VER! !RED!^(Version 20+ erforderlich^)!RESET!
        set "MANDATORY_MISSING=1"
    )
) else (
    echo   !RED![!!]!RESET!  Node.js            !RED!Nicht gefunden!RESET!
    set "MANDATORY_MISSING=1"
)

:: ══════════════════════════════════════════
::  CHECK 2: Python 3
:: ══════════════════════════════════════════
set "PY_FOUND=0"

:: Versuch 1: python
where python >nul 2>nul
if !errorlevel!==0 (
    for /f "tokens=2 delims= " %%a in ('python --version 2^>^&1') do set "PY_VER_FULL=%%a"
    if defined PY_VER_FULL (
        for /f "tokens=1 delims=." %%b in ("!PY_VER_FULL!") do set "PY_MAJOR=%%b"
        if "!PY_MAJOR!"=="3" (
            set "PY_FOUND=1"
            set "PYTHON_OK=1"
            set "PYTHON_VER=!PY_VER_FULL!"
        )
    )
)

:: Versuch 2: python3 (falls python nicht gefunden)
if !PY_FOUND!==0 (
    where python3 >nul 2>nul
    if !errorlevel!==0 (
        for /f "tokens=2 delims= " %%a in ('python3 --version 2^>^&1') do set "PY_VER_FULL=%%a"
        if defined PY_VER_FULL (
            for /f "tokens=1 delims=." %%b in ("!PY_VER_FULL!") do set "PY_MAJOR=%%b"
            if "!PY_MAJOR!"=="3" (
                set "PYTHON_OK=1"
                set "PYTHON_VER=!PY_VER_FULL!"
            )
        )
    )
)

if !PYTHON_OK!==1 (
    echo   !GREEN![OK]!RESET!  Python             !PYTHON_VER!
) else (
    echo   !RED![!!]!RESET!  Python 3           !RED!Nicht gefunden!RESET!
    set "MANDATORY_MISSING=1"
)

:: ══════════════════════════════════════════
::  CHECK 3: Visual Studio Build Tools
:: ══════════════════════════════════════════
set "VS_FOUND=0"

:: Methode 1: vswhere.exe (Standard-Pfad vom VS Installer)
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "!VSWHERE!" (
    set "VS_FOUND=1"
    set "VSBUILD_OK=1"
    echo   !GREEN![OK]!RESET!  VS Build Tools     Gefunden
)

:: Methode 2: cl.exe im PATH (C++ Compiler)
if !VS_FOUND!==0 (
    where cl >nul 2>nul
    if !errorlevel!==0 (
        set "VSBUILD_OK=1"
        echo   !GREEN![OK]!RESET!  C++ Compiler       Gefunden ^(cl.exe^)
    ) else (
        echo   !RED![!!]!RESET!  VS Build Tools     !RED!Nicht gefunden!RESET!
        set "MANDATORY_MISSING=1"
    )
)

:: ══════════════════════════════════════════
::  CHECK 4: Ollama (optional)
:: ══════════════════════════════════════════
where ollama >nul 2>nul
if !errorlevel!==0 (
    set "OLLAMA_OK=1"
    echo   !GREEN![OK]!RESET!  Ollama             Gefunden !GRAY!^(optional^)!RESET!
) else (
    echo   !YELLOW![--]!RESET!  Ollama             !YELLOW!Nicht installiert!RESET! !GRAY!^(optional, fuer lokale KI^)!RESET!
)

:: ══════════════════════════════════════════
::  CHECK 5: Git (optional)
:: ══════════════════════════════════════════
where git >nul 2>nul
if !errorlevel!==0 (
    set "GIT_OK=1"
    for /f "tokens=3" %%v in ('git --version 2^>nul') do set "GIT_VER=%%v"
    echo   !GREEN![OK]!RESET!  Git                !GIT_VER! !GRAY!^(optional^)!RESET!
) else (
    echo   !YELLOW![--]!RESET!  Git                !YELLOW!Nicht installiert!RESET! !GRAY!^(optional^)!RESET!
)

echo.
echo   !GRAY!══════════════════════════════════════════!RESET!
echo.

:: ══════════════════════════════════════════
::  Pflicht-Komponenten fehlen?
:: ══════════════════════════════════════════
if !MANDATORY_MISSING!==1 (
    echo   !RED!!BOLD!Fehlende Pflicht-Komponenten!!RESET!
    echo   !RED!Die Installation kann nicht fortgesetzt werden.!RESET!
    echo.
    echo   !WHITE!Bitte installiere folgende Komponenten:!RESET!
    echo.

    if !NODE_OK!==0 (
        echo   !CYAN!Node.js 20+ ^(LTS^)!RESET!
        echo   !CYAN!https://nodejs.org/!RESET!
        echo   Waehle die LTS-Version und aktiviere "Add to PATH"
        echo.
    )

    if !PYTHON_OK!==0 (
        echo   !CYAN!Python 3!RESET!
        echo   !CYAN!https://www.python.org/downloads/!RESET!
        echo   WICHTIG: Bei der Installation "Add Python to PATH" ankreuzen!
        echo.
    )

    if !VSBUILD_OK!==0 (
        echo   !CYAN!Visual Studio Build Tools!RESET!
        echo   !CYAN!https://visualstudio.microsoft.com/visual-cpp-build-tools/!RESET!
        echo   Bei der Installation "Desktopentwicklung mit C++" auswaehlen
        echo.
    )

    echo   !GRAY!Nach der Installation dieses Script erneut starten.!RESET!
    echo.

    set /p "OPEN_LINKS=  Download-Links im Browser oeffnen? (j/n): "
    if /i "!OPEN_LINKS!"=="j" (
        if !NODE_OK!==0 start https://nodejs.org/
        if !PYTHON_OK!==0 start https://www.python.org/downloads/
        if !VSBUILD_OK!==0 start https://visualstudio.microsoft.com/visual-cpp-build-tools/
        echo.
        echo   !GREEN!Links wurden im Browser geoeffnet.!RESET!
    )

    echo.
    pause
    exit /b 1
)

:: ══════════════════════════════════════════
::  Hinweise fuer optionale Komponenten
:: ══════════════════════════════════════════
if !OLLAMA_OK!==0 (
    echo   !YELLOW!Hinweis:!RESET! Ollama ist nicht installiert.
    echo   Fuer lokale KI-Berichte: !CYAN!https://ollama.ai/!RESET!
    echo.
)

:: ══════════════════════════════════════════
::  Installation starten
:: ══════════════════════════════════════════
echo   !BOLD!Alle Voraussetzungen erfuellt - starte Installation...!RESET!
echo.

echo   !WHITE![1/2] Installiere Abhaengigkeiten...!RESET!
echo.
call npm install
if !errorlevel! neq 0 (
    echo.
    echo   !RED!FEHLER bei npm install!!RESET!
    echo.
    echo   !YELLOW!Moegliche Ursachen:!RESET!
    echo   - Python oder Build Tools nicht korrekt installiert
    echo   - Keine Internetverbindung
    echo   - Firewall blockiert npm
    echo.
    echo   !GRAY!Tipp: Versuche in einer Admin-Eingabeaufforderung:!RESET!
    echo   !GRAY!  npm install -g windows-build-tools!RESET!
    echo.
    pause
    exit /b 1
)

echo.
echo   !WHITE![2/2] Baue Frontend...!RESET!
echo.
call npm run build
if !errorlevel! neq 0 (
    echo.
    echo   !RED!FEHLER beim Frontend-Build!!RESET!
    echo.
    pause
    exit /b 1
)

:: ══════════════════════════════════════════
::  Erfolg
:: ══════════════════════════════════════════
echo.
echo   !GREEN!══════════════════════════════════════════!RESET!
echo   !GREEN!!BOLD!  Installation erfolgreich abgeschlossen!!RESET!
echo   !GREEN!══════════════════════════════════════════!RESET!
echo.
echo   !WHITE!Starten:!RESET!   start.bat doppelklicken
echo   !WHITE!Oder:!RESET!      npm start
echo   !WHITE!Browser:!RESET!   http://localhost:8080
echo.
pause
