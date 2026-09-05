import os
import re
import json
import time
import math
import logging
import functools
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import List, Dict, Any, Optional
from client import ArchivebateSession
from storage import storage
from cache_store import BoundedTTLCache

logger = logging.getLogger("archivebate_scraper")

# Lista przykładowych, popularnych tagów z serwisu Archivebate / kamerkowych
POPULAR_TAGS = [
    {"name": "Trans", "tag": "trans", "category": "gender"},
    {"name": "Female", "tag": "female", "category": "gender"},
    {"name": "Couple", "tag": "couple", "category": "gender"},
    {"name": "Group", "tag": "group", "category": "gender"},
    {"name": "Teen (18+)", "tag": "teen", "category": "category"},
    {"name": "Lovense", "tag": "lovense", "category": "toy"},
    {"name": "Blonde", "tag": "blonde", "category": "appearance"},
    {"name": "Brunette", "tag": "brunette", "category": "appearance"},
    {"name": "Redhead", "tag": "redhead", "category": "appearance"},
    {"name": "Ebony", "tag": "ebony", "category": "appearance"},
    {"name": "Asian", "tag": "asian", "category": "appearance"},
    {"name": "Latina", "tag": "latina", "category": "appearance"},
    {"name": "MILF", "tag": "milf", "category": "category"},
    {"name": "Big Boobs", "tag": "bigboobs", "category": "appearance"},
    {"name": "Squirt", "tag": "squirt", "category": "action"},
    {"name": "Anal", "tag": "anal", "category": "action"},
    {"name": "Dildo", "tag": "dildo", "category": "toy"},
    {"name": "Polish", "tag": "polish", "category": "region"},
    {"name": "Melody", "tag": "melody", "category": "model"},
    {"name": "Chaturbate", "tag": "chaturbate", "category": "platform"},
    {"name": "Stripchat", "tag": "stripchat", "category": "platform"},
    {"name": "Camsoda", "tag": "camsoda", "category": "platform"}
]

def unpack_mixdrop(html: str) -> Optional[str]:
    """Wypakowuje bezpośredni link do strumienia MP4 ze skryptu Mixdrop."""
    try:
        match = re.search(r"eval\(function\(p,a,c,k,e,d\)\{.*?return p\}\('(.*?)',(\d+),(\d+),'([^']+)'\.split\('\|'\)", html, re.DOTALL)
        if not match:
            return None
        p, a, c, k = match.groups()
        c = int(c)
        k = k.split('|')
        
        for i in range(c - 1, -1, -1):
            token = k[i] if i < len(k) and k[i] else str(i)
            if token:
                p = re.sub(r'\b' + str(i) + r'\b', token, p)
                
        wurl_m = re.search(r'wurl\s*=\s*"([^"]+)"', p) or re.search(r'wurl="([^"]+)"', p)
        if wurl_m:
            wurl = wurl_m.group(1)
            if wurl.startswith("//"):
                wurl = "https:" + wurl
            return wurl
    except Exception as e:
        logger.error(f"Błąd wypakowywania Mixdrop: {e}")
    return None

# ============================================================
# DOKŁADNE REGUŁY KLASYFIKACJI TAGÓW DLA KAŻDEGO WIDEO
# ============================================================
KNOWN_TAG_RULES = [
    ("trans", ["trans", "shemale", "femboy", "ladyboy", "ts-", "-ts", "trap"]),
    ("teen", ["teen", "college", "young", "petite", "18yo", "19yo", "schoolgirl"]),
    ("milf", ["milf", "mature", "mom", "cougar"]),
    ("anal", ["anal", "butt", "ass", "pegging", "prostate"]),
    ("squirt", ["squirt", "gush", "creampie"]),
    ("lovense", ["lovense", "lush", "toy", "vibrat"]),
    ("blonde", ["blond", "blonde", "blondy"]),
    ("brunette", ["brunette", "brown"]),
    ("redhead", ["redhead", "ginger", "red"]),
    ("bbw", ["bbw", "curvy", "thick", "chubby", "plump"]),
    ("ebony", ["ebony", "black"]),
    ("latina", ["latina", "colombian", "venezuelan", "brazilian", "mexican", "spanish"]),
    ("asian", ["asian", "japanese", "korean", "thai", "oriental"]),
    ("couple", ["couple", "duo", "two", "mf", "ff", "mm", "threesome", "gangbang"]),
    ("feet", ["feet", "foot", "toes", "soles", "stockings", "nylon", "socks"]),
    ("dildo", ["dildo", "strap", "penetrat", "fucking"]),
    ("cosplay", ["cosplay", "anime", "costume", "nurse", "maid"]),
    ("tattoo", ["tattoo", "inked", "piercing"]),
    ("shower", ["shower", "bath", "oil", "soap"]),
    ("bigboobs", ["bigboobs", "boobs", "tits", "huge"]),
    ("pussy", ["pussy", "fingering", "masturbat"]),
    ("striptease", ["striptease", "strip", "dance"]),
]

