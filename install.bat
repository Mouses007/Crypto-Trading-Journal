@echo off
chcp 65001 >nul 2>nul
setlocal EnableDelayedExpansion

REM Status-Variablen
set "NODE_OK=0"
set "PYTHON_OK=0"
set "VSBUILD_OK=0"
set "OLLAMA_OK=0"
set "GIT_OK=0"
set "NODE_VER="
set "PYTHON_VER="
set "GIT_VER="
set "MANDATORY_MISSING=0"

echo.
echo   ==============================================
echo      Crypto Trading Journal - Installer
echo   ==============================================
echo.
echo   Pruefe System-Voraussetzungen...
echo.

REM CHECK 1: Node.js 20+
where node >nul 2>nul
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
    for /f "tokens=1 delims=." %%a in ("!NODE_VER!") do set "NODE_RAW=%%a"
    set "NODE_MAJOR=!NODE_RAW:v=!"
    if !NODE_MAJOR! GEQ 20 (
        set "NODE_OK=1"
        echo   [OK]  Node.js            !NODE_VER!
    ) else (
        echo   [!!]  Node.js            !NODE_VER! ^(Version 20+ erforderlich^)
        set "MANDATORY_MISSING=1"
    )
) else (
    echo   [!!]  Node.js            Nicht gefunden
    set "MANDATORY_MISSING=1"
)

REM CHECK 2: Python 3
set "PY_VER_FULL="
where python >nul 2>nul
if !errorlevel! equ 0 (
    for /f "tokens=2 delims= " %%a in ('python --version 2^>^&1') do set "PY_VER_FULL=%%a"
    if defined PY_VER_FULL (
        for /f "tokens=1 delims=." %%b in ("!PY_VER_FULL!") do set "PY_MAJOR=%%b"
        if "!PY_MAJOR!"=="3" (
            set "PYTHON_OK=1"
            set "PYTHON_VER=!PY_VER_FULL!"
        )
    )
)

