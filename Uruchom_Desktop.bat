@echo off
title Archivebate Desktop Pro
cd /d "%~dp0"

echo ============================================================
echo      ARCHIVEBATE ^& CAMWHORES DESKTOP PRO
echo ============================================================

python -c "import webview, fastapi, uvicorn" >nul 2>&1
if errorlevel 1 (
    echo [*] Sprawdzanie i instalowanie wymaganych bibliotek pulpitu...
    python -m pip install -r requirements.txt --quiet
)

echo [*] Uruchamianie aplikacji w oknie natywnym...
python desktop_app.py
pause
