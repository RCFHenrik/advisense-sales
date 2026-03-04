@echo off
set PROJECT=C:\Users\Henrik.Nilsson\OneDrive - Advisense AB\Desktop\Claude01_SalesSupport
set NODE=C:\Users\Henrik.Nilsson\AppData\Local\node-portable

:: Kill any process already using port 8001 (e.g. a leftover backend instance)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8001" ^| find "LISTENING"') do taskkill /f /pid %%a 2>nul

:: Start backend in a new window
start "Backend (port 8001)" cmd /k "cd /d "%PROJECT%\backend" && python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload"

:: Start frontend in a new window (add node to PATH so npm can call node internally)
start "Frontend (port 5173)" cmd /k "set PATH=%NODE%;%PATH% && cd /d "%PROJECT%\frontend" && "%NODE%\npm.cmd" run dev"