if "!PYTHON_OK!"=="0" (
    where python3 >nul 2>nul
    if !errorlevel! equ 0 (
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

if "!PYTHON_OK!"=="1" (
    echo   [OK]  Python             !PYTHON_VER!
) else (
    echo   [!!]  Python 3           Nicht gefunden
    set "MANDATORY_MISSING=1"
)

REM CHECK 3: Visual Studio Build Tools
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "!VSWHERE!" (
    set "VSBUILD_OK=1"
    echo   [OK]  VS Build Tools     Gefunden
) else (
    where cl >nul 2>nul
    if !errorlevel! equ 0 (
        set "VSBUILD_OK=1"
        echo   [OK]  C++ Compiler       Gefunden ^(cl.exe^)
    ) else (
        echo   [!!]  VS Build Tools     Nicht gefunden
        set "MANDATORY_MISSING=1"
    )
)

REM CHECK 4: npm
where npm >nul 2>nul
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('npm -v 2^>nul') do set "NPM_VER=%%v"
    echo   [OK]  npm                v!NPM_VER!
) else (
    echo   [!!]  npm                Nicht gefunden
    set "MANDATORY_MISSING=1"
)

REM CHECK 5: Port 8080
netstat -ano 2>nul | findstr ":8080 " | findstr "LISTENING" >nul 2>nul
if !errorlevel! equ 0 (
    echo   [!]   Port 8080          Belegt ^(anderer Dienst laeuft auf 8080^)
) else (
    echo   [OK]  Port 8080          Frei
)

REM CHECK 6: Ollama (optional)
where ollama >nul 2>nul
if !errorlevel! equ 0 (
    set "OLLAMA_OK=1"
    echo   [OK]  Ollama             Gefunden ^(optional^)
) else (
    echo   [--]  Ollama             Nicht installiert ^(optional, fuer lokale KI^)
)

REM CHECK 7: Git (optional)
where git >nul 2>nul
if !errorlevel! equ 0 (
    set "GIT_OK=1"
    for /f "tokens=3" %%v in ('git --version 2^>nul') do set "GIT_VER=%%v"
    echo   [OK]  Git                !GIT_VER! ^(optional^)
) else (
    echo   [--]  Git                Nicht installiert ^(optional^)
)

echo.
echo   ==============================================
echo.

REM Pflicht-Komponenten fehlen?
if "!MANDATORY_MISSING!"=="1" (
    echo   Fehlende Pflicht-Komponenten gefunden:
    echo.
    if "!NODE_OK!"=="0"    echo     * Node.js 20+
    if "!PYTHON_OK!"=="0"  echo     * Python 3
    if "!VSBUILD_OK!"=="0" echo     * Visual Studio Build Tools
    echo.

    REM Pruefen ob winget verfuegbar ist
    set "WINGET_OK=0"
    where winget >nul 2>nul
    if !errorlevel! equ 0 set "WINGET_OK=1"

    if "!WINGET_OK!"=="1" (
        set /p "AUTO_INSTALL=  Fehlende Pakete jetzt automatisch installieren (via winget)? [J/n]: "
        if /i "!AUTO_INSTALL!"=="" set "AUTO_INSTALL=j"
        if /i "!AUTO_INSTALL!"=="j" goto :AUTO_INSTALL_START
        if /i "!AUTO_INSTALL!"=="y" goto :AUTO_INSTALL_START
        goto :MANUAL_INSTALL
    ) else (
        echo   winget nicht gefunden - automatische Installation nicht moeglich.
        echo.
        goto :MANUAL_INSTALL
    )
)
goto :INSTALL_OK

:AUTO_INSTALL_START
echo.
echo   Installiere fehlende Pakete...
echo.

if "!NODE_OK!"=="0" (
    echo   → Installiere Node.js 20 LTS...
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -h
    if !errorlevel! neq 0 (
        echo   [!] Node.js Installation fehlgeschlagen
    ) else (
        echo   [OK] Node.js installiert
    )
    echo.
)

if "!PYTHON_OK!"=="0" (
    echo   → Installiere Python 3...
    winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements -h
    if !errorlevel! neq 0 (
        echo   [!] Python Installation fehlgeschlagen
    ) else (
        echo   [OK] Python installiert
    )
    echo.
)

if "!VSBUILD_OK!"=="0" (
    echo   → Installiere Visual Studio Build Tools...
    echo     ^(Dies kann einige Minuten dauern^)
    winget install Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements -h --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    if !errorlevel! neq 0 (
        echo   [!] VS Build Tools Installation fehlgeschlagen
        echo   [!] Alternative: npm install -g windows-build-tools ^(als Admin^)
    ) else (
        echo   [OK] VS Build Tools installiert
    )
    echo.
)

REM PATH aktualisieren (neue Installationen sichtbar machen)
echo   Aktualisiere PATH...
echo.
goto :REFRESH_PATH_AND_CHECK

:REFRESH_PATH_AND_CHECK
REM Neuen PATH aus Registry holen
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%B"
set "PATH=!SYS_PATH!;!USR_PATH!"

REM Ergebnis pruefen
echo   Pruefe Installation...
echo.

set "STILL_MISSING=0"

where node >nul 2>nul
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NEW_NODE_VER=%%v"
    echo   [OK]  Node.js            !NEW_NODE_VER!
) else (
    echo   [!!]  Node.js            Nicht gefunden
    set "STILL_MISSING=1"
)

set "PY_CHECK=0"
where python >nul 2>nul
if !errorlevel! equ 0 set "PY_CHECK=1"
where python3 >nul 2>nul
if !errorlevel! equ 0 set "PY_CHECK=1"
if "!PY_CHECK!"=="1" (
    echo   [OK]  Python             Gefunden
) else (
    echo   [!!]  Python             Nicht gefunden
    set "STILL_MISSING=1"
)

