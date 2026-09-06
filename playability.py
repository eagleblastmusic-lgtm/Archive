import enum
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from runtime_paths import get_runtime_data_dir
from cache_store import atomic_write_json

logger = logging.getLogger("playability")


class PlayabilityStatus(str, enum.Enum):
    UNKNOWN = "unknown"
    PLAYABLE = "playable"
    DELETED = "deleted"
    UNAVAILABLE = "unavailable"
    TRANSIENT_ERROR = "transient_error"


TTL_DELETED = 30 * 86400.0        # 30 dni
TTL_UNAVAILABLE = 30 * 86400.0    # 30 dni
TTL_PLAYABLE = 12 * 3600.0        # 12 godzin
TTL_TRANSIENT = 180.0             # 3 minuty
TTL_UNKNOWN = 60.0                # 1 minuta


def get_playability_cache_path() -> Path:
    return get_runtime_data_dir() / "playability_cache.json"


class PlayabilityStore:
    def __init__(self, cache_file: Optional[Path] = None):
        self.cache_file = cache_file or get_playability_cache_path()
        self._lock = threading.RLock()
        self._data: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self):
        with self._lock:
            if self.cache_file.exists():
                try:
                    with open(self.cache_file, "r", encoding="utf-8") as f:
                        content = json.load(f)
                    if isinstance(content, dict):
                        self._data = content
                except Exception as e:
                    logger.warning(f"Błąd odczytu playability cache: {e}")
                    self._data = {}

    def _save(self):
        with self._lock:
            try:
                atomic_write_json(str(self.cache_file), self._data)
            except Exception as e:
                logger.error(f"Błąd zapisu playability cache: {e}")

    def get_status(self, video_id: str) -> Tuple[PlayabilityStatus, Optional[Dict[str, Any]]]:
        clean_id = str(video_id).split("/")[-1].split("?")[0].strip()
        if not clean_id:
            return PlayabilityStatus.UNKNOWN, None

        with self._lock:
            entry = self._data.get(clean_id)
            if not entry or not isinstance(entry, dict):
                return PlayabilityStatus.UNKNOWN, None

            status_str = entry.get("status")
            checked_at = float(entry.get("checked_at", 0))
            now = time.time()
            age = now - checked_at

            try:
                status = PlayabilityStatus(status_str)
            except Exception:
                return PlayabilityStatus.UNKNOWN, None

            if status in (PlayabilityStatus.DELETED, PlayabilityStatus.UNAVAILABLE):
                if age > TTL_DELETED:
                    return PlayabilityStatus.UNKNOWN, entry
                return status, entry
            elif status == PlayabilityStatus.PLAYABLE:
                if age > TTL_PLAYABLE:
                    return PlayabilityStatus.UNKNOWN, entry
                return status, entry
            elif status == PlayabilityStatus.TRANSIENT_ERROR:
                if age > TTL_TRANSIENT:
                    return PlayabilityStatus.UNKNOWN, entry
                return status, entry
            else:
                if age > TTL_UNKNOWN:
                    return PlayabilityStatus.UNKNOWN, entry
                return status, entry

    def is_known_deleted(self, video_id: str) -> bool:
        status, _ = self.get_status(video_id)
        return status in (PlayabilityStatus.DELETED, PlayabilityStatus.UNAVAILABLE)

    def set_status(self, video_id: str, status: PlayabilityStatus, reason: str = "", details: Optional[Dict[str, Any]] = None):
        clean_id = str(video_id).split("/")[-1].split("?")[0].strip()
        if not clean_id:
            return

        with self._lock:
            entry = {
                "status": status.value,
                "reason": reason,
                "checked_at": time.time(),
                "details": details or {}
            }
            self._data[clean_id] = entry
            self._save()

    def get_all_deleted_ids(self) -> set:
        with self._lock:
            now = time.time()
            deleted_ids = set()
            for vid, entry in self._data.items():
                if not isinstance(entry, dict):
                    continue
                st = entry.get("status")
                chk = float(entry.get("checked_at", 0))
                if st in (PlayabilityStatus.DELETED.value, PlayabilityStatus.UNAVAILABLE.value):
                    if (now - chk) <= TTL_DELETED:
                        deleted_ids.add(vid)
            return deleted_ids


