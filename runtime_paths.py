import os
import shutil
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("runtime_paths")

PROJECT_ROOT = Path(__file__).resolve().parent
PROJECT_DATA_DIR = PROJECT_ROOT / "data"


def get_runtime_data_dir() -> Path:
    """Zwraca ścieżkę do katalogu danych aplikacji użytkownika.
    
    Kolejność priorytetów:
    1. Zmienna środowiskowa ARCHIVE_DATA_DIR
    2. %LOCALAPPDATA%/Archive (na Windows)
    3. ~/.archivebate (na Linux/macOS lub jako fallback)
    """
    env_dir = os.getenv("ARCHIVE_DATA_DIR")
    if env_dir:
        target = Path(env_dir).expanduser().resolve()
    elif os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            target = Path(local_app_data) / "Archive"
        else:
            target = Path.home() / "AppData" / "Local" / "Archive"
    else:
        target = Path.home() / ".archivebate"

    target.mkdir(parents=True, exist_ok=True)
    return target


def get_user_store_path() -> Path:
    return get_runtime_data_dir() / "user_store.json"


def get_model_tags_path() -> Path:
    return get_runtime_data_dir() / "model_tags.json"


def get_cache_dir(name: str) -> Path:
    target = get_runtime_data_dir() / name
    target.mkdir(parents=True, exist_ok=True)
    return target


def migrate_legacy_data(runtime_dir: Optional[Path] = None) -> None:
    """Migruje istniejące dane użytkownika z katalogu projektu data/ do katalogu runtime,
    jeśli w katalogu runtime jeszcze ich nie ma. Zapobiega utracie danych przy przejściu
    na nowy system ścieżek.
    """
    if runtime_dir is None:
        runtime_dir = get_runtime_data_dir()

    runtime_dir.mkdir(parents=True, exist_ok=True)

    if not PROJECT_DATA_DIR.exists():
        return

    # 1. user_store.json
    target_user_store = runtime_dir / "user_store.json"
    legacy_user_store = PROJECT_DATA_DIR / "user_store.json"
    if legacy_user_store.exists() and not target_user_store.exists():
        try:
            shutil.copy2(legacy_user_store, target_user_store)
            logger.info(f"Pomyślnie zmigrowano user_store.json z {legacy_user_store} do {target_user_store}")
        except Exception as e:
            logger.error(f"Nie udało się zmigrować user_store.json: {e}")

    # 2. model_tags.json
    target_model_tags = runtime_dir / "model_tags.json"
    legacy_model_tags = PROJECT_DATA_DIR / "model_tags.json"
    if legacy_model_tags.exists() and not target_model_tags.exists():
        try:
            shutil.copy2(legacy_model_tags, target_model_tags)
            logger.info(f"Pomyślnie zmigrowano model_tags.json z {legacy_model_tags} do {target_model_tags}")
        except Exception as e:
            logger.error(f"Nie udało się zmigrować model_tags.json: {e}")

    # 3. credentials.local.json
    target_creds = runtime_dir / "credentials.local.json"
    legacy_creds = PROJECT_DATA_DIR / "credentials.local.json"
    if legacy_creds.exists() and not target_creds.exists():
        try:
            shutil.copy2(legacy_creds, target_creds)
            logger.info(f"Pomyślnie zmigrowano credentials.local.json do {target_creds}")
        except Exception as e:
            logger.error(f"Nie udało się zmigrować credentials.local.json: {e}")


def ensure_runtime_data_dirs() -> None:
    """Inicjalizuje katalog danych runtime oraz migruje dane z projektu."""
    r_dir = get_runtime_data_dir()
    migrate_legacy_data(r_dir)
    for cache_name in ("feed_cache", "details_cache", "thumbs_cache", "storyboard_cache"):
        (r_dir / cache_name).mkdir(parents=True, exist_ok=True)
