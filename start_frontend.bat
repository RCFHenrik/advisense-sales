@echo off
title Advisense Frontend (port 5173)
set NODE_PATH=%LOCALAPPDATA%\node-portable
set PATH=%NODE_PATH%;%PATH%
cd /d "%~dp0frontend"
echo Starting frontend on http://localhost:5173 ...
npm.cmd run dev
pause
