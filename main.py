import os
import re
import json
import math
import hashlib
import requests
import threading
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import urljoin
from fastapi import FastAPI, Query, Request, HTTPException, Body, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from client import ArchivebateSession
from scraper import ArchivebateScraper, POPULAR_TAGS, extract_video_tags
from storage import storage, SyncResult, SyncStatus
from camwhores import camwhores_scraper, deduplicate_videos, normalize_model_name
from model_tags import model_tag_manager
from config import get_archivebate_credentials
from cache_store import (
    THUMBS_CACHE_DIR, FEED_CACHE_DIR, DETAILS_CACHE_DIR, STORYBOARD_CACHE_DIR,
    atomic_write_json, read_json_cache, cache_age_seconds, safe_cache_key,
    is_safe_remote_url, trim_cache_directory, SafeHTTPAdapter, SSRFSecurityError,
)
from storyboard_service import start as start_storyboard, get_status as get_storyboard_status, sprite_path as get_storyboard_sprite_path

# Dane logowania nie są już zapisane w kodzie źródłowym.
_archivebate_email, _archivebate_password = get_archivebate_credentials()
session = ArchivebateSession(email=_archivebate_email, password=_archivebate_password)
scraper = ArchivebateScraper(session)

THUMBS_CACHE_DIR = str(THUMBS_CACHE_DIR)
FEED_CACHE_DIR = str(FEED_CACHE_DIR)
DETAILS_CACHE_DIR = str(DETAILS_CACHE_DIR)
STORYBOARD_CACHE_DIR = str(STORYBOARD_CACHE_DIR)

def sync_account_data(mode: str = "merge") -> SyncResult:
    """Zaciąga pełne listy ulubionych, historii i obserwowanych ze wszystkich stron Archivebate.
    Obsługuje uzgadnianie oczekujących operacji (reconciliation) oraz zwraca ustrukturyzowany SyncResult.
    """
    try:
        print("[Archivebate Browser] Głęboka synchronizacja danych konta online...")
        if not session.email or not session.password:
            msg = "Brak skonfigurowanych danych konta w .env.local ani zmiennych środowiskowych."
            print(f"[Archivebate Browser] Pomijam synchronizację konta: {msg}")
            return SyncResult(status=SyncStatus.NOT_CONFIGURED, message=msg)

        if not session.is_logged_in and not session.login():
            err = session.last_login_error or "Logowanie nie powiodło się"
            return SyncResult(status=SyncStatus.FAILED, message="Nie udało się zalogować do serwisu", error=err)

        # 1. Uzgadnianie lokalnych zmian oczekujących (pending sync reconciliation)
        reconciled = storage.reconcile_pending_favorites(lambda vid, act: scraper.toggle_remote_save(vid))

        # 2. Pobieranie danych z konta
        watchlater = scraper.get_account_section_videos("watchlater", max_pages=15)
        history = scraper.get_account_section_videos("history", max_pages=15)
        following = scraper.get_account_section_videos("following", max_pages=15)

        is_full = (len(watchlater) >= 0 and len(history) >= 0 and len(following) >= 0)
        storage.merge_remote_data(watchlater, history, following, mode=mode, is_full_sync=is_full)
        print(f"[Archivebate Browser] Zsynchronizowano: {len(watchlater)} ulubionych, {len(history)} historii, {len(following)} obserwowanych, {reconciled} uzgodnionych.")
        return SyncResult(
            status=SyncStatus.SUCCESS,
            message="Synchronizacja konta zakończona sukcesem",
            watchlater_count=len(watchlater),
            history_count=len(history),
            following_count=len(following),
            pending_reconciled=reconciled
        )
    except Exception as e:
        print(f"[Archivebate Browser] Błąd synchronizacji: {e}")
        return SyncResult(status=SyncStatus.FAILED, message=f"Błąd synchronizacji: {e}", error=str(e))


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Archivebate Browser] Błyskawiczny start serwera...")
    def background_startup():
        try:
            if session.email and session.password:
                session.login()
            # Czyszczenie cache poza ścieżką krytyczną startu.
            trim_cache_directory(THUMBS_CACHE_DIR, max_bytes=750 * 1024 * 1024)
            trim_cache_directory(DETAILS_CACHE_DIR, max_bytes=150 * 1024 * 1024)
            trim_cache_directory(FEED_CACHE_DIR, max_bytes=60 * 1024 * 1024)
            trim_cache_directory(STORYBOARD_CACHE_DIR, max_bytes=500 * 1024 * 1024, preserve_suffixes=())
        except Exception as e:
            print(f"[Archivebate Browser] Błąd inicjalizacji: {e}")
    threading.Thread(target=background_startup, daemon=True).start()
    yield
    print("[Archivebate Browser] Zamykanie aplikacji.")

app = FastAPI(title="Archivebate Video Browser", lifespan=lifespan)

# Duże feedy JSON/CSS/JS są kompresowane; dla lokalnego UI zmniejsza to koszt kopiowania
# i szczególnie pomaga, gdy aplikacja jest otwierana z innego urządzenia w LAN.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000", "http://localhost:8000",
        "http://127.0.0.1", "http://localhost",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Range", "Accept"],
)

class OptimizedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        query_string = scope.get("query_string", b"").decode("latin-1", errors="ignore")
        is_html = path.endswith(".html") or path.endswith(".htm")
        if is_html:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        elif "v=" in query_string:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=604800"
        return response

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", OptimizedStaticFiles(directory=STATIC_DIR), name="static")

