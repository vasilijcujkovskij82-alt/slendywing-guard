@echo off
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
title SlendyWing Guard

if not exist ".env" if exist "template.env" copy /y "template.env" ".env" >nul

:asktoken
call "C:\Program Files\nodejs\node.exe" check.js
if not errorlevel 1 goto run
start /wait "" notepad "%CD%\.env"
goto asktoken

:run
if not exist "node_modules\discord.js" (
  echo.
  echo   First launch: installing libraries, please wait...
  echo.
  call "C:\Program Files\nodejs\npm.cmd" install --no-audit --no-fund
)

echo.
echo   Starting bot... Do not close this window while it runs.
echo.
call "C:\Program Files\nodejs\node.exe" index.js

echo.
echo   Bot stopped. Press any key to close this window.
pause >nul
