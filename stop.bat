@echo off
chcp 65001 >nul 2>nul
echo.
echo   Crypto Trading Journal wird beendet...
echo.
taskkill /f /im node.exe 2>nul
if %errorlevel% equ 0 (
    echo   [OK] Server beendet.
) else (
    echo   Server war nicht gestartet.
)
echo.
pause