def _enrich_videos(videos: list, author_filter: str = "all") -> list:
    """Dodaje flagę is_favorite, usuwa wszelkie duplikaty oraz filtruje zablokowane profile z całego programu."""
    videos = deduplicate_videos(videos)

    blocked_set = storage._blocked_norm_set
    if blocked_set:
        videos = [
            v for v in videos
            if isinstance(v, dict) and normalize_model_name(v.get("username", "")) not in blocked_set
        ]

    fav_authors_clean = storage._fav_authors_clean
    favorite_ids = storage._fav_ids

    if author_filter == "exclude_fav":
        videos = [
            v for v in videos
            if isinstance(v, dict) and normalize_model_name(v.get("username", "")) not in fav_authors_clean and str(v.get("id")) not in favorite_ids
        ]
    elif author_filter == "only_fav":
        videos = [
            v for v in videos
            if isinstance(v, dict) and (normalize_model_name(v.get("username", "")) in fav_authors_clean or str(v.get("id")) in favorite_ids)
        ]

    cw_details = camwhores_scraper._details_cache

    for v in videos:
        if isinstance(v, dict) and "id" in v:
            v_id_str = str(v["id"])
            v["is_favorite"] = v_id_str in favorite_ids
            u_clean = normalize_model_name(v.get("username", ""))
            v["has_favorite_video"] = u_clean in fav_authors_clean
            v["tags"] = v.get("tags") or extract_video_tags(v)
            
            poster = v.get("poster") or v.get("thumbnail") or ""
            if "logo" in poster.lower():
                poster = ""
            if poster:
                if poster.endswith(".mp4"):
                    poster = poster.replace(".mp4", ".jpg")
                v["poster"] = poster
                if "freefile.io" in poster or "camwhores" in poster:
                    v["poster_direct"] = poster
                v["poster_proxy"] = f"/api/thumb?url={requests.utils.quote(poster)}"
                v["thumbnail_proxy"] = f"/api/thumb?url={requests.utils.quote(poster)}"
            
            preview = v.get("preview_video") or ""
            if "logo" in preview.lower():
                preview = ""
            if v.get("source") != "camwhores" and not preview and poster and ".jpg" in poster and not poster.endswith("/logo.png"):
                preview = poster.replace(".jpg", ".mp4")
            if preview:
                v["preview_video"] = preview
                if "freefile.io" in preview:
                    v["preview_direct"] = preview
                    v["preview_proxy"] = preview
                else:
                    v["preview_proxy"] = f"/api/video/stream?url={requests.utils.quote(preview)}"

            if (v.get("source") == "camwhores" or v_id_str.startswith("cw_")) and not v.get("preview_video"):
                raw_id = v_id_str.replace("cw_", "").strip()
                if raw_id in cw_details:
                    cached_det = cw_details[raw_id]["data"]
                    if cached_det.get("direct_url"):
                        v["preview_video"] = cached_det["direct_url"]
                        v["preview_proxy"] = f"/api/video/stream?url={requests.utils.quote(cached_det['direct_url'])}"

            model_tag_manager.enrich_video(v)

    return videos

@app.get("/")
async def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        })
    return JSONResponse({"message": "Archivebate API działa. Brak pliku static/index.html"})

@app.get("/watch/{video_id}")
async def serve_watch_page(video_id: str):
    """Serwuje dedykowaną stronę odtwarzacza w nowym oknie/karcie bez reklam."""
    watch_path = os.path.join(STATIC_DIR, "watch.html")
    target = watch_path if os.path.exists(watch_path) else os.path.join(STATIC_DIR, "index.html")
    return FileResponse(target, headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    })

import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Pamięć podręczna RAM (LRU) dla natychmiastowego serwowania (0.2 ms)
MEMORY_CACHE_LOCK = threading.Lock()
MEMORY_CACHE_MAX = 600
MEMORY_CACHE = OrderedDict()

# Dedykowana sesja z pulą bezpiecznych połączeń (ochrona na poziomie gniazda TCP przed TOCTOU/DNS Rebinding)
thumb_session = requests.Session()
_adapter = SafeHTTPAdapter(pool_connections=50, pool_maxsize=50, max_retries=Retry(total=2, backoff_factor=0.1))
thumb_session.mount("http://", _adapter)
thumb_session.mount("https://", _adapter)
thumb_session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://archivebate.com/"
})

def _validated_session_get(http_session, url: str, *, headers=None, timeout=8, stream=False, max_redirects=3):
    """GET z podwójną ochroną SSRF: walidacja redirectów URL oraz socket-level TOCTOU/DNS Rebinding guard."""
    current = url
    for _ in range(max_redirects + 1):
        if not is_safe_remote_url(current):
            raise HTTPException(status_code=400, detail="Niedozwolony adres zdalny (ochrona SSRF)")
        try:
            res = http_session.get(current, headers=headers, timeout=timeout, stream=stream, allow_redirects=False)
        except (SSRFSecurityError, requests.exceptions.RequestException) as exc:
            if "SSRF" in str(exc) or isinstance(exc, SSRFSecurityError):
                raise HTTPException(status_code=400, detail="Niedozwolony adres docelowy połączenia (ochrona SSRF / DNS Rebinding)")
            raise HTTPException(status_code=502, detail=f"Błąd połączenia ze zdalnym serwerem: {type(exc).__name__}")
        if res.status_code not in (301, 302, 303, 307, 308):
            return res
        location = res.headers.get("Location")
        res.close()
        if not location:
            return res
        current = urljoin(current, location)
    raise HTTPException(status_code=502, detail="Zbyt wiele przekierowań zdalnego zasobu")

