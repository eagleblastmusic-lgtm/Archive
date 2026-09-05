import json
import os
from pathlib import Path
from typing import Dict, Tuple

from runtime_paths import get_runtime_data_dir

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RUNTIME_DATA_DIR = get_runtime_data_dir()
LOCAL_CREDENTIALS_FILE = DATA_DIR / "credentials.local.json"
RUNTIME_CREDENTIALS_FILE = RUNTIME_DATA_DIR / "credentials.local.json"
ENV_FILE = BASE_DIR / ".env.local"



def _read_env_file(path: Path) -> Dict[str, str]:
    """Czyta prosty .env. utf-8-sig celowo usuwa BOM z Windows PowerShell 5.x."""
    values: Dict[str, str] = {}
    if not path.exists():
        return values
    try:
        import re
        content = path.read_text(encoding="utf-8-sig")
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Szuka par KEY=VALUE nawet jeśli są na jednej linii
            pairs = re.findall(r'([A-Za-z0-9_]+)\s*=\s*([^\s\r\n]+|"[^"]*"|\'[^\']*\')', line)
            if pairs:
                for k, v in pairs:
                    values[k.strip().lstrip("\ufeff")] = v.strip().strip('"').strip("'")
            elif "=" in line:
                k, v = line.split("=", 1)
                values[k.strip().lstrip("\ufeff")] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return values


def get_archivebate_credentials() -> Tuple[str, str]:
    """Czyta dane logowania bez utrwalania ich w procesie.

    Kolejność:
    1) prawdziwe zmienne środowiskowe,
    2) aktualna zawartość .env.local (można zmienić bez restartu),
    3) data/credentials.local.json lub %LOCALAPPDATA%/Archive/credentials.local.json.
    """
    env_email = os.getenv("ARCHIVEBATE_EMAIL", "").strip()
    env_password = os.getenv("ARCHIVEBATE_PASSWORD", "")
    if env_email and env_password:
        return env_email, env_password

    file_values = _read_env_file(ENV_FILE)
    email = str(file_values.get("ARCHIVEBATE_EMAIL", "")).strip()
    password = str(file_values.get("ARCHIVEBATE_PASSWORD", ""))
    if email and password:
        return email, password

    for cred_file in (RUNTIME_CREDENTIALS_FILE, LOCAL_CREDENTIALS_FILE):
        if cred_file.exists():
            try:
                data = json.loads(cred_file.read_text(encoding="utf-8-sig"))
                email = str(data.get("email", "")).strip()
                password = str(data.get("password", ""))
                if email and password:
                    return email, password
            except (OSError, ValueError, TypeError):
                pass

    # Brak danych logowania - kontrolowany stan NOT_CONFIGURED bez ukrytych fallbacków
    return str(email or "").strip(), str(password or "")


def is_credentials_configured() -> bool:
    email, password = get_archivebate_credentials()
    return bool(email and password)