def extract_video_tags(v: Dict[str, Any]) -> List[str]:
    """Ustala dokładne tagi dla każdego wideo na podstawie platformy, profilu, słów kluczowych i opisu."""
    tags = set(v.get("tags") or [])
    
    # 1. Platforma
    platform = v.get("platform", "")
    if platform and platform.lower() not in ["archive", "archivebate"]:
        tags.add(platform)
        
    # 2. Płeć / Gender z wideo lub z bazy profili
    gender = v.get("gender", "")
    username = v.get("username", "")
    try:
        from model_tags import model_tag_manager
        model_info = model_tag_manager.get_model(username) if username else None
        if model_info:
            if model_info.get("gender"):
                gender = model_info["gender"]
            for mt in model_info.get("tags", []):
                tags.add(mt)
    except Exception:
        pass
    
    if gender:
        tags.add(gender.capitalize())
        if gender.lower() == "trans":
            tags.add("Trans")
            if "Female" in tags:
                tags.remove("Female")
            
    # 3. Analiza tekstu (tytuł, słowa kluczowe, opis, username)
    kw_list = v.get("keywords") or []
    if isinstance(kw_list, list):
        kw_text = " ".join(kw_list)
    else:
        kw_text = str(kw_list)
        
    full_text = f"{v.get('title', '')} {v.get('username', '')} {kw_text} {v.get('description', '')}".lower()
    
    for tag_name, keywords in KNOWN_TAG_RULES:
        for kw in keywords:
            if kw in full_text:
                tags.add(tag_name.capitalize())
                break
                
    if not any(t in tags for t in ["Trans", "Female", "Male", "Couple"]):
        tags.add("Female")
    elif "Trans" in tags and "Female" in tags:
        tags.remove("Female")
        
    res_tags = sorted(list(tags))
    v["tags"] = res_tags
    if gender:
        v["gender"] = gender
    return res_tags

@functools.lru_cache(maxsize=4096)
def parse_date_to_sort_seconds(date_str: str) -> float:
    """Konwertuje dowolny napis daty/czasu z Archivebate na szacunkowy wiek w sekundach (mniejsza wartość = nowsze nagranie)."""
    if not date_str:
        return 999999999.0
    s = str(date_str).lower().strip()

    if any(w in s for w in ['just now', 'teraz', 'niedawno', 'a few seconds', 'chwilę temu']):
        return 0.0

    # Minuty
    m_min = re.search(r'(\d+)\s*(?:min|minute|minut)', s)
    if m_min:
        return float(m_min.group(1)) * 60.0

    # Godziny
    m_hour = re.search(r'(\d+)\s*(?:hour|godz)', s)
    if m_hour:
        return float(m_hour.group(1)) * 3600.0

    # Dni
    m_day = re.search(r'(\d+)\s*(?:day|dni|dzień)', s)
    if m_day:
        return float(m_day.group(1)) * 86400.0

    # Tygodnie
    m_week = re.search(r'(\d+)\s*(?:week|tyg)', s)
    if m_week:
        return float(m_week.group(1)) * 7 * 86400.0

    # Miesiące
    m_month = re.search(r'(\d+)\s*(?:month|mies)', s)
    if m_month:
        return float(m_month.group(1)) * 30 * 86400.0

    # Lata
    m_year = re.search(r'(\d+)\s*(?:year|lat|rok)', s)
    if m_year:
        return float(m_year.group(1)) * 365 * 86400.0

    # Kalendarzowa data DD.MM.YYYY
    m_dmy = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', s)
    if m_dmy:
        try:
            d, m, y = map(int, m_dmy.groups())
            dt = datetime(y, m, d)
            now = datetime.now()
            return max(0.0, (now - dt).total_seconds())
        except Exception:
            pass

    # Kalendarzowa data YYYY-MM-DD
    m_ymd = re.search(r'(\d{4})[/-](\d{2})[/-](\d{2})', s)
    if m_ymd:
        try:
            y, m, d = map(int, m_ymd.groups())
            dt = datetime(y, m, d)
            now = datetime.now()
            return max(0.0, (now - dt).total_seconds())
        except Exception:
            pass

    return 500000000.0