@app.get("/api/thumb")
def get_thumbnail_proxy(url: str = Query(...)):
    """Błyskawiczne serwowanie miniatur z pamięci RAM (0.2 ms) lub dysku."""
    if not url.startswith("http"):
        url = "https:" + url if url.startswith("//") else f"https://archivebate.com{url}"

    if url.endswith(".mp4"):
        url = url.replace(".mp4", ".jpg")

    if not is_safe_remote_url(url):
        raise HTTPException(status_code=400, detail="Niedozwolony adres miniatury")

    url_hash = hashlib.md5(url.encode()).hexdigest()

    # 1. Błyskawiczny odczyt z RAM
    with MEMORY_CACHE_LOCK:
        if url_hash in MEMORY_CACHE:
            content, content_type = MEMORY_CACHE[url_hash]
            return Response(content=content, media_type=content_type, headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Cache": "RAM"
            })

    # 2. Odczyt z dysku
    cache_path = os.path.join(THUMBS_CACHE_DIR, f"{url_hash}.bin")
    meta_path = os.path.join(THUMBS_CACHE_DIR, f"{url_hash}.meta")

    if os.path.exists(cache_path) and os.path.exists(meta_path):
        try:
            with open(meta_path, "r") as mf:
                content_type = mf.read().strip()
            with open(cache_path, "rb") as cf:
                content = cf.read()
            try:
                os.utime(cache_path, None)
            except OSError:
                pass
            with MEMORY_CACHE_LOCK:
                MEMORY_CACHE[url_hash] = (content, content_type)
                if len(MEMORY_CACHE) > MEMORY_CACHE_MAX:
                    MEMORY_CACHE.popitem(last=False)
            return Response(content=content, media_type=content_type, headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Cache": "DISK"
            })
        except Exception:
            pass

    # 3. Pobierz z sieci
    try:
        res = _validated_session_get(thumb_session, url, timeout=6)
        if res.status_code == 200:
            content_type = res.headers.get("Content-Type", "image/jpeg")
            try:
                with open(cache_path, "wb") as cf:
                    cf.write(res.content)
                with open(meta_path, "w") as mf:
                    mf.write(content_type)
                with MEMORY_CACHE_LOCK:
                    MEMORY_CACHE[url_hash] = (res.content, content_type)
                    if len(MEMORY_CACHE) > MEMORY_CACHE_MAX:
                        MEMORY_CACHE.popitem(last=False)
                # Limit cache dyskowego ~750 MB, sprawdzany poza każdą pojedynczą odpowiedzią.
                if len(MEMORY_CACHE) % 40 == 0:
                    threading.Thread(target=trim_cache_directory, args=(THUMBS_CACHE_DIR, 750 * 1024 * 1024), daemon=True).start()
            except Exception:
                pass
            return Response(content=res.content, media_type=content_type, headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Cache": "NET"
            })
    except Exception:
        pass

    transparent_gif = b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;'
    return Response(content=transparent_gif, media_type="image/gif")

def _build_status_dict() -> dict:
    """Zwraca słownik statusu natychmiast z pamięci lokalnej."""
    status = session.get_status()
    status["account_configured"] = bool(session.email and session.password)
    status["favorites_count"] = len(storage.data.get("favorites", []))
    status["history_count"] = len(storage.data.get("history", []))
    status["following_count"] = len(storage.data.get("following", []))
    status["last_synced"] = storage.data.get("last_synced")
    status["favorite_authors"] = storage.get_favorite_authors()
    status["pending_sync_favorites_count"] = len(storage.get_pending_sync_favorites())
    return status

@app.get("/api/status")
def get_status():
    """Zwraca status natychmiast z pamięci lokalnej.
    
    Logowanie odbywa się już w wątku startowym aplikacji. Nie wykonujemy tutaj
    pełnej synchronizacji konta ani dodatkowego logowania, bo endpoint jest
    odpytywany równolegle z pierwszym ekranem.
    """
    return _build_status_dict()

@app.post("/api/relogin")
def relogin():
    """Ponawia logowanie; ponownie czyta .env.local, więc nie wymaga restartu aplikacji."""
    email, password = get_archivebate_credentials()
    session.email = email
    session.password = password
    success = session.login()
    if success:
        threading.Thread(target=sync_account_data, daemon=True).start()
    return {"success": success, "status": _build_status_dict()}

# ENDPOINTY PANELU KONTA
@app.get("/api/account/summary")
def get_account_summary():
    """Zwraca podsumowanie panelu konta."""
    if not storage.data.get("last_synced"):
        sync_account_data()
    return {
        "email": session.email,
        "logged_in": session.is_logged_in,
        "favorites_count": len(storage.data.get("favorites", [])),
        "history_count": len(storage.data.get("history", [])),
        "following_count": len(storage.data.get("following", [])),
        "last_synced": storage.data.get("last_synced")
    }

@app.get("/api/account/favorites")
def get_account_favorites(page: int = Query(1, ge=1), per_page: int = Query(280, ge=1, le=1000)):
    """Zwraca listę ulubionych wideo z obsługą stron."""
    favs = storage.get_favorites()
    if len(favs) == 0 and not storage.data.get("last_synced"):
        sync_account_data()
        favs = storage.get_favorites()

    total = len(favs)
    last_page = max(1, math.ceil(total / per_page))
    start_idx = (page - 1) * per_page
    sliced = favs[start_idx : start_idx + per_page]

    return {
        "total": total,
        "page": page,
        "last_page": last_page,
        "count": len(sliced),
        "videos": _enrich_videos(sliced)
    }

@app.post("/api/account/favorites/toggle")
def toggle_favorite(video: dict = Body(...)):
    """Dodaje lub usuwa wideo z ulubionych (lokalnie i zdalnie) z pełną spójnością."""
    is_fav = storage.toggle_favorite(video)
    v_id = str(video.get("id"))
    remote_synced = False
    if v_id and session.is_logged_in:
        try:
            remote_synced = scraper.toggle_remote_save(v_id)
            if remote_synced:
                storage.confirm_remote_sync(v_id)
        except Exception:
            remote_synced = False

    return {
        "id": v_id,
        "is_favorite": is_fav,
        "remote_synced": remote_synced,
        "pending_sync": not remote_synced,
        "total_favorites": len(storage.get_favorites()),
        "favorite_authors": storage.get_favorite_authors()
    }

