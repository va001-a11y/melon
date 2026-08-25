@echo off
title Melon

rem Thin wrapper: everything real lives in scripts\launch.mjs, which is shared
rem with macOS and Linux so the platforms cannot drift apart.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

node "%~dp0scripts\launch.mjs"
echo.
pause
exit /b 0

:nonode
echo.
echo   ============================================================
echo    Melon needs Node.js, and it is not installed on this PC.
echo   ============================================================
echo.
echo    Melon is a local web app: Node.js is the engine that runs
echo    it on your machine. It is free, takes about a minute, and
echo    nothing else needs installing.
echo.
echo    1. Download the "LTS" version from  https://nodejs.org
echo    2. Run the installer and accept the defaults.
echo    3. Close this window, then run Melon.bat again.
echo.
choice /c YN /n /m "   Open the download page now? [Y/N] "
if errorlevel 2 goto bye
start "" "https://nodejs.org/en/download"
:bye
echo.
pause
exit /b 1
