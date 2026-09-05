@echo off
title Archivebate Video Browser
cd /d "%~dp0"

echo ============================================================
echo      ARCHIVEBATE VIDEO BROWSER
echo ============================================================

python -c "import fastapi, uvicorn, requests, pydantic, PIL, imageio_ffmpeg" >nul 2>&1
if errorlevel 1 (
    echo [*] Wykryto brakujace biblioteki. Instalowanie pakietow...
    python -m pip install -r requirements.txt --quiet
)

echo [*] Startowanie aplikacji i otwieranie przegladarki...
echo Aby zatrzymac program, nacisnij Ctrl + C w tym oknie.
echo ============================================================
echo.

python run.py

pause
