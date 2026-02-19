@echo off
chcp 65001 >nul 2>nul
setlocal EnableDelayedExpansion

:: Pruefen ob Frontend gebaut wurde
if not exist "dist\index.html" (
    echo.
    echo   Fehler: Das Frontend wurde noch nicht gebaut.
    echo   Bitte zuerst install.bat ausfuehren.
    echo.
    pause
    exit /b 1
)

:: Port aus Umgebungsvariable oder Standard
set "PORT=8080"
if defined TRADENOTE_PORT set "PORT=!TRADENOTE_PORT!"

echo.
echo   Crypto Trading Journal startet...
echo.
echo   Server:   http://localhost:!PORT!
echo   Beenden:  Strg+C druecken oder Fenster schliessen
echo.

:: Browser nach 2 Sekunden im Hintergrund oeffnen
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:!PORT!"

:: Server starten (blockiert hier)
node index.mjs
pause
