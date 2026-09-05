import requests
import re
import html
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger("camwhores")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(levelname)s] %(name)s: %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.camwhores.tv/"
}
import functools
from requests.adapters import HTTPAdapter
from cache_store import BoundedTTLCache

class CamwhoresScraper:
    def __init__(self):
        self.session = requests.Session()
        adapter = HTTPAdapter(pool_connections=100, pool_maxsize=100)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)
        self.session.headers.update(DEFAULT_HEADERS)
        self._cache = BoundedTTLCache(max_items=300, default_ttl=180.0)
        self._details_cache = BoundedTTLCache(max_items=500, default_ttl=1800.0)
        self._url_cache = BoundedTTLCache(max_items=1000, default_ttl=3600.0)

    def _clean_title(self, raw_title: str) -> str:
        """Czyści encje HTML i zbędne znaki z tytułu."""
        if not raw_title:
            return ""
        decoded = html.unescape(raw_title)
        decoded = re.sub(r'&#\d+;', '', decoded)
        decoded = re.sub(r'[\U00010000-\U0010ffff]', '', decoded)
        return re.sub(r'\s+', ' ', decoded).strip()

    def _extract_username(self, title: str, slug: str) -> str:
        """Wyodrębnia nazwę modelki z tytułu lub adresu URL."""
        if title:
            # Często tytuł to "ModelName - Opis" lub "ModelName Stripchat ..."
            if " - " in title:
                candidate = title.split(" - ")[0].strip()
                if candidate and len(candidate.split()) <= 2:
                    return candidate
            m = re.match(r'^([a-zA-Z0-9_\-]+)\s+(?:chaturbate|stripchat|onlyfans|camsoda|myfreecams|bongacams|streamate|flirt4free)', title, re.IGNORECASE)
            if m:
                return m.group(1)
            # Jeśli pierwszy wyraz tytułu wygląda jak nazwa modelki (np. "melodyxlove 9")
            words = title.split()
            if words:
                first_w = words[0].strip('-_.,')
                if re.match(r'^[a-zA-Z0-9_]{3,25}$', first_w) and first_w.lower() not in ["the", "hot", "cum", "cam", "sex", "live", "show", "video", "best", "new", "real"]:
                    return first_w
        if slug:
            parts = slug.split('-')
            if parts and re.match(r'^[a-zA-Z0-9_]{3,25}$', parts[0]):
                return parts[0]
        return "Model"

    def parse_video_card(self, item_html: str) -> Optional[Dict[str, Any]]:
        """Parsuje pojedynczy kafelek z HTML Camwhores.tv."""
        try:
            # Odrzucamy filmy prywatne (niedostępne dla zwykłych użytkowników)
            if 'class="item private' in item_html or 'ico-private' in item_html or 'line-private' in item_html or 'private ' in item_html:
                return None

            # URL i ID
            url_m = re.search(r'href=["\'](https://www\.camwhores\.tv/videos/(\d+)/([^"\']*)/?)["\']', item_html)
            if not url_m:
                return None
            watch_url = url_m.group(1)
            raw_id = url_m.group(2)
            slug = url_m.group(3)
            video_id = f"cw_{raw_id}"
            self._url_cache[video_id] = watch_url
            self._url_cache[raw_id] = watch_url

            # Tytuł
            title_m = re.search(r'title=["\']([^"\']+)["\']', item_html)
            raw_title = title_m.group(1) if title_m else ""
            title = self._clean_title(raw_title)

            # Miniatura
            thumb_m = re.search(r'data-original=["\']([^"\']+)["\']', item_html) or re.search(r'src=["\']([^"\']+)["\']', item_html)
            thumbnail = thumb_m.group(1) if thumb_m else ""
            if "data:image" in thumbnail:
                # fallback na inną miniaturę
                data_orig_m = re.search(r'data-original=["\'](https://[^"\']+)["\']', item_html)
                thumbnail = data_orig_m.group(1) if data_orig_m else ""

            # Modelka
            username = self._extract_username(title, slug)

            # Czas trwania
            dur_m = re.search(r'<div class="duration">([^<]+)</div>', item_html)
            duration = dur_m.group(1).strip() if dur_m else "N/A"

            # Wyświetlenia
            views_m = re.search(r'<div class="views">([^<]+)</div>', item_html)
            views = views_m.group(1).strip() if views_m else ""

            # Data
            date_m = re.search(r'<div class="added">\s*<em>([^<]+)</em>', item_html)
            date = date_m.group(1).strip() if date_m else "Niedawno"

            # Wykrywanie platformy
            platform = "Camwhores.tv"
            title_lower = (title + " " + slug).lower()
            for p in ["Chaturbate", "Stripchat", "Onlyfans", "Camsoda", "Myfreecams", "Bongacams", "Streamate", "TikTok"]:
                if p.lower() in title_lower:
                    platform = p
                    break

            # Wykrywanie timeline klatek zrzutów ekranu
            cnt_m = re.search(r'data-cnt=["\'](\d+)["\']', item_html)
            timeline_count = int(cnt_m.group(1)) if cnt_m else 15

            timeline_prefix = ""
            if thumbnail and "/" in thumbnail:
                timeline_prefix = thumbnail[:thumbnail.rfind('/') + 1]

            preview_video = ""

            card_dict = {
                "id": video_id,
                "raw_id": raw_id,
                "url": watch_url,
                "thumbnail": thumbnail,
                "poster": thumbnail,
                "preview_video": preview_video,
                "timeline_prefix": timeline_prefix,
                "timeline_count": timeline_count,
                "duration": duration,
                "username": username,
                "title": title,
                "profile_url": f"https://www.camwhores.tv/search/{username}/",
                "date": date,
                "views": views,
                "platform": platform,
                "source": "camwhores"
            }
            try:
                from scraper import extract_video_tags
                card_dict["tags"] = extract_video_tags(card_dict)
            except Exception:
                card_dict["tags"] = ["Female"]
            if "Camwhores" not in card_dict["tags"]:
                card_dict["tags"].append("Camwhores")
            return card_dict
        except Exception as e:
            logger.debug(f"Błąd parsowania kafelka Camwhores: {e}")
            return None

    def get_latest_videos(self, page: int = 1) -> List[Dict[str, Any]]:
        """Pobiera najnowsze filmy ze strony głównej Camwhores.tv (z automatycznym fallbackiem na mirror)."""
        cache_key = f"latest:{page}"
        if cache_key in self._cache:
            entry = self._cache[cache_key]
            import time
            if time.time() - entry["time"] < 180 and entry.get("data"):
                return entry["data"]

        urls_to_try = [
            f"https://www.camwhores.tv/latest-updates/{page}/" if page > 1 else "https://www.camwhores.tv/",
            f"https://www.camwhores.co/latest-updates/{page}/" if page > 1 else "https://www.camwhores.co/",
        ]

        for url in urls_to_try:
            try:
                r = self.session.get(url, timeout=10)
                if r.status_code != 200:
                    continue
                
                raw_items = re.findall(r'(<div class="item\s*[^"]*">.*?)(?=<div class="item\s*[^"]*"|class="pagination"|$)', r.text, re.DOTALL)
                videos = []
                seen_ids = set()
                for it in raw_items:
                    v = self.parse_video_card(it)
                    if v and v["id"] not in seen_ids:
                        seen_ids.add(v["id"])
                        videos.append(v)

                if videos:
                    import time
                    self._cache[cache_key] = {"data": videos, "time": time.time()}
                    return videos
            except Exception as e:
                logger.debug(f"Błąd pobierania wideo z {url}: {e}")
                continue

        return []

    def search_videos(self, query: str, page: int = 1) -> List[Dict[str, Any]]:
        """Wyszukuje filmy w Camwhores.tv dla danego tagu lub nazwy modelki (z fallbackiem)."""
        clean_q = query.replace("#", "").strip()
        if not clean_q:
            return []

        cache_key = f"search:{clean_q.lower()}:{page}"
        if cache_key in self._cache:
            entry = self._cache[cache_key]
            import time
            if time.time() - entry["time"] < 180 and entry.get("data"):
                return entry["data"]

        clean_slug = re.sub(r'[^a-zA-Z0-9_-]', '-', clean_q.lower())
        is_tag_search = query.startswith("#")
        if is_tag_search:
            urls_to_try = [
                f"https://www.camwhores.tv/tags/{clean_slug}/{page}/" if page > 1 else f"https://www.camwhores.tv/tags/{clean_slug}/",
                f"https://www.camwhores.tv/search/{clean_q}/{page}/" if page > 1 else f"https://www.camwhores.tv/search/{clean_q}/",
                f"https://www.camwhores.co/tags/{clean_slug}/{page}/" if page > 1 else f"https://www.camwhores.co/tags/{clean_slug}/",
                f"https://www.camwhores.co/search/{clean_q}/{page}/" if page > 1 else f"https://www.camwhores.co/search/{clean_q}/",
            ]
        else:
            urls_to_try = [
                f"https://www.camwhores.tv/search/{clean_q}/{page}/" if page > 1 else f"https://www.camwhores.tv/search/{clean_q}/",
                f"https://www.camwhores.tv/tags/{clean_slug}/{page}/" if page > 1 else f"https://www.camwhores.tv/tags/{clean_slug}/",
                f"https://www.camwhores.co/search/{clean_q}/{page}/" if page > 1 else f"https://www.camwhores.co/search/{clean_q}/",
                f"https://www.camwhores.co/tags/{clean_slug}/{page}/" if page > 1 else f"https://www.camwhores.co/tags/{clean_slug}/",
            ]

        for url in urls_to_try:
            try:
                r = self.session.get(url, timeout=10)
                if r.status_code != 200:
                    continue
                
                raw_items = re.findall(r'(<div class="item\s*[^"]*">.*?)(?=<div class="item\s*[^"]*"|class="pagination"|$)', r.text, re.DOTALL)
                videos = []
                seen_ids = set()
                for it in raw_items:
                    v = self.parse_video_card(it)
                    if v and v["id"] not in seen_ids:
                        seen_ids.add(v["id"])
                        videos.append(v)

                if videos:
                    import time
                    self._cache[cache_key] = {"data": videos, "time": time.time()}
                    return videos
            except Exception as e:
                logger.debug(f"Błąd wyszukiwania w Camwhores ({url}): {e}")
                continue

        return []

    def get_video_details(self, video_id_or_url: str) -> Dict[str, Any]:
        """Wyciąga bezpośredni strumień MP4 ze strony wideo na Camwhores.tv."""
        if str(video_id_or_url).startswith("http"):
            watch_url = video_id_or_url
            raw_id_m = re.search(r'/videos/(\d+)/', watch_url)
            raw_id = raw_id_m.group(1) if raw_id_m else "0"
        else:
            raw_id = str(video_id_or_url).replace("cw_", "").strip()
            watch_url = self._url_cache.get(raw_id) or self._url_cache.get(f"cw_{raw_id}")

        if not watch_url:
            watch_url = f"https://www.camwhores.tv/videos/{raw_id}/video/"
        elif watch_url.endswith(f"/{raw_id}/") or watch_url.endswith(f"/{raw_id}"):
            watch_url = watch_url.rstrip("/") + "/video/"

        if raw_id in self._details_cache:
            import time
            entry = self._details_cache[raw_id]
            if time.time() - entry["time"] < 1800 and entry["data"].get("direct_url"):
                return entry["data"]

        urls_to_try = [
            watch_url,
            watch_url.replace("www.camwhores.tv", "www.camwhores.co"),
            f"https://www.camwhores.tv/videos/{raw_id}/video/",
            f"https://www.camwhores.co/videos/{raw_id}/video/"
        ]

        seen_urls = []
        for u in urls_to_try:
            if u not in seen_urls:
                seen_urls.append(u)

        r = None
        for u in seen_urls:
            try:
                resp = self.session.get(u, timeout=10)
                if resp.status_code == 200 and ("video_url" in resp.text or "get_file" in resp.text):
                    r = resp
                    watch_url = u
                    break
            except Exception:
                continue

        if not r or r.status_code != 200:
            # Sprawdź czy to film oznaczony jako prywatny na Camwhores
            try:
                check_resp = self.session.get(watch_url, timeout=6)
                if check_resp.status_code == 200 and ("private video" in check_resp.text.lower() or "login-required" in check_resp.text.lower() or "no-player" in check_resp.text.lower()):
                    return {
                        "id": f"cw_{raw_id}",
                        "url": watch_url,
                        "direct_url": "",
                        "embed_url": watch_url,
                        "source": "camwhores",
                        "is_private": True,
                        "error_message": "Ten film jest prywatny na Camwhores (dostępny wyłącznie dla zarejestrowanych członków)."
                    }
            except Exception:
                pass
            return {"id": f"cw_{raw_id}", "url": watch_url, "direct_url": "", "embed_url": watch_url, "source": "camwhores"}

        try:
            # Bezpośredni URL MP4
            video_url_m = re.search(r'video_url:\s*[\'"]([^\'"]+)[\'"]', r.text)
            direct_url = video_url_m.group(1) if video_url_m else ""

            if not direct_url:
                gf_m = re.search(r'(https?://(?:www\.)?camwhores\.(?:tv|co)/get_file/[^\s"\'<>]+\.mp4[^\s"\'<>]*)', r.text)
                if gf_m:
                    direct_url = gf_m.group(1)

            # Plakat / Miniatura
            poster_m = re.search(r'preview_url:\s*[\'"]([^\'"]+)[\'"]', r.text) or re.search(r'property="og:image"\s+content="([^"]+)"', r.text)
            poster = poster_m.group(1) if poster_m else ""

            # Tytuł
            title_m = re.search(r'property="og:title"\s+content="([^"]+)"', r.text) or re.search(r'<title>([^<]+)</title>', r.text)
            title = self._clean_title(title_m.group(1)) if title_m else ""

            # Słowa kluczowe / tagi ze strony Camwhores
            kw_m = re.search(r'name="keywords"\s+content="([^"]+)"', r.text)
            keywords = [k.strip() for k in kw_m.group(1).split(",")] if kw_m else []

            # Dokładne tagi z linków /tags/ i /categories/
            cw_tags = set()
            for t_m in re.finditer(r'href=["\']https://(?:www\.)?camwhores\.(?:tv|co)/(?:tags|categories)/([^/"]+)/["\']', r.text):
                ct_clean = t_m.group(1).strip().lower()
                if ct_clean in ["trans", "transgender", "tranny", "transsexual", "ts", "shemale", "she-male", "ladyboy"]:
                    cw_tags.add("Trans")
                elif ct_clean in ["milf", "teen", "anal", "squirt", "ebony", "latina", "asian", "bbw", "couple", "feet", "dildo", "cosplay"]:
                    cw_tags.add(ct_clean.capitalize())

            model_username = self._extract_username(title, "")
            if model_username and cw_tags:
                try:
                    from model_tags import model_tag_manager
                    gender_val = "Trans" if "Trans" in cw_tags else None
                    model_tag_manager.set_model(model_username, gender=gender_val, tags=list(cw_tags))
                except Exception:
                    pass

            result = {
                "id": f"cw_{raw_id}",
                "url": watch_url,
                "embed_url": watch_url,
                "direct_url": direct_url,
                "thumbnail": poster,
                "poster": poster,
                "title": title,
                "username": model_username,
                "keywords": keywords,
                "tags": list(cw_tags),
                "source": "camwhores",
                "platform": "Camwhores.tv"
            }

            if direct_url:
                import time
                self._details_cache[raw_id] = {"data": result, "time": time.time()}
            return result
        except Exception as e:
            logger.error(f"Błąd pobierania detali Camwhores ({watch_url}): {e}")
            return {"id": f"cw_{raw_id}", "url": watch_url, "direct_url": "", "embed_url": watch_url, "source": "camwhores"}