@app.get("/api/account/history")
def get_account_history(page: int = Query(1, ge=1), per_page: int = Query(280, ge=1, le=1000)):
    """Zwraca historię oglądanych wideo z obsługą stron."""
    hist = storage.get_history()
    if len(hist) == 0 and not storage.data.get("last_synced"):
        sync_account_data()
        hist = storage.get_history()

    total = len(hist)
    last_page = max(1, math.ceil(total / per_page))
    start_idx = (page - 1) * per_page
    sliced = hist[start_idx : start_idx + per_page]

    return {
        "total": total,
        "page": page,
        "last_page": last_page,
        "count": len(sliced),
        "videos": _enrich_videos(sliced)
    }

@app.post("/api/account/history/record")
def record_history(video: dict = Body(...)):
    """Zapisuje obejrzenie filmu w historii."""
    storage.record_history(video)
    return {"success": True, "total_history": len(storage.get_history())}

@app.post("/api/account/history/clear")
def clear_history():
    """Czyści lokalną historię oglądania."""
    storage.clear_history()
    return {"success": True, "total_history": 0}

@app.get("/api/account/following")
def get_account_following(page: int = Query(1, ge=1), per_page: int = Query(280, ge=1, le=1000)):
    """Zwraca wideo z obserwowanych kanałów z obsługą stron."""
    foll = storage.get_following()
    if len(foll) == 0 and not storage.data.get("last_synced"):
        sync_account_data()
        foll = storage.get_following()

    total = len(foll)
    last_page = max(1, math.ceil(total / per_page))
    start_idx = (page - 1) * per_page
    sliced = foll[start_idx : start_idx + per_page]

    return {
        "total": total,
        "page": page,
        "last_page": last_page,
        "count": len(sliced),
        "videos": _enrich_videos(sliced)
    }

@app.post("/api/account/sync")
def sync_account(mode: str = Query("merge")):
    """Wymusza pełną synchronizację z kontem Archivebate (mode=merge lub mode=mirror)."""
    res = sync_account_data(mode=mode)
    return {
        **res.to_dict(),
        "favorites_count": len(storage.get_favorites()),
        "history_count": len(storage.get_history()),
        "following_count": len(storage.get_following()),
        "last_synced": storage.data.get("last_synced")
    }

@app.get("/api/tags")
def get_tags():
    """Zwraca listę przykładowych i popularnych tagów z serwisu."""
    return {"tags": POPULAR_TAGS}

_feed_refresh_lock = threading.Lock()
_feed_refreshing = set()
HOME_FEED_FRESH_SECONDS = 90
HOME_PAGE_SIZE = 280


def _get_fav_authors_feed(page: int = 1, source: str = "all", target_count: int = 280) -> list:
    """Pobiera feed składający się wyłącznie z ulubionych filmów oraz filmów od ulubionych autorów."""
    fav_videos = list(storage.get_favorites())
    if source == "only-camwhores":
        fav_videos = [v for v in fav_videos if v.get("source") == "camwhores" or "camwhores" in str(v.get("platform", "")).lower()]
    elif source == "only-archivebate":
        fav_videos = [v for v in fav_videos if v.get("source") != "camwhores" and "camwhores" not in str(v.get("platform", "")).lower()]

    fav_authors = storage.get_favorite_authors()

    needed = page * target_count
    from camwhores import deduplicate_videos
    combined = deduplicate_videos(fav_videos)

    if len(combined) < needed and fav_authors:
        authors_batch_size = 20 if source == "only-camwhores" else 10
        start_author_idx = ((page - 1) * authors_batch_size) % len(fav_authors)
        offset = 0
        author_videos = []

        while len(combined) < needed and offset < 60 and offset < len(fav_authors):
            batch = [fav_authors[(start_author_idx + offset + i) % len(fav_authors)] for i in range(min(authors_batch_size, len(fav_authors)))]
            offset += authors_batch_size

            with ThreadPoolExecutor(max_workers=len(batch)) as executor:
                if source == "only-camwhores":
                    for res in executor.map(lambda a: camwhores_scraper.search_videos(a, 1), batch):
                        author_videos.extend(res.get("videos", []) if isinstance(res, dict) else (res or []))
                else:
                    for vlist in executor.map(lambda a: scraper.get_model_videos(a, 1), batch):
                        author_videos.extend(vlist or [])

            combined = deduplicate_videos(fav_videos + author_videos)

    from scraper import sort_videos_newest_first
    sorted_vids = sort_videos_newest_first(combined)

    start_idx = (page - 1) * target_count
    return sorted_vids[start_idx : start_idx + target_count]


def _home_feed_cache_path(page: int, source: str = "all", author_filter: str = "all") -> str:
    clean_src = re.sub(r'[^a-zA-Z0-9_-]', '', source or "all")
    clean_af = re.sub(r'[^a-zA-Z0-9_-]', '', author_filter or "all")
    return os.path.join(FEED_CACHE_DIR, f"feed_{clean_src}_{clean_af}_{page}.json")


def _fetch_and_cache_home(page: int, source: str = "all", author_filter: str = "all") -> list:
    blocked_models = set(re.sub(r'[^a-z0-9]', '', b.lower()) for b in storage.get_blocked_models())
    fav_authors = set(re.sub(r'[^a-z0-9]', '', a.lower()) for a in storage.get_favorite_authors())

    if author_filter == "only_fav":
        videos = _get_fav_authors_feed(page=page, source=source, target_count=HOME_PAGE_SIZE)
    else:
        videos = scraper.get_home_videos(
            page=page,
            source=source,
            author_filter=author_filter,
            blocked_models=blocked_models,
            favorite_authors=fav_authors,
            target_count=HOME_PAGE_SIZE
        ) or []

    if videos:
        try:
            atomic_write_json(_home_feed_cache_path(page, source, author_filter), videos)
        except Exception as e:
            print(f"[Cache] Nie udało się zapisać feedu {source}/{author_filter}/{page}: {e}")
    return videos


