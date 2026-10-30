@echo off
setlocal
title Nova Launcher
cd /d "%~dp0"

echo.
echo   ==========================================
echo      Nova Launcher    Minecraft Launcher
echo   ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

echo   Node.js version:
node -v
echo.
echo   Starting local server on port 7420 ...
echo   Browser will open automatically.
echo   Close this window to quit the launcher.
echo.

node "%~dp0server\index.mjs"
if errorlevel 1 goto FAILED
exit /b 0

:FAILED
echo.
echo   [!] Server exited abnormally.
echo   If the port is busy, pick another one before starting:
echo       set NOVA_PORT=7500
echo.
pause
exit /b 1

:NONODE
echo   [!] Node.js not found.
echo.
echo   Please install Node.js 18 or newer first:
echo       https://nodejs.org
echo.
pause
exit /b 1
