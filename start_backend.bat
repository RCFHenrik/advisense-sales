@echo off
title Advisense Backend (port 8001)
cd /d "%~dp0backend"
echo Starting backend on http://localhost:8001 ...
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
pause
