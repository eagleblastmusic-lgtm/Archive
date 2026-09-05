import os
import sys
import time
import json
import socket
import webbrowser
import threading
import urllib.request
import uvicorn


def is_port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def is_archivebate_running(url: str) -> bool:
    try:
        req = urllib.request.Request(f"{url}/api/status", headers={"User-Agent": "ArchiveBrowser"})
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return "logged_in" in data and "favorites_count" in data
    except Exception:
        pass
    return False


def resolve_port(default_port: int = 8000) -> tuple[int, bool]:
    if is_archivebate_running(f"http://127.0.0.1:{default_port}"):
        return default_port, True
    if is_port_free(default_port):
        return default_port, False
    for port in range(default_port + 1, default_port + 25):
        if is_port_free(port):
            print(f"[Archivebate Browser] Port {default_port} jest zajęty przez inną aplikację. Wybrano wolny port: {port}")
            return port, False
    raise RuntimeError(f"Brak wolnego portu w zakresie {default_port}-{default_port+24}")


def open_browser(url: str):
    time.sleep(1.2)
    print(f"\n[Archivebate Browser] Otwieranie aplikacji w przeglądarce: {url}")
    webbrowser.open(url)


if __name__ == "__main__":
    print("=" * 60)
    print("   ARCHIVEBATE VIDEO BROWSER (GUI)")
    print("   Logowanie: automatyczna konfiguracja z .env.local")
    print("=" * 60)

    port, already_running = resolve_port(8000)
    url = f"http://127.0.0.1:{port}"

    if already_running:
        print(f"[Archivebate Browser] Wykryto działającą instancję Archivebate pod adresem {url} — otwieram w przeglądarce.")
        webbrowser.open(url)
        sys.exit(0)

    # Uruchom wątek otwierający przeglądarkę
    threading.Thread(target=open_browser, args=(url,), daemon=True).start()

    # Start serwera FastAPI
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False, log_level="info")