set "VS_CHECK=0"
if exist "!VSWHERE!" set "VS_CHECK=1"
where cl >nul 2>nul
if !errorlevel! equ 0 set "VS_CHECK=1"
if "!VS_CHECK!"=="1" (
    echo   [OK]  Build Tools        Gefunden
) else (
    echo   [!!]  Build Tools        Nicht gefunden
    set "STILL_MISSING=1"
)

echo.

if "!STILL_MISSING!"=="1" (
    echo   Einige Pakete erfordern einen Neustart der Eingabeaufforderung.
    echo.
    echo   Bitte dieses Fenster schliessen und install.bat erneut starten.
    echo.
    pause
    exit /b 1
)

echo   Alle Pakete erfolgreich installiert!
echo.
goto :INSTALL_OK

:MANUAL_INSTALL
echo   Bitte installiere die fehlenden Pakete:
echo.

if "!NODE_OK!"=="0" (
    echo   Node.js 20+ ^(LTS^)
    echo     https://nodejs.org/
    echo     Waehle die LTS-Version und aktiviere "Add to PATH"
    echo.
)

if "!PYTHON_OK!"=="0" (
    echo   Python 3
    echo     https://www.python.org/downloads/
    echo     WICHTIG: Bei der Installation "Add Python to PATH" ankreuzen!
    echo.
)

if "!VSBUILD_OK!"=="0" (
    echo   Visual Studio Build Tools
    echo     https://aka.ms/vs/17/release/vs_BuildTools.exe
    echo     Bei der Installation "Desktopentwicklung mit C++" auswaehlen
    echo.
)

set /p "OPEN_LINKS=  Download-Links im Browser oeffnen? [J/n]: "
if /i "!OPEN_LINKS!"=="" set "OPEN_LINKS=j"
if /i "!OPEN_LINKS!"=="j" (
    if "!NODE_OK!"=="0" start https://nodejs.org/
    if "!PYTHON_OK!"=="0" start https://www.python.org/downloads/
    if "!VSBUILD_OK!"=="0" start https://aka.ms/vs/17/release/vs_BuildTools.exe
    echo.
    echo   Links wurden im Browser geoeffnet.
)

echo.
echo   ==============================================
echo   Installiere jetzt die fehlenden Programme.
echo   Wenn du fertig bist, druecke eine beliebige Taste
echo   und ich pruefe nochmal ob alles da ist.
echo   ==============================================
echo.
pause

REM PATH aktualisieren nach manueller Installation
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%B"
set "PATH=!SYS_PATH!;!USR_PATH!"

echo.
echo   Pruefe erneut...
echo.

REM Node.js nochmal pruefen
if "!NODE_OK!"=="0" (
    where node >nul 2>nul
    if !errorlevel! equ 0 (
        for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
        for /f "tokens=1 delims=." %%a in ("!NODE_VER!") do set "NODE_RAW=%%a"
        set "NODE_MAJOR=!NODE_RAW:v=!"
        if !NODE_MAJOR! GEQ 20 (
            set "NODE_OK=1"
            echo   [OK]  Node.js            !NODE_VER!
        ) else (
            echo   [!!]  Node.js            !NODE_VER! ^(Version 20+ erforderlich^)
        )
    ) else (
        echo   [!!]  Node.js            Immer noch nicht gefunden
    )
)

REM Python nochmal pruefen
if "!PYTHON_OK!"=="0" (
    set "PY_VER_FULL="
    where python >nul 2>nul
    if !errorlevel! equ 0 (
        for /f "tokens=2 delims= " %%a in ('python --version 2^>^&1') do set "PY_VER_FULL=%%a"
        if defined PY_VER_FULL (
            for /f "tokens=1 delims=." %%b in ("!PY_VER_FULL!") do set "PY_MAJOR=%%b"
            if "!PY_MAJOR!"=="3" (
                set "PYTHON_OK=1"
                set "PYTHON_VER=!PY_VER_FULL!"
                echo   [OK]  Python             !PY_VER_FULL!
            )
        )
    )
    if "!PYTHON_OK!"=="0" echo   [!!]  Python             Immer noch nicht gefunden
)

