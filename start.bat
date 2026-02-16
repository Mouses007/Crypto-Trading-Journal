@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: ANSI Escape-Zeichen generieren (Windows 10+)
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"

set "GREEN=!ESC![92m"
set "RED=!ESC![91m"
set "CYAN=!ESC![96m"
set "GRAY=!ESC![90m"
set "RESET=!ESC![0m"

:: Pruefen ob Frontend gebaut wurde
if not exist "dist\index.html" (
    echo.
    echo   !RED!Fehler:!RESET! Das Frontend wurde noch nicht gebaut.
    echo   Bitte zuerst !CYAN!install.bat!RESET! ausfuehren.
    echo.
    pause
    exit /b 1
)

:: Port aus Umgebungsvariable oder Standard
set "PORT=8080"
if defined TRADENOTE_PORT set "PORT=!TRADENOTE_PORT!"

echo.
echo   !GREEN!TJ Trading Journal startet...!RESET!
echo.
echo   !GRAY!Server:!RESET!   http://localhost:!PORT!
echo   !GRAY!Beenden:!RESET!  Strg+C druecken oder Fenster schliessen
echo.

:: Browser nach 2 Sekunden im Hintergrund oeffnen
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:!PORT!"

:: Server starten (blockiert hier)
node index.mjs
pause
