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

import requests
import requests.adapters
import urllib3
import urllib3.connection
import urllib3.connectionpool
import urllib3.util.connection

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

from runtime_paths import get_runtime_data_dir, get_cache_dir, ensure_runtime_data_dirs

ensure_runtime_data_dirs()
DATA_DIR = get_runtime_data_dir()
FEED_CACHE_DIR = get_cache_dir("feed_cache")
DETAILS_CACHE_DIR = get_cache_dir("details_cache")
THUMBS_CACHE_DIR = get_cache_dir("thumbs_cache")
STORYBOARD_CACHE_DIR = get_cache_dir("storyboard_cache")

_json_lock = threading.RLock()


def is_ip_safe(ip_obj: Any) -> bool:
    """Sprawdza czy adres IP jest bezpiecznym, globalnym adresem publicznym.
    
    Odrzuca: loopback, prywatne, link-local, carrier-grade NAT, multicast, reserved,
    unspecified oraz IPv4-mapped IPv6 w przestrzeni prywatnej.
    """
    if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped:
        ip_obj = ip_obj.ipv4_mapped
    if not ip_obj.is_global:
        return False
    if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_reserved or ip_obj.is_unspecified:
        return False
    # Carrier-grade NAT (100.64.0.0/10)
    cg_nat = ipaddress.ip_network("100.64.0.0/10")
    if isinstance(ip_obj, ipaddress.IPv4Address) and ip_obj in cg_nat:
        return False
    return True


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
    """SSRF guard: tylko publiczne, globalnie routowalne cele HTTP/HTTPS.
    
    Usuwa podatność na DNS Rebinding (brak 300s TTL cache dla hosta) oraz
    weryfikuje wszystkie zwrócone rekordy DNS (IPv4 i IPv6).
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        host = parsed.hostname.lower().rstrip(".")
        if host in {"localhost", "localhost.localdomain"} or host.endswith(".local") or host.endswith(".internal"):
            return False

        # 1. Dosłowny adres IP w URL
        try:
            ip = ipaddress.ip_address(host)
            return is_ip_safe(ip)
        except ValueError:
            pass

        # 2. Rozwiązanie DNS w czasie rzeczywistym (bez cache'owania bezpieczeństwa)
        try:
            resolved = socket.getaddrinfo(
                host,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM
            )
        except (socket.gaierror, ValueError, OSError):
            return False

        if not resolved:
            return False

        for item in resolved:
            raw_ip = item[4][0]
            try:
                ip = ipaddress.ip_address(raw_ip)
                if not is_ip_safe(ip):
                    return False
            except ValueError:
                return False

        return True
    except Exception:
        return False


class SSRFSecurityError(IOError):
    """Zgłaszany przy próbie połączenia z adresem prywatnym, loopback lub zabronionym."""
    pass


def safe_create_connection(
    address: Tuple[str, int],
    timeout=urllib3.util.connection._DEFAULT_TIMEOUT,
    source_address=None,
    socket_options=None,
) -> socket.socket:
    """Nawiązuje połączenie socketowe z walidacją adresu IP bezpośrednio przed connect().
    
    Eliminuje fundamentalną lukę TOCTOU (Time-of-Check to Time-of-Use) i DNS Rebinding:
    - Host jest rozwiązywany na bieżąco.
    - Każdy rekord DNS jest sprawdzany przez is_ip_safe().
    - Przed wywołaniem sock.connect(sa) bezpośrednio weryfikowany jest docelowy adres IP.
    - Jeśli jakikolwiek adres jest prywatny, loopback, link-local, cloud metadata itp.,
      połączenie zostaje natychmiast odrzucone przed wysłaniem jakichkolwiek bajtów HTTP.
    """
    host, port = address
    if host.startswith("["):
        host = host.strip("[]")

    host_lower = host.lower().rstrip(".")
    if host_lower in {"localhost", "localhost.localdomain"} or host_lower.endswith(".local") or host_lower.endswith(".internal"):
        raise SSRFSecurityError(f"Host '{host}' jest zablokowany przez reguły SSRF.")

    # 1. Bezpośredni adres IP
    try:
        ip = ipaddress.ip_address(host)
        if not is_ip_safe(ip):
            raise SSRFSecurityError(f"Docelowy adres IP '{ip}' jest niedozwolony (ochrona SSRF).")
        family = socket.AF_INET6 if ip.version == 6 else socket.AF_INET
        gai_entries = [(family, socket.SOCK_STREAM, 0, "", (str(ip), port))]
    except ValueError:
        # 2. Rozwiązanie DNS
        try:
            family = urllib3.util.connection.allowed_gai_family()
            gai_entries = socket.getaddrinfo(host, port, family, socket.SOCK_STREAM)
        except socket.gaierror as e:
            raise urllib3.exceptions.NameResolutionError(host, None, e) from e

        if not gai_entries:
            raise OSError(f"Brak rekordów DNS dla hosta '{host}'")

        # Sprawdzamy wszystkie rekordy - jeśli jakikolwiek jest prywatny/loopback, blokujemy natychmiast!
        for item in gai_entries:
            raw_ip = item[4][0]
            try:
                ip_obj = ipaddress.ip_address(raw_ip)
                if not is_ip_safe(ip_obj):
                    raise SSRFSecurityError(f"Rozwiązany adres IP '{raw_ip}' dla hosta '{host}' jest niedozwolony (ochrona SSRF / DNS Rebinding).")
            except ValueError:
                raise SSRFSecurityError(f"Niepoprawny adres IP '{raw_ip}' dla hosta '{host}'.")

    # 3. Próba nawiązania połączenia wyłącznie ze sprawdzonym adresem
    err = None
    for res in gai_entries:
        af, socktype, proto, canonname, sa = res
        try:
            ip_conn = ipaddress.ip_address(sa[0])
            if not is_ip_safe(ip_conn):
                raise SSRFSecurityError(f"Próba połączenia z niebezpiecznym adresem '{sa[0]}' przerwana.")
        except ValueError:
            raise SSRFSecurityError(f"Niepoprawny adres gniazda: '{sa[0]}'")

        sock = None
        try:
            sock = socket.socket(af, socktype, proto)
            urllib3.util.connection._set_socket_options(sock, socket_options)
            if timeout is not urllib3.util.connection._DEFAULT_TIMEOUT:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(sa)
            return sock
        except OSError as e:
            err = e
            if sock is not None:
                sock.close()

    if err is not None:
        raise err
    raise OSError("Nie udało się połączyć z żadnym ze sprawdzonych adresów IP")


class SafeHTTPConnection(urllib3.connection.HTTPConnection):
    def _new_conn(self) -> socket.socket:
        return safe_create_connection(
            (self._dns_host, self.port),
            self.timeout,
            source_address=self.source_address,
            socket_options=self.socket_options,
        )


class SafeHTTPSConnection(urllib3.connection.HTTPSConnection):
    def _new_conn(self) -> socket.socket:
        return safe_create_connection(
            (self._dns_host, self.port),
            self.timeout,
            source_address=self.source_address,
            socket_options=self.socket_options,
        )


class SafeHTTPConnectionPool(urllib3.connectionpool.HTTPConnectionPool):
    ConnectionCls = SafeHTTPConnection


class SafeHTTPSConnectionPool(urllib3.connectionpool.HTTPSConnectionPool):
    ConnectionCls = SafeHTTPSConnection


class SafePoolManager(urllib3.PoolManager):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pool_classes_by_scheme = {
            "http": SafeHTTPConnectionPool,
            "https": SafeHTTPSConnectionPool,
        }


class SafeHTTPAdapter(requests.adapters.HTTPAdapter):
    """Adapter requests wymuszający bezpieczne gniazda TCP odporne na TOCTOU i DNS Rebinding."""
    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        self.poolmanager = SafePoolManager(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            **pool_kwargs
        )


def create_safe_session(pool_connections: int = 20, pool_maxsize: int = 20) -> requests.Session:
    """Tworzy sesję requests zabezpieczoną przed SSRF i DNS Rebinding na poziomie gniazda."""
    sess = requests.Session()
    adapter = SafeHTTPAdapter(pool_connections=pool_connections, pool_maxsize=pool_maxsize)
    sess.mount("http://", adapter)
    sess.mount("https://", adapter)
    return sess


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
