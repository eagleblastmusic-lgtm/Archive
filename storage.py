import os
import re
import json
import copy
import logging
import threading
from datetime import datetime
from enum import Enum
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

from cache_store import atomic_write_json
from runtime_paths import get_user_store_path

logger = logging.getLogger("archivebate_storage")


def _locked_method(fn):
    """Serializuje operacje modyfikujące magazyn; RLock pozwala na zagnieżdżone wywołania."""
    def wrapped(self, *args, **kwargs):
        with self._lock:
            return fn(self, *args, **kwargs)
    wrapped.__name__ = fn.__name__
    wrapped.__doc__ = fn.__doc__
    return wrapped


STORE_FILE = str(get_user_store_path())


class SyncStatus(str, Enum):
    SUCCESS = "SUCCESS"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    NOT_CONFIGURED = "NOT_CONFIGURED"


@dataclass
class SyncResult:
    status: SyncStatus
    message: str
    watchlater_count: int = 0
    history_count: int = 0
    following_count: int = 0
    pending_reconciled: int = 0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "status": self.status.value,
            "success": self.status in (SyncStatus.SUCCESS, SyncStatus.PARTIAL),
            "message": self.message,
            "watchlater_count": self.watchlater_count,
            "history_count": self.history_count,
            "following_count": self.following_count,
            "pending_reconciled": self.pending_reconciled,
            "error": self.error
        }


