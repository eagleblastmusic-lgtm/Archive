@echo off
title Archivebate Desktop Pro
cd /d "%~dp0"

echo ============================================================
echo      ARCHIVEBATE ^& CAMWHORES DESKTOP PRO
echo ============================================================
echo [1/2] Zamykanie starych procesow na porcie 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo [2/2] Uruchamianie aplikacji w natywnym oknie...
python desktop_app.py
pause