def _refresh_home_in_background(page: int, source: str = "all", author_filter: str = "all") -> None:
    key = (page, source, author_filter)
    with _feed_refresh_lock:
        if key in _feed_refreshing:
            return
        _feed_refreshing.add(key)

    def worker():
        try:
            _fetch_and_cache_home(page, source, author_filter)
        except Exception as e:
            print(f"[Cache] Odświeżenie feedu {source}/{author_filter}/{page} nie powiodło się: {e}")
        finally:
            with _feed_refresh_lock:
                _feed_refreshing.discard(key)

    threading.Thread(target=worker, daemon=True).start()


@app.get("/api/videos")
def get_videos(
    page: int = Query(1, ge=1),
    force_refresh: bool = Query(False),
    source: str = Query("all"),
    author_filter: str = Query("all")
):
    """Stale-while-revalidate: pokazuje ostatni feed z SSD natychmiast, a odświeża go w tle. Zapewnia stałe 280 wideo bez duplikatów z uwzględnieniem filtrów."""
    if page > 250:
        page = 250

    cache_path = _home_feed_cache_path(page, source, author_filter)
    cached, mtime = read_json_cache(cache_path)
    age = cache_age_seconds(mtime)

    # Sprawdzenie kompatybilności wstecznej ze starym formatem home_{page}.json
    if not cached and source == "all" and author_filter == "all":
        legacy_path = os.path.join(FEED_CACHE_DIR, f"home_{page}.json")
        cached, mtime = read_json_cache(legacy_path)
        age = cache_age_seconds(mtime)

    if isinstance(cached, list) and len(cached) >= HOME_PAGE_SIZE and not force_refresh:
        if age > HOME_FEED_FRESH_SECONDS:
            _refresh_home_in_background(page, source, author_filter)
        raw_videos = cached
        cache_state = "fresh" if age <= HOME_FEED_FRESH_SECONDS else "stale-refreshing"
    else:
        raw_videos = _fetch_and_cache_home(page, source, author_filter)
        cache_state = "network"

    enriched = _enrich_videos(raw_videos, author_filter=author_filter)

    # Zabezpieczenie: jeśli po usunięciu zablokowanych profili liczba spadnie poniżej 280, dociągamy brakujące wideo
    if len(enriched) < HOME_PAGE_SIZE and author_filter != "only_fav":
        extra_videos = scraper.get_home_videos(
            page=page + 1,
            source=source,
            author_filter=author_filter,
            target_count=HOME_PAGE_SIZE
        )
        if extra_videos:
            from camwhores import deduplicate_videos
            combined = deduplicate_videos(raw_videos + extra_videos)
            enriched = _enrich_videos(combined, author_filter=author_filter)
            try:
                atomic_write_json(cache_path, combined[:HOME_PAGE_SIZE + 50])
            except Exception:
                pass

    final_videos = enriched[:HOME_PAGE_SIZE]

    return {
        "page": page,
        "last_page": 250,
        "count": len(final_videos),
        "target_count": HOME_PAGE_SIZE,
        "source": source,
        "author_filter": author_filter,
        "cache_state": cache_state,
        "cache_age_seconds": 0 if not math.isfinite(age) else int(age),
        "videos": final_videos
    }

@app.get("/api/model/{username}")
def get_model_videos(username: str, page: int = Query(1, ge=1)):
    """Pobiera filmy konkretnej modelki dla określonej strony."""
    videos = scraper.get_model_videos(username=username, page=page)
    return {
        "username": username,
        "page": page,
        "count": len(videos),
        "videos": _enrich_videos(videos)
    }

@app.get("/api/search/suggestions")
def search_suggestions(q: str = Query(..., min_length=1), limit: int = Query(10, ge=1, le=30)):
    """Błyskawiczne autouzupełnianie wyszukiwarki (tagi, ulubione modelki, baza profili) w RAM (<1ms)."""
    raw_q = q.strip()
    clean_q = raw_q.lower()
    is_tag_query = clean_q.startswith("#")
    term = clean_q[1:] if is_tag_query else clean_q
    if not term:
        return {"query": raw_q, "suggestions": []}

    results = []
    seen_values = set()

    # 1. Pasujące tagi
    for t in POPULAR_TAGS:
        t_tag = t.get("tag", "").lower()
        t_name = t.get("name", "")
        if t_tag.startswith(term) or term in t_tag or term in t_name.lower():
            val = f"#{t_tag}"
            if val not in seen_values:
                seen_values.add(val)
                score = 0 if t_tag.startswith(term) else 1
                results.append((score, {
                    "type": "tag",
                    "value": val,
                    "display": f"#{t_name}",
                    "category": t.get("category", "tag"),
                    "is_favorite": False
                }))

    # 2. Jeśli zapytanie nie zaczyna się jawnie od '#', szukamy też w modelkach
    if not is_tag_query:
        fav_authors = set(storage.get_favorite_authors())
        # Ulubione modelki pasujące do zapytania
        for fa in fav_authors:
            fa_norm = fa.lower()
            if fa_norm.startswith(term) or term in fa_norm:
                if fa_norm not in seen_values:
                    seen_values.add(fa_norm)
                    score = 0 if fa_norm.startswith(term) else 2
                    results.append((score, {
                        "type": "model",
                        "value": fa,
                        "display": fa,
                        "category": "favorite",
                        "is_favorite": True
                    }))

        # Pozostałe modelki z bazy model_tags
        with model_tag_manager._lock:
            db_copy = list(model_tag_manager._db.values())

        for m in db_copy:
            u = m.get("username")
            if not u:
                continue
            u_norm = u.lower()
            if storage.is_model_blocked(u):
                continue
            if u_norm not in seen_values and (u_norm.startswith(term) or term in u_norm):
                seen_values.add(u_norm)
                score = 1 if u_norm.startswith(term) else 3
                results.append((score, {
                    "type": "model",
                    "value": u,
                    "display": u,
                    "category": "model",
                    "gender": m.get("gender"),
                    "is_favorite": u_norm in fav_authors
                }))

    # Sortujemy: najpierw prefix matches, potem substring matches
    results.sort(key=lambda item: (item[0], len(item[1]["value"])))
    final_suggestions = [item[1] for item in results[:limit]]

    return {
        "query": raw_q,
        "suggestions": final_suggestions
    }