# ============================================================
# INTELIGENTNA DEDUPLIKACJA (ANTI-DUPLICATE)
# ============================================================
@functools.lru_cache(maxsize=2048)
def normalize_model_name(username: str) -> str:
    """Normalizuje nazwę modelki do małych liter i cyfr (usuwa spacje, podkreślniki itp.)."""
    if not username:
        return ""
    return re.sub(r'[^a-z0-9]', '', str(username).lower())

@functools.lru_cache(maxsize=4096)
def extract_date_signature(text: str) -> Optional[str]:
    """Wyciąga datę kalendarzową (np. 2026-08-21 lub 21.08.2026)."""
    if not text:
        return None
    # YYYY-MM-DD lub YYYY_MM_DD
    m1 = re.search(r'(\d{4})[-_](\d{2})[-_](\d{2})', text)
    if m1:
        return f"{m1.group(1)}-{m1.group(2)}-{m1.group(3)}"
    # DD.MM.YYYY
    m2 = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', text)
    if m2:
        return f"{m2.group(3)}-{m2.group(2)}-{m2.group(1)}"
    return None

def is_duplicate(video_a: Dict[str, Any], video_b: Dict[str, Any]) -> bool:
    """Zwraca True, jeśli oba obiekty wideo reprezentują to samo nagranie."""
    # 1. To samo ID
    if video_a.get("id") and video_b.get("id") and str(video_a["id"]).strip().lower() == str(video_b["id"]).strip().lower():
        return True

    # 2. Ta sama modelka
    mod_a = normalize_model_name(video_a.get("username", ""))
    mod_b = normalize_model_name(video_b.get("username", ""))
    if not mod_a or not mod_b or mod_a != mod_b:
        return False

    # 3. Jeśli ta sama modelka, sprawdzamy sygnaturę daty
    full_text_a = f"{video_a.get('date', '')} {video_a.get('url', '')} {video_a.get('title', '')}"
    full_text_b = f"{video_b.get('date', '')} {video_b.get('url', '')} {video_b.get('title', '')}"
    
    date_a = extract_date_signature(full_text_a)
    date_b = extract_date_signature(full_text_b)
    if date_a and date_b and date_a == date_b:
        return True

    # 4. Jeśli ten sam czas trwania (np. 18:42 vs 18:42) dla tej samej modelki
    dur_a = str(video_a.get("duration", "")).strip()
    dur_b = str(video_b.get("duration", "")).strip()
    if dur_a and dur_b and dur_a not in ("N/A", "00:00", "0:00") and dur_a == dur_b:
        return True

    return False