def _sort_items_newest(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sortuje elementy od najnowszych."""
    def sort_key(v):
        try:
            added_at = str(v.get("added_at") or v.get("watched_at") or "")
            raw_id = re.sub(r'\D', '', str(v.get("id", "")))
            id_val = int(raw_id) if raw_id else 0
            return (added_at, id_val)
        except Exception:
            return ("", 0)
    return sorted(items, key=sort_key, reverse=True)


class UserStorage:
    def __init__(self, store_file: Optional[str] = None):
        self.store_file = store_file or STORE_FILE
        os.makedirs(os.path.dirname(self.store_file), exist_ok=True)
        self._lock = threading.RLock()
        self.data: Dict[str, Any] = {
            "favorites": [],
            "history": [],
            "following": [],
            "last_synced": None,
            "pending_sync_favorites": {},
            "blocked_models": [],
            "blocked_model_video_counts": {},
            "blocked_videos_total": 0
        }
        self._fav_ids: set = set()
        self._fav_authors: List[str] = []
        self._fav_authors_clean: set = set()
        self._blocked_norm_set: set = set()
        self.load()

    def _rebuild_indices(self):
        """Przebudowuje szybkie indeksy zbiorów w pamięci RAM do zapytań O(1)."""
        favs = self.data.get("favorites", [])
        self._fav_ids = {str(v.get("id")) for v in favs if isinstance(v, dict) and v.get("id")}
        authors = set()
        for v in favs:
            if isinstance(v, dict):
                u = v.get("username")
                if u and str(u).lower().strip() not in ["model", ""]:
                    authors.add(str(u).lower().strip())
        self._fav_authors = sorted(list(authors))
        self._fav_authors_clean = {re.sub(r'[^a-z0-9]', '', a) for a in self._fav_authors}
        self._blocked_norm_set = {
            re.sub(r'[^a-z0-9]', '', str(b).lower())
            for b in self.data.get("blocked_models", [])
            if b
        }

    def load(self):
        """Wczytuje zapisane dane użytkownika z pliku JSON."""
        with self._lock:
            if os.path.exists(self.store_file):
                try:
                    with open(self.store_file, "r", encoding="utf-8") as f:
                        loaded = json.load(f)
                    if isinstance(loaded, dict):
                        self.data = loaded
                except Exception as e:
                    logger.error(f"Błąd odczytu magazynu danych: {e}")

            counts = self.data.get("blocked_model_video_counts", {})
            if counts:
                self.data["blocked_videos_total"] = sum(counts.values())
            self._rebuild_indices()

    def _commit_candidate(self, candidate: Dict[str, Any]) -> bool:
        """Atomowo utrwala kandydata stanu na dysku.
        
        Wzorzec Prepare-Commit-Rollback:
        1. atomic_write_json wykonuje zapis do pliku tymczasowego + fsync + atomic replace.
        2. Tylko w razie sukcesu przypisuje self.data = candidate i przebudowuje indeksy RAM.
        3. W razie wyjątku (brak miejsca, brak uprawnień) stan w RAM pozostaje nienaruszony,
           zapobiegając fałszywym komunikatom o sukcesie (false success reporting).
        """
        counts = candidate.get("blocked_model_video_counts", {})
        if counts:
            candidate["blocked_videos_total"] = sum(counts.values())
        try:
            atomic_write_json(self.store_file, candidate)
            self.data = candidate
            self._rebuild_indices()
            return True
        except Exception as e:
            logger.error(f"Krytyczny błąd utrwalania stanu w magazynie: {e}")
            return False

    def save(self) -> bool:
        """Atomowy zapis stanu self.data na dysk. Zwraca True w razie potwierdzonego sukcesu."""
        with self._lock:
            return self._commit_candidate(copy.deepcopy(self.data))

    # ULUBIONE
    def get_favorites(self) -> List[Dict[str, Any]]:
        return _sort_items_newest(self.data.get("favorites", []))

    def is_favorite(self, video_id: str) -> bool:
        return str(video_id) in self._fav_ids

    @_locked_method
    def add_favorite(self, video: Dict[str, Any], record_pending_sync: bool = True) -> bool:
        v_id = str(video.get("id"))
        if not v_id or self.is_favorite(v_id):
            return False

        candidate = copy.deepcopy(self.data)
        item = dict(video)
        item["id"] = v_id
        item["added_at"] = video.get("added_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        candidate.setdefault("favorites", []).insert(0, item)

        if record_pending_sync:
            pending = candidate.setdefault("pending_sync_favorites", {})
            pending[v_id] = {
                "action": "add",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }

        return self._commit_candidate(candidate)

    @_locked_method
    def remove_favorite(self, video_id: str, record_pending_sync: bool = True) -> bool:
        v_id = str(video_id)
        if not v_id or not self.is_favorite(v_id):
            return False

        candidate = copy.deepcopy(self.data)
        favs = candidate.get("favorites", [])
        new_favs = [v for v in favs if str(v.get("id")) != v_id]
        if len(new_favs) == len(favs):
            return False

        candidate["favorites"] = new_favs
        if record_pending_sync:
            pending = candidate.setdefault("pending_sync_favorites", {})
            pending[v_id] = {
                "action": "remove",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }

        return self._commit_candidate(candidate)

    @_locked_method
    def toggle_favorite(self, video: Dict[str, Any]) -> bool:
        v_id = str(video.get("id"))
        if self.is_favorite(v_id):
            self.remove_favorite(v_id)
            return False
        else:
            self.add_favorite(video)
            return True

    def get_favorite_authors(self) -> List[str]:
        """Zwraca unikalną listę nazw autorów (lowercase), których filmy znajdują się w ulubionych."""
        return list(self._fav_authors)

    # SPÓJNOŚĆ LOKALNE <-> ZDALNE ULUBIONE (PENDING SYNC & RECONCILIATION)
    def get_pending_sync_favorites(self) -> Dict[str, Any]:
        """Zwraca słownik operacji na ulubionych oczekujących na synchronizację ze zdalnym kontem."""
        return dict(self.data.get("pending_sync_favorites", {}))

    @_locked_method
    def confirm_remote_sync(self, video_id: str) -> bool:
        """Usuwa identyfikator z kolejki oczekujących na synchronizację po potwierdzonym sukcesie zdalnym."""
        v_id = str(video_id)
        pending = self.data.get("pending_sync_favorites", {})
        if v_id in pending:
            candidate = copy.deepcopy(self.data)
            candidate.setdefault("pending_sync_favorites", {}).pop(v_id, None)
            return self._commit_candidate(candidate)
        return True

    @_locked_method
    def reconcile_pending_favorites(self, sync_fn) -> int:
        """Przesyła oczekujące lokalne zmiany ulubionych na serwer zdalny.
        sync_fn(video_id: str, action: str) -> bool
        Usuwa z kolejki wyłącznie elementy, dla których zdalny serwer potwierdził sukces.
        """
        pending = dict(self.data.get("pending_sync_favorites", {}))
        if not pending:
            return 0
        candidate = copy.deepcopy(self.data)
        cand_pending = candidate.setdefault("pending_sync_favorites", {})
        reconciled = 0
        for v_id, info in pending.items():
            action = info.get("action") if isinstance(info, dict) else str(info)
            try:
                if sync_fn(v_id, action):
                    cand_pending.pop(v_id, None)
                    reconciled += 1
            except Exception as e:
                logger.warning(f"Błąd uzgadniania ulubionego {v_id}: {e}")
        if reconciled > 0:
            self._commit_candidate(candidate)
        return reconciled

    # HISTORIA
    def get_history(self) -> List[Dict[str, Any]]:
        return _sort_items_newest(self.data.get("history", []))

    @_locked_method
    def record_history(self, video: Dict[str, Any]) -> bool:
        v_id = str(video.get("id"))
        if not v_id:
            return False

        candidate = copy.deepcopy(self.data)
        history = candidate.setdefault("history", [])
        history[:] = [h for h in history if str(h.get("id")) != v_id]

        item = dict(video)
        item["id"] = v_id
        item["watched_at"] = video.get("watched_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        history.insert(0, item)
        if len(history) > 1000:
            candidate["history"] = history[:1000]
        return self._commit_candidate(candidate)

    @_locked_method
    def clear_history(self) -> bool:
        candidate = copy.deepcopy(self.data)
        candidate["history"] = []
        return self._commit_candidate(candidate)

    # OBSERWOWANE
    def get_following(self) -> List[Dict[str, Any]]:
        return _sort_items_newest(self.data.get("following", []))

    # SYNCHRONIZACJA Z ARCHIVEBATE
    @_locked_method
    def merge_remote_data(
        self,
        watchlater: List[Dict[str, Any]],
        history: List[Dict[str, Any]],
        following: List[Dict[str, Any]],
        mode: str = "merge",
        is_full_sync: bool = True
    ) -> bool:
        """Scalanie danych z konta Archivebate z danymi lokalnymi.
        
        Parametr mode:
        - "merge": Unia addytywna (domyślna) — nie usuwa lokalnych elementów (np. Camwhores lub dodanych offline).
        - "mirror": Lustrzane odbicie dla zasobów Archivebate. Zdalna lista Archivebate staje się autorytatywna,
                    ale lokalne elementy z innych źródeł (np. Camwhores) oraz elementy w pending_sync_favorites
                    zostają nienaruszone.
        
        Parametr is_full_sync:
        - True: Zaktualizuj znacznik czasu last_synced (synchronizacja zakończona pełnym sukcesem).
        - False: Częściowa synchronizacja (np. zerwane połączenie) — NIE przesuwa last_synced,
                 aby nie oszukiwać systemu o kompletnym stanie.
        """
        candidate = copy.deepcopy(self.data)
        pending = candidate.get("pending_sync_favorites", {})

        # 1. Ulubione
        if mode == "mirror":
            # Dla mirror: zachowaj lokalne z innych źródeł oraz oczekujące lokalne dodania
            non_ab_favs = [
                v for v in candidate.get("favorites", [])
                if str(v.get("source", "")).lower() != "archivebate" and str(v.get("id", "")).startswith("cw_")
            ]
            pending_add_ids = {k for k, val in pending.items() if (val.get("action") if isinstance(val, dict) else val) == "add"}
            pending_favs = [v for v in candidate.get("favorites", []) if str(v.get("id")) in pending_add_ids]

            fav_map = {str(v.get("id")): v for v in (non_ab_favs + pending_favs) if v.get("id")}
            for v in watchlater:
                v_id = str(v.get("id"))
                if v_id and v_id not in fav_map:
                    # Jeśli element był oznaczony jako "remove" w pending, nie przywracaj go dopóki nie zostanie usunięty zdalnie
                    if pending.get(v_id, {}).get("action") == "remove":
                        continue
                    item = dict(v)
                    item["id"] = v_id
                    item["added_at"] = item.get("date") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    fav_map[v_id] = item
            candidate["favorites"] = list(fav_map.values())
        else:
            # Tryb "merge" (unia addytywna)
            favs = candidate.setdefault("favorites", [])
            fav_map = {str(v.get("id")): v for v in favs if v.get("id")}
            for v in watchlater:
                v_id = str(v.get("id"))
                if v_id and v_id not in fav_map:
                    item = dict(v)
                    item["id"] = v_id
                    item["added_at"] = item.get("date") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    fav_map[v_id] = item
            candidate["favorites"] = list(fav_map.values())

        # 2. Historia
        hist = candidate.setdefault("history", [])
        hist_map = {str(v.get("id")): v for v in hist if v.get("id")}
        for v in history:
            v_id = str(v.get("id"))
            if v_id and v_id not in hist_map:
                item = dict(v)
                item["id"] = v_id
                item["watched_at"] = item.get("date") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                hist_map[v_id] = item
        candidate["history"] = list(hist_map.values())

        # 3. Obserwowane
        if mode == "mirror":
            foll_map = {str(v.get("id")): v for v in following if v.get("id")}
            candidate["following"] = list(foll_map.values())
        else:
            foll = candidate.setdefault("following", [])
            foll_map = {str(v.get("id")): v for v in foll if v.get("id")}
            for v in following:
                v_id = str(v.get("id"))
                if v_id and v_id not in foll_map:
                    foll_map[v_id] = v
            candidate["following"] = list(foll_map.values())

        # 4. Znacznik czasu - aktualizowany TYLKO przy pełnym sukcesie
        if is_full_sync:
            candidate["last_synced"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        return self._commit_candidate(candidate)

    def search_stored_videos(self, query: str) -> List[Dict[str, Any]]:
        """Wyszukuje filmy z bazy użytkownika na podstawie tagów, keywords, opisu i modelki."""
        q = query.lower().replace("#", "").strip()
        if not q:
            return []
        results = []
        seen = set()
        all_items = self.data.get("favorites", []) + self.data.get("history", []) + self.data.get("following", [])
        for item in all_items:
            vid_id = str(item.get("id"))
            if not vid_id or vid_id in seen:
                continue
            tags = [str(t).lower() for t in item.get("tags", [])]
            kws = [str(k).lower() for k in item.get("keywords", [])]
            desc = str(item.get("description", "")).lower()
            username = str(item.get("username", "")).lower()
            if q in tags or any(q in t for t in tags) or q in kws or any(q in k for k in kws) or q in desc or q in username:
                seen.add(vid_id)
                results.append(item)
        return results

    # BLOKOWANIE / CZARNA LISTA MODELI
    def is_model_blocked(self, username: str) -> bool:
        if not username:
            return False
        norm = re.sub(r'[^a-z0-9]', '', str(username).lower())
        return norm in self._blocked_norm_set

    @_locked_method
    def block_model(self, username: str, video_count: Optional[int] = None) -> dict:
        if not username:
            return {"success": False, "removed_videos": 0}
        norm = re.sub(r'[^a-z0-9]', '', str(username).lower())
        if not norm or norm in ["model", "null", "none"]:
            return {"success": False, "removed_videos": 0}

        candidate = copy.deepcopy(self.data)
        blocked = candidate.setdefault("blocked_models", [])
        counts = candidate.setdefault("blocked_model_video_counts", {})

        # Zlicz i usuń wszystkie filmy tej modelki z favorites, history, following
        lib_removed = 0
        for key in ["favorites", "history", "following"]:
            before = len(candidate.get(key, []))
            candidate[key] = [v for v in candidate.get(key, []) if re.sub(r'[^a-z0-9]', '', str(v.get("username", "")).lower()) != norm]
            lib_removed += before - len(candidate.get(key, []))

        # Rzeczywista liczba usuniętych filmów tego autora z katalogu
        existing_count = counts.get(norm, 0)
        author_vids = video_count if (video_count and video_count > 0) else max(lib_removed, existing_count, 1)
        author_vids = max(author_vids, existing_count)
        counts[norm] = author_vids

        if not any(re.sub(r'[^a-z0-9]', '', str(b).lower()) == norm for b in blocked):
            blocked.append(username)

        # Łączna suma filmów wszystkich zablokowanych autorów
        candidate["blocked_videos_total"] = sum(counts.values())

        if not self._commit_candidate(candidate):
            return {"success": False, "removed_videos": 0}

        # Usuń modelkę z bazy tagów model_tags.json
        try:
            from model_tags import model_tag_manager
            with model_tag_manager._lock:
                if norm in model_tag_manager._db:
                    del model_tag_manager._db[norm]
                    model_tag_manager._dirty = True
        except Exception:
            pass

        return {"success": True, "removed_videos": author_vids}

    def get_blocked_stats(self) -> dict:
        """Zwraca statystyki blokowania: liczbę autorów i łączną liczbę usuniętych filmów."""
        counts = self.data.get("blocked_model_video_counts", {})
        total_vids = sum(counts.values()) if counts else self.data.get("blocked_videos_total", 0)
        return {
            "blocked_authors_count": len(self.get_blocked_models()),
            "blocked_videos_total": total_vids
        }

    @_locked_method
    def unblock_model(self, username: str) -> bool:
        norm = re.sub(r'[^a-z0-9]', '', str(username).lower())
        candidate = copy.deepcopy(self.data)
        blocked = candidate.get("blocked_models", [])
        candidate["blocked_models"] = [b for b in blocked if re.sub(r'[^a-z0-9]', '', str(b).lower()) != norm]
        counts = candidate.get("blocked_model_video_counts", {})
        if norm in counts:
            del counts[norm]
        candidate["blocked_videos_total"] = sum(counts.values())
        return self._commit_candidate(candidate)

    def get_blocked_models(self) -> List[str]:
        return sorted(list(set(self.data.get("blocked_models", []))))


storage = UserStorage()
