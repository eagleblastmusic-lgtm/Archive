import os
import sys
import time
import webbrowser
import threading
import uvicorn

def open_browser():
    time.sleep(1.2)
    url = "http://127.0.0.1:8000"
    print(f"\n[Archivebate Browser] Otwieranie aplikacji w przeglądarce: {url}")
    webbrowser.open(url)

if __name__ == "__main__":
    print("=" * 60)
    print("   ARCHIVEBATE VIDEO BROWSER (GUI)")
    print("   Logowanie: konfiguracja z .env.local / zmiennych środowiskowych")
    print("=" * 60)

    # Uruchom wątek otwierający przeglądarkę
    threading.Thread(target=open_browser, daemon=True).start()

    # Start serwera FastAPI (reload=False, aby zapis do cache w data/ nie restartował serwera)
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False, log_level="info")
