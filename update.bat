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

:: ══════════════════════════════════════════
::  Banner
:: ══════════════════════════════════════════
echo.
echo !CYAN!!BOLD!══════════════════════════════════════════!RESET!
echo !CYAN!!BOLD!  TJ Trading Journal — Update             !RESET!
echo !CYAN!!BOLD!══════════════════════════════════════════!RESET!
echo.

:: ══════════════════════════════════════════
::  Node.js Check
:: ══════════════════════════════════════════
where node >nul 2>nul
if errorlevel 1 (
    echo !RED![X] Node.js nicht gefunden! Bitte zuerst install.bat ausfuehren.!RESET!
    goto :error
)
echo !GREEN![OK]!RESET! Node.js gefunden

:: ══════════════════════════════════════════
::  Datenbank-Backup
:: ══════════════════════════════════════════
echo.
echo !CYAN![1/4]!RESET! Datenbank-Backup...

if exist "tradenote.db" (
    copy /Y "tradenote.db" "tradenote.db.backup" >nul
    echo !GREEN![OK]!RESET! Backup erstellt: tradenote.db.backup
) else (
    echo !YELLOW![!]!RESET! Keine Datenbank gefunden — Neuinstallation? Kein Backup noetig.
)

:: ══════════════════════════════════════════
::  Code aktualisieren
:: ══════════════════════════════════════════
echo.
echo !CYAN![2/4]!RESET! Code aktualisieren...

where git >nul 2>nul
if errorlevel 1 (
    echo !YELLOW![!] Git nicht installiert — automatisches Update nicht moeglich.!RESET!
    echo.
    echo !WHITE!Manuelles Update:!RESET!
    echo   1. Lade das neueste Release herunter:
    echo      !CYAN!https://github.com/Mouses007/TJ-Trading-Journal/releases!RESET!
    echo   2. Entpacke die Dateien in diesen Ordner
    echo   3. !RED!WICHTIG: tradenote.db NICHT ueberschreiben!!RESET!
    echo   4. Druecke eine Taste um mit npm install fortzufahren...
    echo.
    pause >nul
    goto :npm_install
)

:: Git pull
echo !GRAY!  git pull origin master...!RESET!
git pull origin master
if errorlevel 1 (
    echo !RED![X] Git pull fehlgeschlagen!!RESET!
    echo !YELLOW!  Tipp: Lokale Aenderungen? Versuche: git stash ^&^& git pull ^&^& git stash pop!RESET!
    goto :error
)
echo !GREEN![OK]!RESET! Code aktualisiert

:: ══════════════════════════════════════════
::  npm install
:: ══════════════════════════════════════════
:npm_install
echo.
echo !CYAN![3/4]!RESET! Abhaengigkeiten aktualisieren...
echo !GRAY!  npm install...!RESET!

call npm install
if errorlevel 1 (
    echo !RED![X] npm install fehlgeschlagen!!RESET!
    goto :error
)
echo !GREEN![OK]!RESET! Abhaengigkeiten aktualisiert

:: ══════════════════════════════════════════
::  Build
:: ══════════════════════════════════════════
echo.
echo !CYAN![4/4]!RESET! Frontend bauen...
echo !GRAY!  npm run build...!RESET!

call npm run build
if errorlevel 1 (
    echo !RED![X] Build fehlgeschlagen!!RESET!
    goto :error
)
echo !GREEN![OK]!RESET! Frontend gebaut

:: ══════════════════════════════════════════
::  Erfolg
:: ══════════════════════════════════════════
echo.
echo !GREEN!!BOLD!══════════════════════════════════════════!RESET!
echo !GREEN!!BOLD!  Update erfolgreich!                     !RESET!
echo !GREEN!!BOLD!══════════════════════════════════════════!RESET!
echo.
echo !WHITE!  Datenbank:!RESET! Alle Daten erhalten
if exist "tradenote.db.backup" (
    echo !WHITE!  Backup:!RESET!    tradenote.db.backup
)
echo.
echo !CYAN!  Starte mit: start.bat!RESET!
echo.
pause
exit /b 0

:: ══════════════════════════════════════════
::  Fehler
:: ══════════════════════════════════════════
:error
echo.
echo !RED!Update abgebrochen. Deine Daten sind nicht betroffen.!RESET!
if exist "tradenote.db.backup" (
    echo !WHITE!Backup vorhanden: tradenote.db.backup!RESET!
)
echo.
pause
exit /b 1