def sort_videos_newest_first(videos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sortuje listę filmów bezwzględnie chronologicznie od najmłodszego do najstarszego (godziny po kolei, bez skoków 5->8->6)."""
    def sort_key(v):
        try:
            age_sec = parse_date_to_sort_seconds(v.get("date", ""))
            raw_id = re.sub(r'\D', '', str(v.get("id", "")))
            id_val = int(raw_id) if raw_id else 0
            # Mniejszy wiek w sekundach = młodszy (wyżej na liście); przy tej samej liczbie godzin nowszy ID rozstrzyga remis
            return (age_sec, -id_val)
        except Exception:
            return (999999999.0, 0)
    return sorted(videos, key=sort_key)

class ArchivebateScraper:
    def __init__(self, session: ArchivebateSession):
        self.session = session
        self._cache = BoundedTTLCache(max_items=300, default_ttl=600.0)
        self._home_cache = BoundedTTLCache(max_items=50, default_ttl=60.0)
        self._details_cache = BoundedTTLCache(max_items=500, default_ttl=3600.0)

    def parse_video_card(self, section_html: str) -> Optional[Dict[str, Any]]:
        """Parsuje pojedynczy kafelek wideo z plakatami JPG oraz wideo podglądu MP4."""
        try:
            url_m = re.search(r'href="([^"]*watch/[^"]+)"', section_html)
            if not url_m:
                return None
            watch_url = url_m.group(1)
            video_id_m = re.search(r'/watch/([0-9a-zA-Z]+)', watch_url)
            video_id = video_id_m.group(1) if video_id_m else ""

            # Wyciąganie plakatu i wideo podglądu (odrzucamy logo/awatar)
            raw_media = ""
            poster_m = re.search(r'poster="([^"]+)"', section_html)
            if poster_m and "logo" not in poster_m.group(1).lower():
                raw_media = poster_m.group(1)

            if not raw_media:
                # Szukamy URL w background-image (dla starszych wideo z Livewire)
                bg_urls = re.findall(r'url\([\'"]?([^\'")]+)[\'"]?\)', section_html)
                clean_bgs = [u.replace("&quot;", "").replace('"', '').replace("'", "") for u in bg_urls if "_4x4" not in u and "logo" not in u.lower()]
                if clean_bgs:
                    raw_media = clean_bgs[0]

            if not raw_media:
                data_src_m = re.search(r'data-src="([^"]+)"', section_html)
                if data_src_m and "logo" not in data_src_m.group(1).lower():
                    raw_media = data_src_m.group(1)

            if not raw_media:
                src_m = re.search(r'src="([^"]+)"', section_html)
                if src_m and "logo" not in src_m.group(1).lower() and "icon" not in src_m.group(1).lower():
                    raw_media = src_m.group(1)

            # Awaryjna rekonstrukcja ze ścieżki daty i ID jeśli nadal brak lub logo
            if not raw_media or "logo" in raw_media.lower():
                thumb_date_m = re.search(r'thumbnails/(\d{4})/(\d{2})/(\d{2})', section_html)
                if thumb_date_m and video_id:
                    y, m, d = thumb_date_m.groups()
                    raw_media = f"https://cdn.freefile.io/thumbnails/{y}/{m}/{d}/{video_id}.jpg"

            if raw_media.startswith("//"):
                raw_media = "https:" + raw_media

            if raw_media.endswith(".mp4"):
                preview_video = raw_media
                poster_img = raw_media.replace(".mp4", ".jpg")
            elif raw_media.endswith(".jpg"):
                poster_img = raw_media
                preview_video = raw_media.replace(".jpg", ".mp4")
            else:
                poster_img = raw_media
                preview_video = raw_media

            # Czas trwania
            dur_m = re.search(r'<span class="[^"]*">([0-9:]+)</span>', section_html) or re.search(r'(\d+:\d+|\d+h \d+m)', section_html)
            duration = dur_m.group(1) if dur_m else "N/A"

            # Nazwa modelki / profilu
            user_m = re.search(r'href="https://archivebate\.com/profile/([^"]+)"', section_html) or re.search(r'/profile/([^"/\s]+)', section_html)
            username = user_m.group(1) if user_m else "Model"

            # Data dodania z HTML lub z miniatury
            p_m = re.search(r'<p>\s*([^&<]+?)\s*&middot;', section_html)
            p_date = p_m.group(1).strip() if p_m else ""

            thumb_date_m = re.search(r'thumbnails/(\d{4})/(\d{2})/(\d{2})', section_html)
            iso_date = ""
            if thumb_date_m:
                y, m, d = thumb_date_m.groups()
                iso_date = f"{d}.{m}.{y}"

            if p_date and re.search(r'\d', p_date) and not any(w in p_date.lower() for w in ['chaturbate', 'stripchat', 'camsoda', 'onlyfans']):
                if iso_date and iso_date not in p_date:
                    date = f"{p_date} • {iso_date}"
                else:
                    date = p_date
            elif iso_date:
                date = iso_date
            else:
                date = p_date or "Niedawno"

            views_m = re.search(r'(\d+\s*views)', section_html)
            views = views_m.group(1) if views_m else ""

            # Platforma
            platform_m = re.search(r'(Chaturbate|Stripchat|Camsoda|Cam4|Onlyfans|TikTok)', section_html, re.IGNORECASE)
            platform = platform_m.group(1) if platform_m else "Chaturbate"

            card_dict = {
                "id": video_id,
                "url": watch_url,
                "thumbnail": poster_img,
                "poster": poster_img,
                "preview_video": preview_video,
                "duration": duration,
                "username": username,
                "profile_url": f"https://archivebate.com/profile/{username}",
                "date": date,
                "views": views,
                "platform": platform
            }
            card_dict["tags"] = extract_video_tags(card_dict)
            return card_dict
        except Exception as e:
            logger.error(f"Błąd parsowania kafelka: {e}")
            return None

    def _sync_csrf(self, html: str, url: str):
        csrf_m = re.search(r'name="_token" value="([^"]+)"', html) or re.search(r'csrf-token" content="([^"]+)"', html)
        if csrf_m:
            self.session.csrf_token = csrf_m.group(1)
            self.session.session.headers.update({
                "X-CSRF-TOKEN": self.session.csrf_token,
                "Referer": url
            })

    def _fetch_single_ab_home_page(self, p: int) -> List[Dict[str, Any]]:
        """Pobiera pojedynczą stronę z Archivebate."""
        if p > 1000:
            return []
        url = f"https://archivebate.com?page={p}" if p > 1 else "https://archivebate.com"
        try:
            r = self.session.session.get(url, timeout=10)
            html = r.text
            self._sync_csrf(html, url)

            m = re.search(r'wire:id="([^"]+)" wire:initial-data="([^"]+)" wire:init="([^"]+)"', html)
            if m:
                raw_data = m.group(2).replace('&quot;', '"')
                data = json.loads(raw_data)
                name = data['fingerprint']['name']
                method = m.group(3)
                rendered_html = self.session.call_livewire(name, data['fingerprint'], data['serverMemo'], method)
                if rendered_html:
                    sections = re.findall(r'<section class="video_item">.*?</section>', rendered_html, re.DOTALL)
                    parsed = []
                    for sec in sections:
                        video = self.parse_video_card(sec)
                        if video:
                            parsed.append(video)
                    return parsed
            sections = re.findall(r'<section class="video_item">.*?</section>', html, re.DOTALL)
            parsed = []
            for sec in sections:
                video = self.parse_video_card(sec)
                if video:
                    parsed.append(video)
            return parsed
        except Exception:
            return []

    def get_home_videos(
        self,
        page: int = 1,
        source: str = "all",
        author_filter: str = "all",
        blocked_models: Optional[set] = None,
        favorite_authors: Optional[set] = None,
        target_count: int = 280
    ) -> List[Dict[str, Any]]:
        """Pobiera kafelki wideo ze strony głównej z gwarancją stałej liczby 280 unikalnych nagrań z uwzględnieniem filtrów."""
        cache_key = f"home:{source}:{author_filter}:{page}"
        now = time.time()
        if not hasattr(self, "_home_cache"):
            self._home_cache = {}
        if cache_key in self._home_cache:
            entry = self._home_cache[cache_key]
            if now - entry["time"] < 60 and len(entry.get("data", [])) >= target_count:
                return entry["data"]

        from camwhores import camwhores_scraper, deduplicate_videos, merge_and_deduplicate

        if blocked_models is None:
            try:
                from storage import storage
                blocked_models = set(re.sub(r'[^a-z0-9]', '', b.lower()) for b in storage.get_blocked_models())
            except Exception:
                blocked_models = set()

        if favorite_authors is None:
            try:
                from storage import storage
                favorite_authors = set(re.sub(r'[^a-z0-9]', '', a.lower()) for a in storage.get_favorite_authors())
            except Exception:
                favorite_authors = set()

        def is_allowed_video(v: dict) -> bool:
            if not isinstance(v, dict):
                return False
            norm_u = re.sub(r'[^a-z0-9]', '', str(v.get("username", "")).lower())
            if norm_u and norm_u in blocked_models:
                return False
            if author_filter == "exclude_fav":
                if (norm_u and norm_u in favorite_authors) or v.get("is_favorite"):
                    return False
            elif author_filter == "only_fav":
                if not ((norm_u and norm_u in favorite_authors) or v.get("is_favorite")):
                    return False
            return True

        merged: List[Dict[str, Any]] = []

        if source == "only-camwhores":
            # Tylko Camwhores: pobieramy partiami strony CW
            cw_start = (page - 1) * 12 + 1
            cw_pages = list(range(cw_start, cw_start + 12))
            cw_videos = []
            with ThreadPoolExecutor(max_workers=12) as executor:
                futures = {executor.submit(camwhores_scraper.get_latest_videos, p): p for p in cw_pages}
                for f in as_completed(futures):
                    try:
                        cw_videos.extend(f.result() or [])
                    except Exception:
                        pass
            filtered = [v for v in deduplicate_videos(cw_videos) if is_allowed_video(v)]
            merged = filtered

            # Dociągamy kolejne strony Camwhores jeśli < target_count
            extra_p = cw_start + 12
            while len(merged) < target_count and extra_p <= cw_start + 25:
                batch = list(range(extra_p, extra_p + 3))
                extra_p += 3
                with ThreadPoolExecutor(max_workers=3) as executor:
                    batch_vids = []
                    for vlist in executor.map(camwhores_scraper.get_latest_videos, batch):
                        batch_vids.extend(vlist or [])
                    cw_videos.extend(batch_vids)
                    merged = [v for v in deduplicate_videos(cw_videos) if is_allowed_video(v)]

        elif source == "only-archivebate":
            # Tylko Archivebate: pobieramy partiami strony AB
            ab_start = (page - 1) * 20 + 1
            ab_pages = [p for p in range(ab_start, ab_start + 20) if p <= 1000]
            ab_videos = []
            with ThreadPoolExecutor(max_workers=16) as executor:
                futures = {executor.submit(self._fetch_single_ab_home_page, p): p for p in ab_pages}
                for f in as_completed(futures):
                    try:
                        ab_videos.extend(f.result() or [])
                    except Exception:
                        pass
            filtered = [v for v in deduplicate_videos(ab_videos) if is_allowed_video(v)]
            merged = filtered

            # Dociągamy kolejne strony Archivebate jeśli < target_count
            extra_p = ab_start + 20
            while len(merged) < target_count and extra_p <= ab_start + 40 and extra_p <= 1000:
                batch = [p for p in range(extra_p, extra_p + 5) if p <= 1000]
                extra_p += 5
                if not batch:
                    break
                with ThreadPoolExecutor(max_workers=5) as executor:
                    for vlist in executor.map(self._fetch_single_ab_home_page, batch):
                        ab_videos.extend(vlist or [])
                    merged = [v for v in deduplicate_videos(ab_videos) if is_allowed_video(v)]

        else:
            # "all": Archivebate + Camwhores równolegle
            ab_start = (page - 1) * 10 + 1
            cw_start = (page - 1) * 6 + 1
            ab_pages = [p for p in range(ab_start, ab_start + 10) if p <= 1000]
            cw_pages = list(range(cw_start, cw_start + 6))

            ab_videos = []
            cw_videos = []

            with ThreadPoolExecutor(max_workers=16) as executor:
                ab_futures = {executor.submit(self._fetch_single_ab_home_page, p): p for p in ab_pages}
                cw_futures = {executor.submit(camwhores_scraper.get_latest_videos, p): p for p in cw_pages}

                for future in as_completed(list(ab_futures) + list(cw_futures)):
                    try:
                        vids = future.result() or []
                    except Exception:
                        continue
                    if future in ab_futures:
                        ab_videos.extend(vids)
                    else:
                        cw_videos.extend(vids)

            merged_raw = merge_and_deduplicate(ab_videos, cw_videos)
            merged = [v for v in merged_raw if is_allowed_video(v)]

            # Dociągamy kolejne strony jeśli < target_count
            extra_offset = 0
            while len(merged) < target_count and extra_offset < 10:
                extra_ab = [ab_start + 10 + extra_offset * 3 + i for i in range(3) if ab_start + 10 + extra_offset * 3 + i <= 1000]
                extra_cw = [cw_start + 6 + extra_offset * 2 + i for i in range(2)]
                extra_offset += 1

                with ThreadPoolExecutor(max_workers=5) as executor:
                    for vlist in executor.map(self._fetch_single_ab_home_page, extra_ab):
                        ab_videos.extend(vlist or [])
                    for vlist in executor.map(camwhores_scraper.get_latest_videos, extra_cw):
                        cw_videos.extend(vlist or [])

                merged_raw = merge_and_deduplicate(ab_videos, cw_videos)
                merged = [v for v in merged_raw if is_allowed_video(v)]

        result = sort_videos_newest_first(merged)
        if result:
            self._home_cache[cache_key] = {"data": result, "time": now}
        return result

    def get_model_videos(self, username: str, page: int = 1) -> List[Dict[str, Any]]:
        """Pobiera filmy konkretnej modelki (zoptymalizowane, z pamięcią podręczną)."""
        cache_key = f"model:{username}:{page}"
        now = time.time()
        if cache_key in self._cache:
            entry = self._cache[cache_key]
            if now - entry["time"] < 300:
                return entry["data"]

        all_videos = []

        def _fetch_page(p):
            url = f"https://archivebate.com/profile/{username}?page={p}"
            try:
                r = self.session.session.get(url, timeout=4)
                html = r.text
                self._sync_csrf(html, url)
                for m in re.finditer(r'wire:id="([^"]+)" wire:initial-data="([^"]+)"', html):
                    raw_data = m.group(2).replace('&quot;', '"')
                    data = json.loads(raw_data)
                    name = data['fingerprint']['name']
                    if 'model-videos' in name or 'profile' in name:
                        rendered_html = self.session.call_livewire(name, data['fingerprint'], data['serverMemo'], "load_profile_videos")
                        if rendered_html:
                            sections = re.findall(r'<section class="video_item">.*?</section>', rendered_html, re.DOTALL)
                            vids = []
                            for sec in sections:
                                v = self.parse_video_card(sec)
                                if v:
                                    if v["username"] == "Model":
                                        v["username"] = username
                                    vids.append(v)
                            return vids
                sections = re.findall(r'<section class="video_item">.*?</section>', html, re.DOTALL)
                return [self.parse_video_card(s) for s in sections if self.parse_video_card(s)]
            except Exception:
                return []

        # Równolegle: strona Archivebate + filmy Camwhores
        with ThreadPoolExecutor(max_workers=2) as executor:
            f_ab = executor.submit(_fetch_page, page)
            from camwhores import camwhores_scraper, merge_and_deduplicate
            f_cw = executor.submit(camwhores_scraper.search_videos, username)

            try: all_videos.extend(f_ab.result(timeout=5))
            except Exception: pass
            try:
                cw_vids = f_cw.result(timeout=4)
                cw_model_vids = [v for v in cw_vids if v.get("username", "").lower() == username.lower()]
                all_videos = merge_and_deduplicate(all_videos, cw_model_vids)
            except Exception: pass

        sorted_vids = sort_videos_newest_first(all_videos)
        self._cache[cache_key] = {"data": sorted_vids, "time": now}
        return sorted_vids


    def _fetch_search_profiles(self, clean_q: str) -> List[Dict[str, Any]]:
        """Szybkie pobieranie pasujących profili bezpośrednim zapytaniem (w ułamku sekundy)."""
        if not self.session.csrf_token:
            self.session.refresh_csrf()

        headers = {
            "X-CSRF-TOKEN": self.session.csrf_token or "",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://archivebate.com/"
        }

        profiles = []
        seen_users = set()
        try:
            r = self.session.session.get(
                f"https://archivebate.com/api/v1/search?query={clean_q}",
                headers=headers,
                timeout=5
            )
            if r.status_code == 200:
                for p in r.json().get("data", []):
                    u = p.get("username")
                    if u and u not in seen_users:
                        seen_users.add(u)
                        profiles.append(p)
        except Exception:
            pass

        # Jeśli profili jest mało (< 12), sprawdzamy 3 najczęstsze warianty ze spacją i myślnikiem
        if len(profiles) < 12:
            extra_chars = [' ', '-', '_']
            for c in extra_chars:
                try:
                    r2 = self.session.session.get(
                        f"https://archivebate.com/api/v1/search?query={clean_q}{c}",
                        headers=headers,
                        timeout=3
                    )
                    if r2.status_code == 200:
                        for p in r2.json().get("data", []):
                            u = p.get("username")
                            if u and u not in seen_users:
                                seen_users.add(u)
                                profiles.append(p)
                except Exception:
                    pass

        return profiles

    def search_query(self, query: str, page: int = 1, per_page: int = 280) -> Dict[str, Any]:
        """Szybkie wyszukiwanie tagów i profili z podziałem na strony (10x więcej filmów na stronę)."""
        clean_q = query.replace("#", "").strip()
        if not clean_q:
            return {"query": query, "page": 1, "last_page": 1, "total_profiles": 0, "total_videos": 0, "profiles": [], "videos": []}

        cache_key = f"tag_search:{clean_q.lower()}"
        now = time.time()

        if cache_key in self._cache and (now - self._cache[cache_key]["time"] < 600):
            cached = self._cache[cache_key]
            all_profiles = cached["profiles"]
            all_videos = cached["videos"]
        else:
            all_profiles = self._fetch_search_profiles(clean_q)
            # Wzbogacamy o znane profile z bazy tagów (np. melodyxlove dla trans) na początku listy
            try:
                from model_tags import model_tag_manager
                known_models = model_tag_manager.get_models_with_tag(clean_q)
                for km in reversed(known_models):
                    if km.lower() not in ["model"]:
                        if not any(p.get("username", "").lower() == km.lower() for p in all_profiles):
                            all_profiles.insert(0, {"platform": "Chaturbate", "username": km, "gender": clean_q.capitalize()})
            except Exception:
                pass

            # Filtr zablokowanych profili
            all_profiles = [p for p in all_profiles if not storage.is_model_blocked(p.get("username"))]

            # 1. Pobieramy dopasowane wideo z bazy użytkownika (tagi, keywords, opis)
            raw_videos = []
            seen_v_ids = set()
            try:
                stored = storage.search_stored_videos(clean_q)
                for sv in stored:
                    sv_id = str(sv.get("id"))
                    if sv_id and sv_id not in seen_v_ids:
                        seen_v_ids.add(sv_id)
                        raw_videos.append(sv)
            except Exception:
                pass

            # 2. Pobieramy dopasowane wideo z Camwhores.tv oraz najpopularniejszych profili z Archivebate
            def fetch_vids(p):
                u = p.get("username")
                if not u: return []
                try:
                    return self.get_model_videos(u, page=1)
                except Exception:
                    return []

            target_profiles = all_profiles[:8]
            from camwhores import camwhores_scraper, merge_and_deduplicate

            with ThreadPoolExecutor(max_workers=9) as executor:
                cw_future = executor.submit(camwhores_scraper.search_videos, clean_q)
                prof_futures = [executor.submit(fetch_vids, p) for p in target_profiles]

                try:
                    cw_vids = cw_future.result(timeout=6)
                    # Uczymy się tagów modeli z wyników wyszukiwania
                    try:
                        from model_tags import model_tag_manager
                        for cv in cw_vids:
                            u = cv.get("username")
                            if u and u.lower() not in ["model"]:
                                g = clean_q.capitalize() if clean_q.lower() in ["trans", "female", "male", "couple"] else None
                                model_tag_manager.set_model(u, gender=g, tags=[clean_q.capitalize()])
                    except Exception:
                        pass
                    raw_videos = merge_and_deduplicate(raw_videos, cw_vids)
                except Exception:
                    pass

                for f in prof_futures:
                    try:
                        for v in f.result(timeout=5):
                            if v and v.get("id") and v["id"] not in seen_v_ids:
                                seen_v_ids.add(v["id"])
                                raw_videos.append(v)
                    except Exception:
                        pass

            # Sortujemy WSZYSTKIE filmy bezwzględnie globalnie od najnowszego!
            all_videos = sort_videos_newest_first(raw_videos)
            self._cache[cache_key] = {
                "profiles": all_profiles,
                "videos": all_videos,
                "time": now
            }

        total_vids = len(all_videos)
        last_page = max(1, math.ceil(total_vids / per_page))
        start_idx = (page - 1) * per_page
        sliced_videos = all_videos[start_idx : start_idx + per_page]

        return {
            "query": query,
            "page": page,
            "last_page": last_page,
            "total_profiles": len(all_profiles),
            "total_videos": total_vids,
            "profiles": all_profiles[:30],
            "videos": sliced_videos
        }

    def search_query_stream(self, query: str):
        """Generator strumieniowy SSE: pobiera wideo ze wszystkich pasujących profili i Camwhores.tv, sortuje globalnie i wysyła progresywnie."""
        clean_q = query.replace("#", "").strip()
        if not clean_q:
            yield {"type": "done", "total_videos": 0, "total_profiles": 0}
            return

        cache_key = f"tag_search:{clean_q.lower()}"
        now = time.time()

        # Jeśli wynik jest w pamięci RAM, zwróć go natychmiast
        if cache_key in self._cache and (now - self._cache[cache_key]["time"] < 600):
            cached = self._cache[cache_key]
            yield {
                "type": "profiles",
                "profiles": cached["profiles"][:30],
                "total_profiles": len(cached["profiles"])
            }
            yield {
                "type": "videos",
                "videos": cached["videos"][:360],
                "total_so_far": len(cached["videos"])
            }
            yield {
                "type": "done",
                "total_videos": len(cached["videos"]),
                "total_profiles": len(cached["profiles"]),
                "last_page": max(1, math.ceil(len(cached["videos"]) / 360)),
                "all_sorted_videos": cached["videos"][:360]
            }
            return

        # 1. Szybkie pobranie profili
        all_profiles = self._fetch_search_profiles(clean_q)
        try:
            from model_tags import model_tag_manager
            known_models = model_tag_manager.get_models_with_tag(clean_q)
            for km in reversed(known_models):
                if km.lower() not in ["model"]:
                    if not any(p.get("username", "").lower() == km.lower() for p in all_profiles):
                        all_profiles.insert(0, {"platform": "Chaturbate", "username": km, "gender": clean_q.capitalize()})
        except Exception:
            pass

        # Filtr zablokowanych profili
        all_profiles = [p for p in all_profiles if not storage.is_model_blocked(p.get("username"))]

        yield {
            "type": "profiles",
            "profiles": all_profiles[:30],
            "total_profiles": len(all_profiles)
        }

        # 2. Pobieramy dopasowane wideo: najpierw z pamięci i Camwhores (dostępne w < 0.5s!), a potem z profili
        seen_v_ids = set()
        streamed_ids = set()
        all_videos = []

        # Wideo z pamięci lokalnej (błyskawiczne)
        try:
            stored = storage.search_stored_videos(clean_q)
            for sv in stored:
                sv_id = str(sv.get("id"))
                if sv_id and sv_id not in seen_v_ids:
                    seen_v_ids.add(sv_id)
                    all_videos.append(sv)
        except Exception:
            pass

        # Pobranie wyników z Camwhores.tv (dostępne natychmiast)
        from camwhores import camwhores_scraper
        cw_vids = []
        try:
            cw_vids = camwhores_scraper.search_videos(clean_q)
            try:
                from model_tags import model_tag_manager
                for cv in cw_vids:
                    u = cv.get("username")
                    if u and u.lower() not in ["model"]:
                        g = clean_q.capitalize() if clean_q.lower() in ["trans", "female", "male", "couple"] else None
                        model_tag_manager.set_model(u, gender=g, tags=[clean_q.capitalize()])
            except Exception:
                pass
            for v in cw_vids:
                if v and v.get("id") and v["id"] not in seen_v_ids:
                    seen_v_ids.add(v["id"])
                    all_videos.append(v)
        except Exception:
            pass

        # NATYCHMIASTOWE wysłanie pierwszej partii do przeglądarki (w ułamku sekundy!)
        initial_batch = sort_videos_newest_first(all_videos)
        if initial_batch:
            for v in initial_batch:
                streamed_ids.add(v["id"])
            yield {
                "type": "videos",
                "videos": initial_batch,
                "total_so_far": len(streamed_ids)
            }

        # 3. Pobranie z najpopularniejszych profili Archivebate (ograniczone do top 8 dla maksymalnej prędkości)
        target_profiles = all_profiles[:8]

        def fetch_vids(p):
            u = p.get("username")
            if not u: return []
            try:
                return self.get_model_videos(u, page=1)
            except Exception:
                return []

        if target_profiles:
            with ThreadPoolExecutor(max_workers=8) as executor:
                future_to_prof = {executor.submit(fetch_vids, p): p for p in target_profiles}
                for future in as_completed(future_to_prof):
                    try:
                        vids = future.result()
                        new_from_prof = []
                        for v in vids:
                            if v and v.get("id") and v["id"] not in seen_v_ids:
                                seen_v_ids.add(v["id"])
                                all_videos.append(v)
                                new_from_prof.append(v)
                        if new_from_prof:
                            for v in new_from_prof:
                                streamed_ids.add(v["id"])
                            yield {
                                "type": "videos",
                                "videos": sort_videos_newest_first(new_from_prof),
                                "total_so_far": len(streamed_ids)
                            }
                    except Exception:
                        pass

        # 4. KLUCZOWE: Sortujemy WSZYSTKIE pobrane wideo BEZWZGLĘDNIE od najnowszego (globalnie, mieszając modelki)!
        sorted_all = sort_videos_newest_first(all_videos)
        self._cache[cache_key] = {
            "profiles": all_profiles,
            "videos": sorted_all,
            "time": time.time()
        }

        yield {
            "type": "done",
            "total_videos": len(sorted_all),
            "total_profiles": len(all_profiles),
            "last_page": max(1, math.ceil(len(sorted_all) / 360)),
            "all_sorted_videos": sorted_all[:360]
        }

    def get_video_details(self, video_id_or_url: str) -> Dict[str, Any]:
        """Pobiera pełne detale wideo, w tym bezpośredni link do strumienia MP4 bez reklam."""
        if str(video_id_or_url).startswith("cw_") or "camwhores.tv" in str(video_id_or_url):
            try:
                from camwhores import camwhores_scraper
                return camwhores_scraper.get_video_details(video_id_or_url)
            except Exception as e:
                logger.error(f"Błąd pobierania detali Camwhores ({video_id_or_url}): {e}")
                return {"url": video_id_or_url, "direct_url": "", "embed_url": video_id_or_url, "source": "camwhores"}

        clean_id = video_id_or_url.split("/")[-1].split("?")[0]
        now = time.time()
        if not hasattr(self, "_details_cache"):
            self._details_cache = {}
        if clean_id in self._details_cache:
            entry = self._details_cache[clean_id]
            if now - entry["time"] < 3600:
                return entry["data"]

        if video_id_or_url.startswith("http"):
            url = video_id_or_url
        else:
            url = f"https://archivebate.com/watch/{clean_id}"

        try:
            r = self.session.session.get(url, timeout=12)
            html = r.text

            # Mixdrop iframe
            iframe_m = re.search(r'<iframe[^>]*src="([^"]+)"', html)
            embed_url = iframe_m.group(1) if iframe_m else ""

            # Download fid
            fid_m = re.search(r'name="fid"\s+value="([^"]+)"', html)
            fid_url = fid_m.group(1) if fid_m else embed_url.replace("/e/", "/f/")

            # Thumbnail poster & preview video
            thumb_m = re.search(r'name="t"\s+value="([^"]+)"', html) or re.search(r'property="og:image"\s+content="([^"]+)"', html)
            raw_thumb = thumb_m.group(1) if thumb_m else ""
            if raw_thumb.startswith("//"):
                raw_thumb = "https:" + raw_thumb

            thumbnail = raw_thumb
            preview_video = ""
            if raw_thumb:
                if raw_thumb.endswith(".mp4"):
                    preview_video = raw_thumb
                    thumbnail = raw_thumb.replace(".mp4", ".jpg")
                elif raw_thumb.endswith(".jpg"):
                    thumbnail = raw_thumb
                    preview_video = raw_thumb.replace(".jpg", ".mp4")
                else:
                    thumbnail = raw_thumb
                    preview_video = raw_thumb

            # Model
            model_m = re.search(r'href="https://archivebate\.com/profile/([^"]+)"', html)
            username = model_m.group(1) if model_m else "Model"

            # Keywords
            kw_m = re.search(r'name="keywords"\s+content="([^"]+)"', html)
            keywords = [k.strip() for k in kw_m.group(1).split(",")] if kw_m else []

            # Description
            desc_m = re.search(r'name="description"\s+content="([^"]+)"', html)
            description = desc_m.group(1) if desc_m else ""

            # Data
            date_m = re.search(r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|\d{2}\.\d{2}\.\d{2})', html)
            date = date_m.group(1) if date_m else ""

            # Wyciągamy bezpośredni strumień MP4 z Mixdrop (bez reklam)
            direct_mp4_url = ""
            if embed_url:
                try:
                    mixdrop_res = self.session.session.get(embed_url, timeout=10)
                    direct_mp4_url = unpack_mixdrop(mixdrop_res.text) or ""
                except Exception as e:
                    logger.error(f"Błąd pobierania direct stream z Mixdrop: {e}")

            result = {
                "url": url,
                "embed_url": embed_url,
                "direct_url": direct_mp4_url,
                "download_url": fid_url,
                "thumbnail": thumbnail,
                "preview_video": preview_video,
                "username": username,
                "date": date,
                "keywords": keywords,
                "description": description
            }
            result["tags"] = extract_video_tags(result)
            if clean_id and direct_mp4_url:
                self._details_cache[clean_id] = {"data": result, "time": now}
            return result
        except Exception as e:
            logger.error(f"Błąd pobierania detali wideo {video_id_or_url}: {e}")
            return {
                "url": url,
                "embed_url": "",
                "direct_url": "",
                "download_url": "",
                "thumbnail": "",
                "username": "",
                "date": "",
                "keywords": [],
                "description": ""
            }

    def get_account_section_videos(self, endpoint: str, max_pages: int = 12) -> List[Dict[str, Any]]:
        """Pobiera pełną listę wideo ze wszystkich podstron sekcji konta (watchlater, history, following)."""
        if not self.session.is_logged_in:
            self.session.login()

        def fetch_page(p: int):
            url = f"https://archivebate.com/{endpoint}?page={p}" if p > 1 else f"https://archivebate.com/{endpoint}"
            try:
                r = self.session.session.get(url, timeout=12)
                if "login" in r.url:
                    self.session.login()
                    r = self.session.session.get(url, timeout=12)
                sections = re.findall(r'<section class="video_item">.*?</section>', r.text, re.DOTALL)
                return [self.parse_video_card(s) for s in sections if self.parse_video_card(s)]
            except Exception as e:
                logger.error(f"Błąd pobierania {endpoint} strona {p}: {e}")
                return []

        with ThreadPoolExecutor(max_workers=10) as executor:
            page_results = list(executor.map(fetch_page, range(1, max_pages + 1)))

        all_videos = []
        seen_ids = set()
        for batch in page_results:
            for v in batch:
                if v and v["id"] and v["id"] not in seen_ids:
                    seen_ids.add(v["id"])
                    all_videos.append(v)

        return sort_videos_newest_first(all_videos)

    def toggle_remote_save(self, video_id: str) -> bool:
        """Wysyła żądanie toggleSave do Archivebate dla podanego ID wideo."""
        try:
            watch_url = f"https://archivebate.com/watch/{video_id}"
            r = self.session.session.get(watch_url, timeout=10)
            for m in re.finditer(r'wire:id="([^"]+)" wire:initial-data="([^"]+)"', r.text):
                raw_data = m.group(2).replace('&quot;', '"')
                data = json.loads(raw_data)
                name = data['fingerprint']['name']
                if 'save-video' in name:
                    self.session.call_livewire(name, data['fingerprint'], data['serverMemo'], "toggleSave")
                    return True
        except Exception as e:
            logger.error(f"Błąd toggle_remote_save: {e}")
        return False
