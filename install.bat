@echo off
chcp 65001 >nul
echo ================================
echo   TJ Trading Journal Installer
echo ================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel%==0 (
    echo Node.js gefunden:
    node -v
) else (
    echo Node.js nicht gefunden!
    echo.
    echo Bitte Node.js 20 installieren von:
    echo https://nodejs.org/
    echo.
    echo Nach der Installation dieses Script erneut starten.
    pause
    exit /b 1
)

echo.
echo Installiere Abhaengigkeiten...
call npm install
if %errorlevel% neq 0 (
    echo FEHLER bei npm install!
    pause
    exit /b 1
)

echo.
echo Baue Frontend...
call npm run build
if %errorlevel% neq 0 (
    echo FEHLER beim Build!
    pause
    exit /b 1
)

echo.
echo ================================
echo   Installation abgeschlossen!
echo ================================
echo.
echo Starten mit:  npm start
echo Dann oeffne:  http://localhost:8080
echo.
pause
