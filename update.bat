@echo off
chcp 65001 >nul 2>nul
setlocal EnableDelayedExpansion

echo.
echo   ==============================================
echo     Crypto Trading Journal - Update
echo   ==============================================
echo.

:: Node.js Check
where node >nul 2>nul
if errorlevel 1 (
    echo   [X] Node.js nicht gefunden! Bitte zuerst install.bat ausfuehren.
    goto :error
)
echo   [OK] Node.js gefunden

:: Datenbank-Backup
echo.
echo   [1/4] Datenbank-Backup...

if exist "tradenote.db" (
    copy /Y "tradenote.db" "tradenote.db.backup" >nul
    echo   [OK] Backup erstellt: tradenote.db.backup
) else (
    echo   [!] Keine Datenbank gefunden -- Neuinstallation? Kein Backup noetig.
)

:: Code aktualisieren
echo.
echo   [2/4] Code aktualisieren...

where git >nul 2>nul
if errorlevel 1 (
    echo   [!] Git nicht installiert -- automatisches Update nicht moeglich.
    echo.
    echo   Manuelles Update:
    echo     1. Lade das neueste Release herunter:
    echo        https://github.com/Mouses007/Crypto-Trading-Journal/releases
    echo     2. Entpacke die Dateien in diesen Ordner
    echo     3. WICHTIG: tradenote.db NICHT ueberschreiben!
    echo     4. Druecke eine Taste um mit npm install fortzufahren...
    echo.
    pause >nul
    goto :npm_install
)

:: Git fetch + reset (funktioniert auch bei frischer Installation ohne Commits)
echo     git fetch origin master...
git fetch origin master
if errorlevel 1 (
    echo   [X] Git fetch fehlgeschlagen!
    echo     Tipp: Keine Internetverbindung? Remote korrekt konfiguriert?
    goto :error
)
echo     git reset --hard origin/master...
git reset --hard origin/master
if errorlevel 1 (
    echo   [X] Git reset fehlgeschlagen!
    goto :error
)
echo   [OK] Code aktualisiert

:: npm install
:npm_install
echo.
echo   [3/4] Abhaengigkeiten aktualisieren...
echo     npm install...

call npm install
if errorlevel 1 (
    echo   [X] npm install fehlgeschlagen!
    goto :error
)
echo   [OK] Abhaengigkeiten aktualisiert

:: Build
echo.
echo   [4/4] Frontend bauen...
echo     npm run build...

call npm run build
if errorlevel 1 (
    echo   [X] Build fehlgeschlagen!
    goto :error
)
echo   [OK] Frontend gebaut

:: Erfolg
echo.
echo   ==============================================
echo     Update erfolgreich!
echo   ==============================================
echo.
echo   Datenbank: Alle Daten erhalten
if exist "tradenote.db.backup" (
    echo   Backup:    tradenote.db.backup
)
echo.
echo   Starte mit: start.bat
echo.
pause
exit /b 0

:: Fehler
:error
echo.
echo   Update abgebrochen. Deine Daten sind nicht betroffen.
if exist "tradenote.db.backup" (
    echo   Backup vorhanden: tradenote.db.backup
)
echo.
pause
exit /b 1