@app.get("/api/search")
def search_videos(q: str = Query(..., min_length=1), page: int = Query(1, ge=1)):
    """Wyszukuje po tagu, nazwie modelki lub słowie kluczowym z obsługą stron."""
    results = scraper.search_query(q, page=page)
    results["videos"] = _enrich_videos(results.get("videos", []))
    return results

@app.get("/api/search/stream")
def search_videos_stream(q: str = Query(..., min_length=1)):
    """Strumieniowe wyszukiwanie Server-Sent Events (SSE): przesyła profile natychmiast, a wideo po kolei."""
    def event_generator():
        for event in scraper.search_query_stream(q):
            if event.get("videos"):
                event["videos"] = _enrich_videos(event["videos"])
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

DETAILS_CACHE_FRESH_SECONDS = 30 * 60
DETAILS_CACHE_STALE_SECONDS = 24 * 60 * 60
_details_refresh_lock = threading.Lock()
_details_refreshing = set()
_details_fetch_guard = threading.Lock()
_details_fetch_locks = OrderedDict()
_MAX_FETCH_LOCKS = 300

def _details_fetch_lock(video_id: str):
    key = safe_cache_key(video_id)
    with _details_fetch_guard:
        lock = _details_fetch_locks.get(key)
        if lock is None:
            if len(_details_fetch_locks) >= _MAX_FETCH_LOCKS:
                _details_fetch_locks.popitem(last=False)
            lock = threading.Lock()
            _details_fetch_locks[key] = lock
        else:
            _details_fetch_locks.move_to_end(key)
        return lock


def _details_cache_path(video_id: str) -> str:
    return os.path.join(DETAILS_CACHE_DIR, f"{safe_cache_key(video_id)}.json")


def _normalize_video_details(video_id: str, details: dict) -> dict:
    details = dict(details or {})
    if not details.get("preview_video") and details.get("thumbnail"):
        thumb = details["thumbnail"]
        details["preview_video"] = thumb.replace(".jpg", ".mp4") if ".jpg" in thumb else thumb
    vid_key = details.get("id") or video_id
    # Proxy po ID pozostaje stabilny nawet gdy zewnętrzny direct_url wygaśnie.
    details["proxy_stream_url"] = f"/api/video/stream?id={vid_key}" if vid_key else ""
    details["is_favorite"] = storage.is_favorite(video_id)
    return details


def _fetch_and_cache_details(video_id: str) -> dict:
    details = scraper.get_video_details(video_id) or {}
    if details:
        try:
            atomic_write_json(_details_cache_path(video_id), details)
        except Exception as e:
            print(f"[Cache] Nie udało się zapisać detali {video_id}: {e}")
    return details


def _fetch_details_singleflight(video_id: str) -> dict:
    """Jedno pobranie strony detali na video ID, nawet gdy player i storyboard startują równocześnie."""
    lock = _details_fetch_lock(video_id)
    with lock:
        cached, mtime = read_json_cache(_details_cache_path(video_id))
        if isinstance(cached, dict) and cached.get("direct_url") and cache_age_seconds(mtime) <= DETAILS_CACHE_STALE_SECONDS:
            return cached
        return _fetch_and_cache_details(video_id)


def _refresh_details_in_background(video_id: str) -> None:
    with _details_refresh_lock:
        if video_id in _details_refreshing:
            return
        _details_refreshing.add(video_id)
    def worker():
        try:
            # Wymuszenie świeżych detali przez usunięcie wyłącznie cache RAM scrapera.
            clean_id = str(video_id).split("/")[-1].split("?")[0]
            if hasattr(scraper, "_details_cache"):
                scraper._details_cache.pop(clean_id, None)
            _fetch_and_cache_details(video_id)
        except Exception as e:
            print(f"[Cache] Odświeżenie detali {video_id} nie powiodło się: {e}")
        finally:
            with _details_refresh_lock:
                _details_refreshing.discard(video_id)
    threading.Thread(target=worker, daemon=True).start()


@app.get("/api/video/details")
def get_video_details(id: str = Query(...), force_refresh: bool = Query(False)):
    """Detale z persistent cache; stary wpis jest zwracany natychmiast i odświeżany w tle."""
    clean_id = id.split("/")[-1].split("?")[0]
    cached, mtime = read_json_cache(_details_cache_path(clean_id))
    age = cache_age_seconds(mtime)

    if isinstance(cached, dict) and cached and not force_refresh and age <= DETAILS_CACHE_STALE_SECONDS:
        details = cached
        if age > DETAILS_CACHE_FRESH_SECONDS:
            _refresh_details_in_background(clean_id)
    elif force_refresh:
        details = _fetch_and_cache_details(clean_id)
    else:
        details = _fetch_details_singleflight(clean_id)

    return _normalize_video_details(clean_id, details)

# Dedykowana sesja z pulą bezpiecznych połączeń streamingu (ochrona na poziomie gniazda TCP)
stream_session = requests.Session()
_stream_adapter = SafeHTTPAdapter(pool_connections=64, pool_maxsize=64, max_retries=Retry(total=2, backoff_factor=0.1))
stream_session.mount("http://", _stream_adapter)
stream_session.mount("https://", _stream_adapter)