REM VS Build Tools nochmal pruefen
if "!VSBUILD_OK!"=="0" (
    set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
    if exist "!VSWHERE!" (
        set "VSBUILD_OK=1"
        echo   [OK]  VS Build Tools     Gefunden
    ) else (
        where cl >nul 2>nul
        if !errorlevel! equ 0 (
            set "VSBUILD_OK=1"
            echo   [OK]  VS Build Tools     Gefunden
        ) else (
            echo   [!!]  VS Build Tools     Immer noch nicht gefunden
        )
    )
)

REM npm nochmal pruefen
where npm >nul 2>nul
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('npm -v 2^>nul') do set "NPM_VER=%%v"
    echo   [OK]  npm                v!NPM_VER!
)

echo.

REM Immer noch was fehlend?
set "STILL_MISSING=0"
if "!NODE_OK!"=="0" set "STILL_MISSING=1"
if "!PYTHON_OK!"=="0" set "STILL_MISSING=1"
if "!VSBUILD_OK!"=="0" set "STILL_MISSING=1"

if "!STILL_MISSING!"=="1" (
    echo   Es fehlen immer noch Komponenten.
    echo.
    set /p "RETRY=  Nochmal pruefen? [J/n]: "
    if /i "!RETRY!"=="" set "RETRY=j"
    if /i "!RETRY!"=="j" goto :MANUAL_INSTALL
    if /i "!RETRY!"=="y" goto :MANUAL_INSTALL
    echo.
    echo   Bitte installiere die fehlenden Pakete und starte install.bat erneut.
    echo.
    pause
    exit /b 1
)

echo   Alle Komponenten gefunden!
echo.
goto :INSTALL_OK

:INSTALL_OK

REM Hinweise fuer optionale Komponenten
if "!OLLAMA_OK!"=="0" (
    echo   Hinweis: Ollama ist nicht installiert.
    echo   Fuer lokale KI-Berichte: https://ollama.ai/
    echo.
)

REM Installation starten
echo   Alle Voraussetzungen erfuellt - starte Installation...
echo.

echo   [1/2] Installiere Abhaengigkeiten...
echo.
call npm install
if !errorlevel! neq 0 (
    echo.
    echo   FEHLER bei npm install!
    echo.
    echo   Moegliche Ursachen:
    echo   - Python oder Build Tools nicht korrekt installiert
    echo   - Keine Internetverbindung
    echo   - Firewall blockiert npm
    echo.
    echo   Tipp: Versuche in einer Admin-Eingabeaufforderung:
    echo     npm install -g windows-build-tools
    echo.
    pause
    exit /b 1
)

echo.
echo   [2/2] Baue Frontend...
echo.
call npm run build
if !errorlevel! neq 0 (
    echo.
    echo   FEHLER beim Frontend-Build!
    echo.
    pause
    exit /b 1
)

REM Desktop-Verknuepfung erstellen
echo.
echo   Erstelle Desktop-Verknuepfung...

set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP%\Crypto Trading Journal.lnk"
set "INSTALL_DIR=%CD%"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%INSTALL_DIR%\start.bat'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.IconLocation = '%INSTALL_DIR%\src\assets\icon.ico,0'; $s.Description = 'Crypto Trading Journal starten'; $s.Save()" 2>nul

if exist "%SHORTCUT%" (
    echo   [OK] Desktop-Verknuepfung erstellt
) else (
    echo   [!] Desktop-Verknuepfung konnte nicht erstellt werden
)

REM Erfolg
echo.
echo   ==============================================
echo     Installation erfolgreich abgeschlossen!
echo   ==============================================
echo.
echo   Starten:   Doppelklick auf "Crypto Trading Journal" am Desktop
echo   Oder:      start.bat doppelklicken
echo   Browser:   http://localhost:8080
echo.
pause
