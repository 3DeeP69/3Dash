@echo off
title T.U.R.D.
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Get the LTS from https://nodejs.org
  echo  install it, then double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules\@anthropic-ai\sdk (
  echo  First run: installing the AI assistant's Claude library ^(one-time, needs internet^)...
  echo  ^(if this fails you can still use everything else; the assistant runs on its on-device brain^)
  call npm install --omit=dev --no-audit --no-fund
)
echo  Starting T.U.R.D. ... a browser tab will open at http://localhost:8787
echo  (leave this window open while you use it; close it to stop)
start "" http://localhost:8787
node server.js
pause