@app.get("/api/video/stream")
def stream_video_proxy(url: str = Query(None), id: str = Query(None), embed: str = Query(None), request: Request = None):
    """Proxy strumienia wideo z autoryzacją sesji MixDrop/Camwhores, poprawnym Referer i auto-odświeżaniem na 403."""
    clean_id = id.split("/")[-1].split("?")[0] if id else None
    embed_url = embed

    if not url and clean_id:
        # Najpierw sprawdzamy persistent/memory cache lub pojedyncze pobranie single-flight
        details = _fetch_details_singleflight(clean_id)
        if isinstance(details, dict):
            url = details.get("direct_url")
            embed_url = embed_url or details.get("embed_url")

    if not embed_url and clean_id and hasattr(scraper, "_details_cache") and clean_id in scraper._details_cache:
        embed_url = scraper._details_cache[clean_id]["data"].get("embed_url")

    if not url:
        raise HTTPException(status_code=400, detail="Brak URL lub ID wideo do odtworzenia")
    if not is_safe_remote_url(url) and not (url.startswith("http://127.0.0.1:") or url.startswith("http://localhost:")):
        raise HTTPException(status_code=400, detail="Niedozwolony adres strumienia")

    referer = embed_url or "https://mixdrop.ag/"
    if "camwhores" in url:
        referer = "https://www.camwhores.tv/"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": referer
    }
    
    range_header = request.headers.get("range") if request else None
    if range_header:
        headers["Range"] = range_header

    # Używamy dedykowanej sesji streamingu z własną dużą pulą gniazd (izolacja od scrapera)
    active_session = stream_session
    if hasattr(scraper, "session") and hasattr(scraper.session, "session") and scraper.session.session.cookies:
        try:
            active_session.cookies.update(scraper.session.session.cookies)
        except Exception:
            pass

    try:
        req = _validated_session_get(active_session, url, headers=headers, stream=True, timeout=12)

        # Jeśli URL wygasł (403), natychmiast wyczyść cache, pobierz świeży direct_url i ponów próbę
        if req.status_code == 403 and clean_id:
            if hasattr(scraper, "_details_cache") and clean_id in scraper._details_cache:
                del scraper._details_cache[clean_id]
            try:
                os.remove(_details_cache_path(clean_id))
            except OSError:
                pass
            fresh_details = scraper.get_video_details(clean_id)
            if fresh_details:
                try:
                    atomic_write_json(_details_cache_path(clean_id), fresh_details)
                except Exception:
                    pass
            url = fresh_details.get("direct_url")
            embed_url = fresh_details.get("embed_url") or embed_url
            if url and is_safe_remote_url(url):
                headers["Referer"] = embed_url or "https://mixdrop.ag/"
                req.close()
                req = _validated_session_get(active_session, url, headers=headers, stream=True, timeout=12)

        if req.status_code not in (200, 206):
            code = req.status_code
            req.close()
            raise HTTPException(status_code=502, detail=f"Zdalny serwer wideo zwrócił HTTP {code}")

        response_headers = {
            "Content-Type": req.headers.get("Content-Type", "video/mp4"),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-store"
        }
        if "Content-Range" in req.headers:
            response_headers["Content-Range"] = req.headers["Content-Range"]
        if "Content-Length" in req.headers:
            response_headers["Content-Length"] = req.headers["Content-Length"]
        if "ETag" in req.headers:
            response_headers["ETag"] = req.headers["ETag"]
        if "Last-Modified" in req.headers:
            response_headers["Last-Modified"] = req.headers["Last-Modified"]

        def iterfile():
            try:
                for chunk in req.iter_content(chunk_size=1024 * 64):
                    if chunk:
                        yield chunk
            except Exception as e:
                # Nie połykamy wyjątku milcząco; logujemy bez ujawniania tokenów i re-raise,
                # aby serwer ASGI zerwał połączenie TCP informując klienta o ucięciu strumienia.
                import logging
                logging.getLogger("proxy_stream").warning(f"Przerwano strumień wideo {clean_id}: {type(e).__name__}")
                raise
            finally:
                req.close()

        return StreamingResponse(
            iterfile(),
            status_code=req.status_code,
            headers=response_headers
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Błąd strumieniowania wideo: {e}")


@app.get("/api/storyboard")
def storyboard_status_or_start(
    id: str = Query(..., min_length=1),
    duration: float = Query(..., gt=0, le=43200),
    force: bool = Query(False),
    request: Request = None,
):
    """YouTube-style storyboard: generuje jeden sprite JPG z klatkami filmu i cache'uje go na SSD."""
    clean_id = str(id).split("/")[-1].split("?")[0]
    # Rozwiąż direct_url RAZ przed uruchomieniem wielu seeków FFmpeg. W starej wersji
    # każdy równoległy proces potrafił wejść przez /stream?id=... i równocześnie
    # scrapować tę samą stronę detali, co dramatycznie spowalniało pierwszy storyboard.
    base = str(request.base_url if request else "http://127.0.0.1:8000/").rstrip("/")
    details = _fetch_details_singleflight(clean_id)
    direct = (details or {}).get("direct_url") or ""
    embed = (details or {}).get("embed_url") or ""
    if direct:
        source_url = (
            f"{base}/api/video/stream?id={requests.utils.quote(clean_id)}"
            f"&url={requests.utils.quote(direct, safe='')}"
            f"&embed={requests.utils.quote(embed, safe='')}"
        )
    else:
        source_url = f"{base}/api/video/stream?id={requests.utils.quote(clean_id)}"
    result = start_storyboard(clean_id, duration, source_url, force=force)
    if result.get("status") == "ready":
        result["sprite_url"] = f"/api/storyboard/image?id={requests.utils.quote(clean_id)}&q={result.get('quality', 'quick')}&v={result.get('created_at', 0)}"
    return result


@app.get("/api/storyboard/image")
def storyboard_image(id: str = Query(..., min_length=1), q: str = Query("best")):
    clean_id = str(id).split("/")[-1].split("?")[0]
    quality = q if q in ("quick", "full") else "best"
    path = get_storyboard_sprite_path(clean_id, quality)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Storyboard nie jest jeszcze gotowy")
    return FileResponse(
        str(path),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )

@app.post("/api/scan/start")
def start_quick_scan():
    """Uruchamia szybki skan profili w tle."""
    import threading
    from fast_scan import run_full_quick_scan
    threading.Thread(target=run_full_quick_scan, daemon=True).start()
    return {"status": "started", "message": "Skanowanie profili uruchomione w tle."}

@app.get("/api/scan/status")
def get_scan_status():
    """Zwraca aktualną liczbę zaindeksowanych profili."""
    count = len(model_tag_manager._db)
    return {"status": "ok", "indexed_models_count": count}

# ============================================================
# ZARZĄDZANIE CZARNĄ LISTĄ PROFILI (BLOKOWANIE / USUWANIE)
# ============================================================
def estimate_model_total_videos(username: str) -> int:
    """Zwraca rzeczywistą łączną liczbę filmów modelki z Archivebate i Camwhores (szybko i równolegle)."""
    clean_u = re.sub(r'[^a-z0-9_-]', '', username.strip().lower())
    if not clean_u:
        return 1

    def check_cw():
        try:
            cw_url = f"https://www.camwhores.tv/search/{clean_u}/"
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            r_cw = requests.get(cw_url, headers=headers, timeout=2.5)
            if r_cw.status_code == 200:
                last_m = re.findall(r'from_videos\+from_albums:(\d+)', r_cw.text)
                if last_m:
                    cw_pages = max([int(x) for x in last_m])
                    return (cw_pages - 1) * 20 + 10
                items = re.findall(r'class="item\s', r_cw.text)
                return len(items)
        except Exception:
            pass
        return 0

    def check_ab():
        try:
            url = f"https://archivebate.com/profile/{clean_u}"
            r_ab = session.session.get(url, timeout=2.5)
            if r_ab.status_code == 200:
                html = r_ab.text
                scraper._sync_csrf(html, url)
                for m in re.finditer(r'wire:id="([^"]+)" wire:initial-data="([^"]+)"', html):
                    raw_data = m.group(2).replace('&quot;', '"')
                    data = json.loads(raw_data)
                    name = data.get('fingerprint', {}).get('name', '')
                    if 'model-videos' in name:
                        rendered = session.call_livewire(name, data['fingerprint'], data['serverMemo'], "load_profile_videos")
                        if rendered:
                            secs = re.findall(r'<section class="video_item">', rendered)
                            pages = re.findall(r'page=(\d+)', rendered)
                            if pages:
                                max_p = max([int(x) for x in pages])
                                return (max_p - 1) * 20 + len(secs)
                            return len(secs)
                        break
        except Exception:
            pass
        return 0

    with ThreadPoolExecutor(max_workers=2) as executor:
        f_cw = executor.submit(check_cw)
        f_ab = executor.submit(check_ab)
        try:
            total = f_cw.result(timeout=3.0) + f_ab.result(timeout=3.0)
        except Exception:
            total = 0

    return max(total, 1)

@app.post("/api/model/{username}/block")
def block_model_endpoint(username: str, count: Optional[int] = Query(None)):
    """Blokuje profil modelki, zlicza usunięte filmy i trwale usuwa ją z bazy, aktualizacji i wyszukiwarki."""
    try:
        estimated = estimate_model_total_videos(username)
    except Exception:
        estimated = count if (count and count > 0) else 1

    final_count = max(estimated, count or 1)
    result = storage.block_model(username, video_count=final_count)
    if hasattr(scraper, "_home_cache"):
        scraper._home_cache.clear()
    stats = storage.get_blocked_stats()

    return {
        "success": result["success"],
        "username": username,
        "removed_videos": result["removed_videos"],
        **stats
    }

@app.post("/api/model/{username}/unblock")
def unblock_model_endpoint(username: str):
    """Odblokowuje wcześniej zablokowany profil modelki."""
    success = storage.unblock_model(username)
    if hasattr(scraper, "_home_cache"):
        scraper._home_cache.clear()
    stats = storage.get_blocked_stats()
    return {
        "success": success,
        "username": username,
        **stats
    }

@app.get("/api/blocked_models")
def get_blocked_models_endpoint():
    """Zwraca listę wszystkich zablokowanych profili wraz ze statystykami i liczbą filmów."""
    stats = storage.get_blocked_stats()
    return {
        "blocked_models": storage.get_blocked_models(),
        "blocked_model_video_counts": storage.data.get("blocked_model_video_counts", {}),
        **stats
    }

@app.get("/api/stats")
def get_system_stats():
    """Zwraca kompleksowe statystyki wideo i profili dla strony głównej."""
    total_models = len(model_tag_manager._db)

    genders = {"Female": 0, "Trans": 0, "Couple": 0, "Male": 0}
    for m_info in model_tag_manager._db.values():
        g = m_info.get("gender")
        if g in genders:
            genders[g] += 1
        elif "Trans" in m_info.get("tags", []):
            genders["Trans"] += 1

    blocked_stats = storage.get_blocked_stats()
    fav_count = len(storage.get_favorites())
    hist_count = len(storage.data.get("history", []))
    foll_count = len(storage.data.get("following", []))

    return {
        "status": "ok",
        "total_models": total_models,
        "models_gender": genders,
        "blocked_authors_count": blocked_stats["blocked_authors_count"],
        "blocked_videos_total": blocked_stats["blocked_videos_total"],
        "archivebate_pages": 1000,
        "estimated_archivebate_videos": 36000,
        "favorites_count": fav_count,
        "history_count": hist_count,
        "following_count": foll_count
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
