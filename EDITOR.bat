@echo off
title SlendyWing - Editor
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;%PATH%"

if not exist "node_modules\discord.js" (
  call "C:\Program Files\nodejs\npm.cmd" install --no-audit --no-fund
)

start "" cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:3060"
"C:\Program Files\nodejs\node.exe" editor\server.js

echo.
echo   Editor stopped. Press any key to close.
pause >nul