def deduplicate_videos(videos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Całkowicie eliminuje wszelkie duplikaty filmów w jednym przebiegu O(N) na podstawie ID, URL, sygnatury (model + czas trwania) oraz daty."""
    if not videos:
        return []
    result = []
    seen_ids = set()
    seen_urls = set()
    seen_user_dur = set()
    seen_user_date = set()

    for v in videos:
        if not isinstance(v, dict):
            continue

        # 1. Unikalne ID wideo
        vid_id = str(v.get("id") or "").strip().lower()
        if vid_id and vid_id in seen_ids:
            continue

        # 2. Unikalny URL wideo
        v_url = str(v.get("url") or "").strip().lower()
        if v_url and v_url in seen_urls:
            continue

        # 3. Model + czas trwania
        m = normalize_model_name(v.get("username", ""))
        dur = str(v.get("duration") or "").strip()
        dur_sig = None
        if m and m not in ("model", "unknown") and dur and dur not in ("N/A", "00:00", "0:00"):
            dur_sig = (m, dur)
            if dur_sig in seen_user_dur:
                continue

        # 4. Model + data nagrania
        date_sig = None
        if m and m not in ("model", "unknown"):
            d = extract_date_signature(f"{v.get('date', '')} {v.get('url', '')} {v.get('title', '')}")
            if d:
                date_sig = (m, d)
                if date_sig in seen_user_date:
                    continue

        result.append(v)
        if vid_id:
            seen_ids.add(vid_id)
        if v_url:
            seen_urls.add(v_url)
        if dur_sig:
            seen_user_dur.add(dur_sig)
        if date_sig:
            seen_user_date.add(date_sig)

    return result

def merge_and_deduplicate(primary_videos: List[Dict[str, Any]], secondary_videos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Łączy wideo z Archivebate (primary) oraz Camwhores.tv (secondary), bez dublowania filmów."""
    combined = (primary_videos or []) + (secondary_videos or [])
    return deduplicate_videos(combined)

camwhores_scraper = CamwhoresScraper()
