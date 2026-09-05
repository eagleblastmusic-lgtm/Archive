import os
import sys
import time
import threading
import subprocess
import urllib.request
import uvicorn
import webview

def kill_port_8000():
    """Zamyka ewentualne wiszące stare procesy Pythona na porcie 8000 przed startem."""
    try:
        output = subprocess.check_output('netstat -aon | findstr :8000', shell=True, text=True, stderr=subprocess.DEVNULL)
        current_pid = os.getpid()
        for line in output.strip().splitlines():
            parts = line.split()
            if len(parts) >= 5 and "LISTENING" in parts:
                pid = int(parts[-1])
                if pid != current_pid and pid > 0:
                    subprocess.run(f'taskkill /f /pid {pid}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def start_server():
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False, log_level="warning")

def wait_for_server(url="http://127.0.0.1:8000", timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.15)
    return False

if __name__ == "__main__":
    print("=" * 60)
    print("   ARCHIVEBATE & CAMWHORES PRO (Aplikacja Pulpitowa)")
    print("   Uruchamianie natywnego okna bez przeglądarki...")
    print("=" * 60)

    # 1. Zamknij ewentualny stary proces na porcie 8000
    kill_port_8000()
    time.sleep(0.3)

    # 2. Uruchom backend w osobnym wątku
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # 3. Poczekaj na gotowość serwera
    wait_for_server()

    # 4. Natywne okno z przyspieszeniem GPU (WebView2)
    window = webview.create_window(
        title="Archivebate & Camwhores Desktop",
        url="http://127.0.0.1:8000",
        width=1440,
        height=920,
        min_size=(960, 640),
        background_color="#0a0e17"
    )
    webview.start(private_mode=False)
