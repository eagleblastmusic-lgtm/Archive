import os
import sys
import time
import json
import socket
import threading
import urllib.request
import uvicorn
import webview


def is_port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def is_archivebate_running(url: str) -> bool:
    try:
        req = urllib.request.Request(f"{url}/api/status", headers={"User-Agent": "ArchiveDesktop"})
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return "logged_in" in data and "favorites_count" in data
    except Exception:
        pass
    return False


def resolve_port(default_port: int = 8000) -> tuple[int, bool]:
    """Zwraca (port, is_already_running).
    Bezpieczne dla systemu — nie wykonuje ślepego 'taskkill /f'.
    """
    if is_archivebate_running(f"http://127.0.0.1:{default_port}"):
        return default_port, True

    if is_port_free(default_port):
        return default_port, False

    for port in range(default_port + 1, default_port + 25):
        if is_port_free(port):
            print(f"[Archivebate Desktop] Port {default_port} jest zajęty przez inną aplikację. Wybrano wolny port: {port}")
            return port, False

    raise RuntimeError(f"Brak wolnego portu w zakresie {default_port}-{default_port+24}")


def start_server(port: int):
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False, log_level="warning")


def wait_for_server(url: str, timeout: float = 10.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.15)
    return False


if __name__ == "__main__":
    print("=" * 60)
    print("   ARCHIVEBATE & CAMWHORES PRO (Aplikacja Pulpitowa)")
    print("   Uruchamianie natywnego okna...")
    print("=" * 60)

    port, already_running = resolve_port(8000)
    url = f"http://127.0.0.1:{port}"

    if not already_running:
        server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
        server_thread.start()
        if not wait_for_server(url):
            print("[Archivebate Desktop] Błąd: Serwer backendu nie zgłosił gotowości na czas.")
            sys.exit(1)
    else:
        print(f"[Archivebate Desktop] Wykryto działającą instancję Archivebate pod adresem {url} — dołączam okno.")

    # Natywne okno z przyspieszeniem GPU (WebView2)
    window = webview.create_window(
        title="Archivebate & Camwhores Desktop",
        url=url,
        width=1440,
        height=920,
        min_size=(960, 640),
        background_color="#0a0e17"
    )
    webview.start(private_mode=False)
