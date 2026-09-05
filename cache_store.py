import ipaddress
import json
import os
import socket
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional, Tuple
from urllib.parse import urlparse

class BoundedTTLCache:
    """Wątkowo-bezpieczna pamięć podręczna LRU z czasem życia (TTL) i twardym limitem wpisów."""
    def __init__(self, max_items: int = 500, default_ttl: float = 300.0):
        self.max_items = max(1, max_items)
        self.default_ttl = default_ttl
        self._lock = threading.RLock()
        self._store: OrderedDict[str, Tuple[Any, Optional[float], float]] = OrderedDict()

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return default
            val, expire_at, _ = entry
            now = time.time()
            if expire_at is not None and now > expire_at:
                del self._store[key]
                return default
            self._store.move_to_end(key)
            self._store[key] = (val, expire_at, now)
            return val

    def set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        with self._lock:
            now = time.time()
            ttl_val = self.default_ttl if ttl is None else ttl
            expire_at = (now + ttl_val) if ttl_val is not None and ttl_val > 0 else None
            if key in self._store:
                del self._store[key]
            elif len(self._store) >= self.max_items:
                # Najpierw usuń wygasłe wpisy
                expired = [k for k, (_, exp, _) in self._store.items() if exp is not None and now > exp]
                for k in expired:
                    del self._store[k]
                # Jeśli nadal przekracza limit, usuń najstarszy (LRU)
                while len(self._store) >= self.max_items:
                    self._store.popitem(last=False)
            self._store[key] = (value, expire_at, now)

    def pop(self, key: str, default: Any = None) -> Any:
        with self._lock:
            entry = self._store.pop(key, None)
            if entry is None:
                return default
            val, expire_at, _ = entry
            if expire_at is not None and time.time() > expire_at:
                return default
            return val

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __contains__(self, key: str) -> bool:
        return self.get(key) is not None

    def __getitem__(self, key: str) -> Any:
        val = self.get(key)
        if val is None:
            raise KeyError(key)
        return val

    def __setitem__(self, key: str, value: Any) -> None:
        self.set(key, value)

    def __delitem__(self, key: str) -> None:
        self.pop(key)

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FEED_CACHE_DIR = DATA_DIR / "feed_cache"
DETAILS_CACHE_DIR = DATA_DIR / "details_cache"
THUMBS_CACHE_DIR = DATA_DIR / "thumbs_cache"
STORYBOARD_CACHE_DIR = DATA_DIR / "storyboard_cache"
for _d in (DATA_DIR, FEED_CACHE_DIR, DETAILS_CACHE_DIR, THUMBS_CACHE_DIR, STORYBOARD_CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

_json_lock = threading.RLock()
_host_cache_lock = threading.Lock()
_host_safety_cache = {}  # host -> (is_safe, checked_at)
_HOST_CACHE_TTL = 300


def atomic_write_json(path: os.PathLike, data: Any) -> None:
    """Crash-safe JSON write: temp -> fsync -> atomic replace."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with _json_lock:
        fd, tmp_name = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=str(target.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_name, target)
        finally:
            try:
                if os.path.exists(tmp_name):
                    os.remove(tmp_name)
            except OSError:
                pass


def read_json_cache(path: os.PathLike) -> Tuple[Optional[Any], Optional[float]]:
    target = Path(path)
    try:
        stat = target.stat()
        with target.open("r", encoding="utf-8") as f:
            return json.load(f), stat.st_mtime
    except (OSError, ValueError, TypeError):
        return None, None


def cache_age_seconds(mtime: Optional[float]) -> float:
    return float("inf") if not mtime else max(0.0, time.time() - mtime)


def safe_cache_key(value: str) -> str:
    import hashlib
    return hashlib.sha256(str(value).encode("utf-8", "ignore")).hexdigest()


def is_safe_remote_url(url: str) -> bool:
    """SSRF guard: only public http/https targets, never localhost/private/link-local."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        host = parsed.hostname.lower().rstrip(".")
        if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
            return False

        now = time.time()
        with _host_cache_lock:
            cached = _host_safety_cache.get(host)
            if cached and now - cached[1] < _HOST_CACHE_TTL:
                return cached[0]

        # Literal IP albo jednorazowa walidacja DNS; wynik hosta cache'ujemy, żeby
        # zabezpieczenie SSRF nie dokładało osobnego DNS lookupu do każdej miniatury.
        try:
            ips = [ipaddress.ip_address(host)]
        except ValueError:
            try:
                ips = [ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)]
            except (socket.gaierror, ValueError):
                with _host_cache_lock:
                    _host_safety_cache[host] = (False, now)
                return False
        safe = all(ip.is_global for ip in ips)
        with _host_cache_lock:
            _host_safety_cache[host] = (safe, now)
        return safe
    except Exception:
        return False


def trim_cache_directory(directory: os.PathLike, max_bytes: int, preserve_suffixes=(".meta",)) -> None:
    """Przybliżony LRU po mtime; usuwa najstarsze pliki po przekroczeniu limitu."""
    root = Path(directory)
    try:
        files = [p for p in root.iterdir() if p.is_file() and not p.name.endswith(".tmp")]
    except OSError:
        return
    total = 0
    entries = []
    for p in files:
        try:
            st = p.stat()
            total += st.st_size
            # Meta waży mało, ale usuwamy go razem z odpowiadającym .bin poniżej.
            if p.suffix not in preserve_suffixes:
                entries.append((st.st_mtime, st.st_size, p))
        except OSError:
            pass
    if total <= max_bytes:
        return
    entries.sort(key=lambda x: x[0])
    target = int(max_bytes * 0.90)
    for _, size, p in entries:
        if total <= target:
            break
        try:
            p.unlink(missing_ok=True)
            meta = p.with_suffix(".meta") if p.suffix == ".bin" else None
            if meta and meta.exists():
                try:
                    total -= meta.stat().st_size
                except OSError:
                    pass
                meta.unlink(missing_ok=True)
            total -= size
        except OSError:
            pass
