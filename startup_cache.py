import logging
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, Optional

logger = logging.getLogger("startup_cache")

MAX_STARTUP_CACHE_BYTES = int(os.environ.get("MAX_STARTUP_CACHE_BYTES", 32 * 1024 * 1024))
MAX_STARTUP_CACHE_ENTRIES = int(os.environ.get("MAX_STARTUP_CACHE_ENTRIES", 48))
STARTUP_CACHE_TTL = float(os.environ.get("STARTUP_CACHE_TTL", 120.0))
TAIL_CACHE_BYTES = int(os.environ.get("TAIL_CACHE_BYTES", 64 * 1024))


class StartupRangeCache:
    def __init__(self, max_bytes: int = MAX_STARTUP_CACHE_BYTES, max_entries: int = MAX_STARTUP_CACHE_ENTRIES, ttl: float = STARTUP_CACHE_TTL):
        self._max_bytes = max_bytes
        self._max_entries = max_entries
        self._ttl = ttl
        self._lock = threading.RLock()
        self._entries: OrderedDict[str, Dict[str, Any]] = OrderedDict()
        self._current_bytes = 0

    def is_enabled(self) -> bool:
        flag = os.environ.get("ARCHIVEBATE_STARTUP_RANGE_CACHE", "1").strip().lower()
        return flag not in ("0", "false", "no", "disabled")

    def put_tail(
        self,
        video_id: str,
        url_generation: int,
        content_length: int,
        tail_start: int,
        tail_end: int,
        tail_bytes: bytes,
        etag: Optional[str] = None,
        last_modified: Optional[str] = None,
        content_type: str = "video/mp4"
    ) -> bool:
        if not self.is_enabled():
            return False
        clean_id = str(video_id).split("/")[-1].split("?")[0].strip()
        if not clean_id or not tail_bytes:
            return False

        size = len(tail_bytes)
        now = time.time()

        with self._lock:
            if clean_id in self._entries:
                old = self._entries.pop(clean_id)
                self._current_bytes -= len(old.get("tail_bytes", b""))

            while self._entries and (self._current_bytes + size > self._max_bytes or len(self._entries) >= self._max_entries):
                _, evicted = self._entries.popitem(last=False)
                self._current_bytes -= len(evicted.get("tail_bytes", b""))

            entry = {
                "video_id": clean_id,
                "url_generation": url_generation,
                "content_length": content_length,
                "tail_start": tail_start,
                "tail_end": tail_end,
                "tail_bytes": tail_bytes,
                "etag": etag,
                "last_modified": last_modified,
                "content_type": content_type,
                "created_at": now,
                "last_access": now
            }
            self._entries[clean_id] = entry
            self._current_bytes += size
            return True

    def get_range(
        self,
        video_id: str,
        url_generation: int,
        req_start: int,
        req_end: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        if not self.is_enabled():
            return None
        clean_id = str(video_id).split("/")[-1].split("?")[0].strip()
        if not clean_id:
            return None

        now = time.time()
        with self._lock:
            entry = self._entries.get(clean_id)
            if not entry:
                return None

            if now - entry["created_at"] > self._ttl:
                self.invalidate(clean_id)
                return None

            if url_generation and entry.get("url_generation") != url_generation:
                self.invalidate(clean_id)
                return None

            tail_start = entry["tail_start"]
            tail_end = entry["tail_end"]
            total_size = entry["content_length"]

            effective_req_end = (total_size - 1) if req_end is None else req_end

            if req_start >= tail_start and effective_req_end <= tail_end:
                offset_start = req_start - tail_start
                offset_end = offset_start + (effective_req_end - req_start + 1)
                chunk = entry["tail_bytes"][offset_start:offset_end]

                entry["last_access"] = now
                self._entries.move_to_end(clean_id)

                return {
                    "data": chunk,
                    "status_code": 206,
                    "content_range": f"bytes {req_start}-{effective_req_end}/{total_size}",
                    "content_length": str(len(chunk)),
                    "content_type": entry["content_type"],
                    "accept_ranges": "bytes",
                    "etag": entry.get("etag"),
                    "last_modified": entry.get("last_modified"),
                    "cache_tag": "HIT-TAIL"
                }

            return None

    def invalidate(self, video_id: str) -> None:
        clean_id = str(video_id).split("/")[-1].split("?")[0].strip()
        if not clean_id:
            return
        with self._lock:
            if clean_id in self._entries:
                old = self._entries.pop(clean_id)
                self._current_bytes -= len(old.get("tail_bytes", b""))

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._current_bytes = 0

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "entries_count": len(self._entries),
                "current_bytes": self._current_bytes,
                "max_bytes": self._max_bytes,
                "max_entries": self._max_entries,
                "is_enabled": self.is_enabled()
            }


startup_range_cache = StartupRangeCache()
