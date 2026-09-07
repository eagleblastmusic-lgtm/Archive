@echo off
title Archivebate Video Browser
cd /d "%~dp0"

echo ============================================================
echo      ARCHIVEBATE VIDEO BROWSER
echo ============================================================
echo [1/3] Zamykanie starych procesow na porcie 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo [2/3] Sprawdzanie bibliotek Pythona...
python -m pip install -r requirements.txt --quiet

echo [3/3] Startowanie serwera i otwieranie przegladarki...
echo.
echo Adres programu: http://127.0.0.1:8000
echo Aby zatrzymac program, nacisnij Ctrl + C w tym oknie.
echo ============================================================
echo.

python run.py

pause