playability_store = PlayabilityStore()

_DELETED_TEXT_PATTERNS = [
    re.compile(r'\bthis\s+video\s+has\s+been\s+deleted\b', re.IGNORECASE),
    re.compile(r'\bvideo\s+deleted\b', re.IGNORECASE),
    re.compile(r'\bvideo\s+has\s+been\s+removed\b', re.IGNORECASE),
]


def check_html_for_deleted(html: str) -> Optional[str]:
    if not html:
        return None
    # Usuwamy sekcje zgłaszania/report modal i formularze, gdzie "Video deleted" występuje jako opcja w ankiecie/radiobuttonie
    filtered_html = re.sub(r'<div[^>]*class="[^"]*modal[^"]*"[\s\S]*?</div>\s*</div>\s*</div>', ' ', html, flags=re.IGNORECASE)
    filtered_html = re.sub(r'<form[\s\S]*?</form>', ' ', filtered_html, flags=re.IGNORECASE)
    filtered_html = re.sub(r'<label[^>]*for="[^"]*deleted[^"]*"[\s\S]*?</label>', ' ', filtered_html, flags=re.IGNORECASE)
    clean_text = re.sub(r'<[^>]+>', ' ', filtered_html)
    clean_text = ' '.join(clean_text.split())
    for pat in _DELETED_TEXT_PATTERNS:
        m = pat.search(clean_text)
        if m:
            return m.group(0)
    return None


def validate_archivebate_playability(video_id: str, session=None) -> PlayabilityStatus:
    clean_id = str(video_id).split("/")[-1].split("?")[0].strip()
    if not clean_id:
        return PlayabilityStatus.UNKNOWN

    status, _ = playability_store.get_status(clean_id)
    if status != PlayabilityStatus.UNKNOWN:
        return status

    if clean_id.startswith("cw_") or "camwhores" in str(clean_id).lower():
        playability_store.set_status(clean_id, PlayabilityStatus.PLAYABLE, reason="camwhores_default")
        return PlayabilityStatus.PLAYABLE

    watch_url = f"https://archivebate.com/watch/{clean_id}"
    try:
        if session is not None and hasattr(session, "session"):
            client_session = session.session
        elif session is not None and hasattr(session, "get"):
            client_session = session
        else:
            from main import session as app_session
            client_session = app_session.session

        r = client_session.get(watch_url, timeout=8, allow_redirects=True)
        if r.status_code in (404, 410):
            playability_store.set_status(clean_id, PlayabilityStatus.DELETED, reason=f"http_{r.status_code}")
            return PlayabilityStatus.DELETED
        elif r.status_code == 403:
            playability_store.set_status(clean_id, PlayabilityStatus.TRANSIENT_ERROR, reason="http_403")
            return PlayabilityStatus.TRANSIENT_ERROR
        elif r.status_code >= 500:
            playability_store.set_status(clean_id, PlayabilityStatus.TRANSIENT_ERROR, reason=f"http_{r.status_code}")
            return PlayabilityStatus.TRANSIENT_ERROR
        elif r.status_code != 200:
            playability_store.set_status(clean_id, PlayabilityStatus.TRANSIENT_ERROR, reason=f"http_{r.status_code}")
            return PlayabilityStatus.TRANSIENT_ERROR

        html = r.text
        marker = check_html_for_deleted(html)
        if marker:
            playability_store.set_status(clean_id, PlayabilityStatus.DELETED, reason=f"marker_{marker}")
            return PlayabilityStatus.DELETED

        if 'name="fid"' in html or '<iframe' in html:
            playability_store.set_status(clean_id, PlayabilityStatus.PLAYABLE, reason="found_stream_elements")
            return PlayabilityStatus.PLAYABLE

        playability_store.set_status(clean_id, PlayabilityStatus.UNKNOWN, reason="no_marker_no_iframe")
        return PlayabilityStatus.UNKNOWN

    except Exception as e:
        logger.warning(f"Błąd podczas sprawdzania playability {clean_id}: {e}")
        playability_store.set_status(clean_id, PlayabilityStatus.TRANSIENT_ERROR, reason=f"exception_{type(e).__name__}")
        return PlayabilityStatus.TRANSIENT_ERROR