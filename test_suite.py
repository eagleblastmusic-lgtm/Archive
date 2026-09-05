import unittest
import time
import tempfile
import threading
import socket
from unittest.mock import patch, MagicMock
from pathlib import Path
from fastapi.testclient import TestClient

from main import app
from cache_store import BoundedTTLCache, safe_cache_key, atomic_write_json, read_json_cache
from camwhores import deduplicate_videos, normalize_model_name, extract_date_signature
from scraper import parse_date_to_sort_seconds, sort_videos_newest_first, extract_video_tags
from storage import UserStorage, SyncResult, SyncStatus
from model_tags import ModelTagManager


class TestBoundedTTLCache(unittest.TestCase):
    def test_basic_crud(self):
        cache = BoundedTTLCache(max_items=10, default_ttl=60)
        cache["key1"] = "val1"
        self.assertIn("key1", cache)
        self.assertEqual(cache["key1"], "val1")
        self.assertEqual(cache.get("key1"), "val1")
        self.assertIsNone(cache.get("nonexistent"))
        self.assertEqual(cache.get("nonexistent", "default"), "default")
        
        # Pop
        val = cache.pop("key1")
        self.assertEqual(val, "val1")
        self.assertNotIn("key1", cache)
        self.assertEqual(len(cache), 0)

    def test_lru_eviction(self):
        cache = BoundedTTLCache(max_items=3, default_ttl=60)
        cache["a"] = 1
        cache["b"] = 2
        cache["c"] = 3
        # Access 'a' to make it recently used
        _ = cache["a"]
        # Add 'd', should evict 'b' (the oldest unaccessed)
        cache["d"] = 4
        self.assertIn("a", cache)
        self.assertNotIn("b", cache)
        self.assertIn("c", cache)
        self.assertIn("d", cache)
        self.assertEqual(len(cache), 3)

    def test_ttl_expiration(self):
        cache = BoundedTTLCache(max_items=10, default_ttl=0.1)
        cache["fast"] = "expiring"
        self.assertIn("fast", cache)
        time.sleep(0.15)
        self.assertNotIn("fast", cache)
        self.assertIsNone(cache.get("fast"))

    def test_thread_safety(self):
        cache = BoundedTTLCache(max_items=50, default_ttl=60)
        errors = []

        def worker(start_idx):
            try:
                for i in range(100):
                    k = f"k_{start_idx}_{i % 20}"
                    cache[k] = i
                    _ = cache.get(k)
                    _ = len(cache)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)
        self.assertLessEqual(len(cache), 50)


class TestCamwhoresDeduplication(unittest.TestCase):
    def test_normalize_model_name(self):
        self.assertEqual(normalize_model_name(" Sweet_Girl-123! "), "sweetgirl123")
        self.assertEqual(normalize_model_name("model_cam"), "modelcam")
        self.assertEqual(normalize_model_name(""), "")

    def test_extract_date_signature(self):
        sig1 = extract_date_signature("2 hours ago • 02.09.2026")
        self.assertEqual(sig1, "2026-09-02")
        sig2 = extract_date_signature("2026-09-02 14:00")
        self.assertEqual(sig2, "2026-09-02")
        sig3 = extract_date_signature("3 days ago")
        self.assertIsNone(sig3)

    def test_deduplication_exact_id(self):
        vids = [
            {"id": "1", "title": "Vid 1", "source": "archivebate"},
            {"id": "1", "title": "Vid 1 Duplicate", "source": "archivebate"},
            {"id": "2", "title": "Vid 2", "source": "archivebate"},
        ]
        deduped = deduplicate_videos(vids)
        self.assertEqual(len(deduped), 2)
        self.assertEqual(deduped[0]["id"], "1")
        self.assertEqual(deduped[1]["id"], "2")

    def test_deduplication_cross_source(self):
        vids = [
            {
                "id": "10",
                "username": "SuperModel",
                "duration": "10:00",
                "date": "02.09.2026",
                "source": "archivebate",
            },
            {
                "id": "cw_99",
                "username": "Super_Model",
                "duration": "10:01",
                "date": "02.09.2026",
                "source": "camwhores",
            },
            {
                "id": "11",
                "username": "SuperModel",
                "duration": "15:00",
                "date": "03.09.2026",
                "source": "camwhores",
            },
        ]
        deduped = deduplicate_videos(vids)
        self.assertEqual(len(deduped), 2)
        self.assertEqual(deduped[0]["id"], "10")
        self.assertEqual(deduped[1]["id"], "11")

    def test_deduplication_empty_and_single(self):
        self.assertEqual(deduplicate_videos([]), [])
        single = [{"id": "999", "title": "Lone"}]
        self.assertEqual(deduplicate_videos(single), single)


class TestScraperSortingAndTags(unittest.TestCase):
    def test_parse_date_to_sort_seconds(self):
        sec_m = parse_date_to_sort_seconds("10 minutes ago")
        sec_h = parse_date_to_sort_seconds("2 hours ago")
        sec_d = parse_date_to_sort_seconds("1 day ago")
        self.assertLess(sec_m, sec_h)
        self.assertLess(sec_h, sec_d)

    def test_sort_videos_newest_first(self):
        vids = [
            {"id": "100", "date": "5 hours ago • 02.09.2026"},
            {"id": "101", "date": "2 hours ago • 02.09.2026"},
            {"id": "102", "date": "8 hours ago • 02.09.2026"},
            {"id": "103", "date": "6 hours ago • 02.09.2026"},
            {"id": "104", "date": "20 minutes ago • 02.09.2026"},
            {"id": "105", "date": "1 day ago • 01.09.2026"},
        ]
        sorted_vids = sort_videos_newest_first(vids)
        expected_ids = ["104", "101", "100", "103", "102", "105"]
        actual_ids = [v["id"] for v in sorted_vids]
        self.assertEqual(actual_ids, expected_ids)

    def test_extract_video_tags(self):
        video = {
            "title": "Amazing teen brunette anal show",
            "keywords": ["dildo", "solo"],
        }
        tags = extract_video_tags(video)
        self.assertIn("Teen", tags)
        self.assertIn("Anal", tags)
        self.assertIn("Dildo", tags)


class TestStorageIndex(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store_file = Path(self.temp_dir.name) / "test_store.json"
        self.storage = UserStorage(str(self.store_file))

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_favorites_and_indexing(self):
        self.assertFalse(self.storage.is_favorite("v123"))
        
        # Add favorite
        item = {"id": "v123", "title": "Test Vid", "username": "StarModel"}
        self.storage.add_favorite(item)
        self.assertTrue(self.storage.is_favorite("v123"))
        self.assertIn("v123", self.storage._fav_ids)
        self.assertIn("starmodel", self.storage._fav_authors_clean)
        self.assertIn("starmodel", self.storage.get_favorite_authors())

        # Remove favorite
        self.storage.remove_favorite("v123")
        self.assertFalse(self.storage.is_favorite("v123"))
        self.assertNotIn("v123", self.storage._fav_ids)
        self.assertNotIn("starmodel", self.storage._fav_authors_clean)

    def test_blocked_models_and_indexing(self):
        self.assertFalse(self.storage.is_model_blocked("SpamModel"))
        self.storage.block_model("SpamModel")
        self.assertTrue(self.storage.is_model_blocked("SpamModel"))
        self.assertTrue(self.storage.is_model_blocked("spam_model"))
        self.assertIn("spammodel", self.storage._blocked_norm_set)

        self.storage.unblock_model("SpamModel")
        self.assertFalse(self.storage.is_model_blocked("SpamModel"))
        self.assertNotIn("spammodel", self.storage._blocked_norm_set)

    def test_history_tracking(self):
        self.assertEqual(len(self.storage.get_history()), 0)
        self.storage.record_history({"id": "h1", "title": "Watched 1", "watched_at": "2026-09-05 10:00:00"})
        self.storage.record_history({"id": "h2", "title": "Watched 2", "watched_at": "2026-09-05 11:00:00"})
        self.storage.record_history({"id": "h1", "title": "Watched 1 Again", "watched_at": "2026-09-05 12:00:00"}) # Should move to front
        
        history = self.storage.get_history()
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["id"], "h1")


class TestModelTags(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.tags_file = Path(self.temp_dir.name) / "test_tags.json"
        self.manager = ModelTagManager(str(self.tags_file))

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_set_and_get_model(self):
        self.manager.set_model("SuperModel", gender="Female", tags=["Anal", "Squirt"])
        info = self.manager.get_model("supermodel")
        self.assertIsNotNone(info)
        self.assertEqual(info["gender"], "Female")
        self.assertIn("Anal", info["tags"])
        self.assertIn("Squirt", info["tags"])

        models = self.manager.get_models_with_tag("Anal")
        self.assertIn("SuperModel", models)


class TestFastAPIRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_status(self):
        r = self.client.get("/api/status")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("logged_in", data)

    def test_tags(self):
        r = self.client.get("/api/tags")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("tags", data)

    def test_root_serves_html(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("<!DOCTYPE html>", r.text)

    def test_storage_account_endpoint(self):
        r = self.client.get("/api/account/following")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("videos", data)

    def test_search_suggestions(self):
        r = self.client.get("/api/search/suggestions?q=tr&limit=5")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("suggestions", data)
        self.assertLessEqual(len(data["suggestions"]), 5)
        tag_matches = [s for s in data["suggestions"] if s.get("type") == "tag"]
        self.assertTrue(any(t["value"] == "#trans" for t in tag_matches))

    def test_search_suggestions_hash_prefix(self):
        r = self.client.get("/api/search/suggestions?q=%23teen")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("suggestions", data)
        self.assertTrue(any(s["value"] == "#teen" for s in data["suggestions"]))
        self.assertFalse(any(s["type"] == "model" for s in data["suggestions"]))

    def test_relogin_endpoint_serializability(self):
        r = self.client.post("/api/relogin")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("success", data)
        self.assertIn("status", data)
        self.assertIsInstance(data["status"], dict)
        self.assertIn("favorites_count", data["status"])
        self.assertIn("account_configured", data["status"])

    def test_account_sync_endpoint(self):
        r = self.client.post("/api/account/sync?mode=merge")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("status", data)
        self.assertIn("favorites_count", data)

    def test_favorites_toggle_endpoint(self):
        sample = {"id": "test_toggle_vid_1", "title": "Test Toggle"}
        r = self.client.post("/api/account/favorites/toggle", json=sample)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["id"], "test_toggle_vid_1")
        self.assertTrue(data["is_favorite"])
        self.assertIn("remote_synced", data)
        self.assertIn("pending_sync", data)

        # Toggle back (remove)
        r2 = self.client.post("/api/account/favorites/toggle", json=sample)
        self.assertEqual(r2.status_code, 200)
        self.assertFalse(r2.json()["is_favorite"])



class TestSecurityAndFileCache(unittest.TestCase):
    def test_ssrf_blocking(self):
        from cache_store import is_safe_remote_url
        self.assertFalse(is_safe_remote_url("http://127.0.0.1/evil"))
        self.assertFalse(is_safe_remote_url("http://localhost/secret"))
        self.assertFalse(is_safe_remote_url("http://169.254.169.254/latest/meta-data"))
        self.assertFalse(is_safe_remote_url("ftp://example.com/file"))
        self.assertFalse(is_safe_remote_url("file:///etc/passwd"))
        self.assertFalse(is_safe_remote_url("javascript:alert(1)"))
        self.assertFalse(is_safe_remote_url(""))

    def test_safe_cache_key(self):
        key1 = safe_cache_key("video_12345")
        key2 = safe_cache_key("video_12345")
        key3 = safe_cache_key("video_67890")
        self.assertEqual(key1, key2)
        self.assertNotEqual(key1, key3)
        self.assertEqual(len(key1), 64)  # SHA-256 hex string

    def test_atomic_json_io(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = Path(tmp_dir) / "test.json"
            data = {"foo": "bar", "count": 42}
            atomic_write_json(file_path, data)

            read_back, mtime = read_json_cache(file_path)
            self.assertEqual(read_back, data)
            self.assertGreater(mtime, 0)

            # Test corrupted read
            file_path.write_text("{corrupt-json", encoding="utf-8")
            corrupt_read, _ = read_json_cache(file_path)
            self.assertIsNone(corrupt_read)


class TestStoryboardService(unittest.TestCase):
    def test_storyboard_dimensions(self):
        from storyboard_service import _frame_count, _columns, get_status
        self.assertEqual(_frame_count(60, "quick"), 8)
        self.assertEqual(_columns(8, "quick"), 4)
        self.assertGreaterEqual(_frame_count(300, "full"), 24)
        
        status = get_status("non_existent_vid_9999", 100.0)
        self.assertEqual(status.get("status"), "missing")

    def test_storyboard_api_endpoint(self):
        with TestClient(app) as client:
            res = client.get("/api/storyboard?id=test_sample&duration=33.27")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn(data.get("status"), ("ready", "building"))
            if data.get("status") == "ready":
                self.assertIn("sprite_url", data)
                img_res = client.get(data["sprite_url"])
                self.assertEqual(img_res.status_code, 200)
                self.assertEqual(img_res.headers.get("content-type"), "image/jpeg")


class TestCredentialsSecurity(unittest.TestCase):
    def test_no_hardcoded_credentials_fallback(self):
        from config import get_archivebate_credentials, is_credentials_configured
        with patch.dict("os.environ", {}, clear=True), \
             patch("config._read_env_file", return_value={}), \
             patch("pathlib.Path.exists", return_value=False):
            email, password = get_archivebate_credentials()
            self.assertEqual(email, "")
            self.assertEqual(password, "")
            self.assertFalse(is_credentials_configured())
            # Nigdy nie zwraca zahardkodowanego adresu akiraaibabe
            self.assertNotEqual(email, "akiraaibabe@gmail.com")

    def test_anonymous_login_controlled_state(self):
        from client import ArchivebateSession
        anon_session = ArchivebateSession(email="", password="")
        success = anon_session.login()
        self.assertFalse(success)
        self.assertIn("NOT_CONFIGURED", anon_session.last_login_error)


class TestUserStorageDurabilityAndRollback(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store_file = Path(self.tmp.name) / "durability_store.json"
        self.storage = UserStorage(str(self.store_file))

    def tearDown(self):
        self.tmp.cleanup()

    def test_fault_injection_atomic_rollback(self):
        # 1. Normalny zapis przechodzi pomyślnie
        self.assertTrue(self.storage.add_favorite({"id": "item_1", "title": "Vid 1"}))
        self.assertTrue(self.storage.is_favorite("item_1"))

        # 2. Wstrzyknięcie awarii dysku / uprawnień (brak miejsca, PermissionDenied)
        with patch("storage.atomic_write_json", side_effect=OSError("Brak miejsca na dysku")):
            res = self.storage.add_favorite({"id": "item_fail", "title": "Vid Fail"})
            self.assertFalse(res)
            # Kluczowe: stan w RAM ulega natychmiastowemu wycofaniu (rollback); brak fałszywego sukcesu
            self.assertFalse(self.storage.is_favorite("item_fail"))
            self.assertNotIn("item_fail", [v["id"] for v in self.storage.get_favorites()])

        # 3. Ponowny odczyt z dysku potwierdza integralność magazynu
        reloaded = UserStorage(str(self.store_file))
        self.assertTrue(reloaded.is_favorite("item_1"))
        self.assertFalse(reloaded.is_favorite("item_fail"))

    def test_pending_sync_and_reconciliation(self):
        # Dodanie ulubionego oznacza go jako oczekujący na sync zdalny
        self.storage.add_favorite({"id": "sync_1", "title": "Sync Vid"})
        pending = self.storage.get_pending_sync_favorites()
        self.assertIn("sync_1", pending)
        self.assertEqual(pending["sync_1"]["action"], "add")

        synced_calls = []
        def mock_sync(vid, action):
            synced_calls.append((vid, action))
            return True

        reconciled = self.storage.reconcile_pending_favorites(mock_sync)
        self.assertEqual(reconciled, 1)
        self.assertEqual(synced_calls, [("sync_1", "add")])
        self.assertEqual(len(self.storage.get_pending_sync_favorites()), 0)

    def test_sync_mirror_mode_and_last_synced_safety(self):
        # Ulubione lokalne z Camwhores oraz Archivebate
        self.storage.add_favorite({"id": "cw_sample", "title": "CW Vid", "source": "camwhores"})
        self.storage.add_favorite({"id": "ab_sample", "title": "AB Vid", "source": "archivebate"})

        remote_items = [{"id": "ab_remote_only", "title": "Remote Only", "source": "archivebate"}]

        # 1. Częściowa synchronizacja (np. zerwane połączenie): last_synced NIE MOŻE się przesunąć
        self.storage.merge_remote_data(remote_items, [], [], mode="mirror", is_full_sync=False)
        self.assertIsNone(self.storage.data.get("last_synced"))

        # W trybie mirror zachowane są lokalne wpisy Camwhores (nie-archivebate)
        fav_ids = [v["id"] for v in self.storage.get_favorites()]
        self.assertIn("cw_sample", fav_ids)
        self.assertIn("ab_remote_only", fav_ids)

        # 2. Pełna synchronizacja: last_synced zostaje zaktualizowany
        self.storage.merge_remote_data(remote_items, [], [], mode="merge", is_full_sync=True)
        self.assertIsNotNone(self.storage.data.get("last_synced"))


class TestModelTagManagerDurability(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tags_file = Path(self.tmp.name) / "durability_tags.json"
        self.manager = ModelTagManager(str(self.tags_file))

    def tearDown(self):
        self.tmp.cleanup()

    def test_dirty_retention_on_failure(self):
        self.manager.set_model("sweetmodel", gender="Trans", tags=["Anal"])
        self.assertTrue(self.manager._dirty)

        # Wstrzyknięcie błędu zapisu dyskowego
        with patch("model_tags.atomic_write_json", side_effect=OSError("Disk write error")):
            saved = self.manager.flush()
            self.assertFalse(saved)
            # Flaga dirty musi pozostać True do ponownej próby
            self.assertTrue(self.manager._dirty)

        # Gdy błąd ustąpi, flush kończy się sukcesem i czyści dirty
        saved = self.manager.flush()
        self.assertTrue(saved)
        self.assertFalse(self.manager._dirty)


class TestStoryboardSingleFlight(unittest.TestCase):
    def test_single_flight_concurrent_start(self):
        import storyboard_service

        build_calls = []
        def mock_build(vid, dur, url, qual):
            build_calls.append((vid, qual))
            time.sleep(0.15)
            return {"columns": 4, "rows": 2, "frame_count": 8}

        with patch.object(storyboard_service, "_build_variant", side_effect=mock_build), \
             patch.object(storyboard_service, "_cached_variant", return_value=None):

            results = []
            def runner():
                res = storyboard_service.start("concurrent_test_vid", 60.0, "https://example.com/v.mp4")
                results.append(res)

            threads = [threading.Thread(target=runner) for _ in range(5)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            # Wszystkie wątki otrzymały poprawny status
            self.assertEqual(len(results), 5)
            for r in results:
                self.assertIn(r.get("status"), ("building", "ready"))

            # Dokładnie 1 worker został uruchomiony dla 'quick'
            quick_calls = [c for c in build_calls if c[1] == "quick"]
            self.assertEqual(len(quick_calls), 1)

    def test_worker_failure_state_handling(self):
        import storyboard_service
        k = storyboard_service._key("error_test_vid")

        with patch.object(storyboard_service, "_build_variant", side_effect=RuntimeError("FFmpeg failed")), \
             patch.object(storyboard_service, "_cached_variant", return_value=None):

            storyboard_service.start("error_test_vid", 30.0, "https://example.com/bad.mp4", force=True)
            # Odczekaj na zakończenie wątku workera
            time.sleep(0.2)
            status = storyboard_service.get_status("error_test_vid", 30.0)
            self.assertIn(status.get("status"), ("error", "building", "missing"))


class TestPortResolutionSafety(unittest.TestCase):
    def test_resolve_port_when_archivebate_running(self):
        from desktop_app import resolve_port
        with patch("desktop_app.is_archivebate_running", return_value=True):
            port, already_running = resolve_port(8000)
            self.assertEqual(port, 8000)
            self.assertTrue(already_running)

    def test_resolve_port_when_occupied_by_foreign_service(self):
        from desktop_app import resolve_port
        # Port 8000 zajęty przez obcy program (nie Archivebate); port 8001 jest wolny
        with patch("desktop_app.is_archivebate_running", return_value=False), \
             patch("desktop_app.is_port_free", side_effect=lambda p, host="127.0.0.1": p == 8001):
            port, already_running = resolve_port(8000)
            self.assertEqual(port, 8001)
            self.assertFalse(already_running)


class TestSSRFAndDNSRebinding(unittest.TestCase):
    def test_ssrf_extended_ip_ranges_and_no_cache(self):
        import ipaddress
        from cache_store import is_safe_remote_url, is_ip_safe

        # Loopback IPv4 & IPv6
        self.assertFalse(is_safe_remote_url("http://127.0.0.1/"))
        self.assertFalse(is_safe_remote_url("http://127.0.0.2/"))
        self.assertFalse(is_safe_remote_url("http://[::1]/"))

        # Private ranges RFC 1918
        self.assertFalse(is_safe_remote_url("http://10.0.0.1/"))
        self.assertFalse(is_safe_remote_url("http://172.16.0.1/"))
        self.assertFalse(is_safe_remote_url("http://192.168.1.1/"))

        # Link-local & Cloud metadata
        self.assertFalse(is_safe_remote_url("http://169.254.169.254/latest/meta-data"))

        # Carrier-grade NAT (100.64.0.0/10)
        self.assertFalse(is_ip_safe(ipaddress.ip_address("100.64.0.1")))

        # IPv4-mapped IPv6
        self.assertFalse(is_ip_safe(ipaddress.ip_address("::ffff:127.0.0.1")))
        self.assertFalse(is_ip_safe(ipaddress.ip_address("::ffff:10.0.0.1")))

    def test_safe_http_adapter_blocks_dns_rebinding_at_socket_level(self):
        import requests
        from cache_store import create_safe_session, SSRFSecurityError

        sess = create_safe_session()

        # Symulacja ataku DNS Rebinding: domena zewnętrzna w momencie tworzenia gniazda TCP
        # zwraca adres pętli zwrotnej 127.0.0.1
        rebinding_gai = [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 80))]
        with patch("socket.getaddrinfo", return_value=rebinding_gai):
            with self.assertRaises((requests.exceptions.ConnectionError, SSRFSecurityError)) as ctx:
                sess.get("http://rebind-attack.example.org/internal-api", timeout=2)
            self.assertTrue("SSRF" in str(ctx.exception) or "blocked" in str(ctx.exception).lower())

    def test_safe_http_adapter_blocks_direct_loopback_connection(self):
        from cache_store import create_safe_session, SSRFSecurityError
        import requests

        sess = create_safe_session()
        with self.assertRaises((requests.exceptions.ConnectionError, SSRFSecurityError)) as ctx:
            sess.get("http://127.0.0.1:9999/secret", timeout=2)
        self.assertTrue("SSRF" in str(ctx.exception) or "blocked" in str(ctx.exception).lower())


class TestDependenciesPinning(unittest.TestCase):
    def test_requirements_strictly_pinned_exact_versions(self):
        req_path = Path(__file__).resolve().parent / "requirements.txt"
        self.assertTrue(req_path.exists())
        lines = [line.strip() for line in req_path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.strip().startswith("#")]
        self.assertGreater(len(lines), 0)
        for line in lines:
            self.assertIn("==", line, f"Dependency '{line}' is not strictly pinned with '=='")
            self.assertNotIn(">=", line, f"Dependency '{line}' contains floating '>='")
            self.assertNotIn("<=", line, f"Dependency '{line}' contains '<='")

    def test_requirements_lock_exists_and_reproducible(self):
        lock_path = Path(__file__).resolve().parent / "requirements.lock"
        self.assertTrue(lock_path.exists())
        content = lock_path.read_text(encoding="utf-8")
        self.assertIn("fastapi==", content)
        self.assertIn("uvicorn==", content)
        self.assertIn("requests==", content)
        self.assertIn("urllib3==", content)


class TestRuntimePaths(unittest.TestCase):
    def test_runtime_paths_and_migration(self):
        import runtime_paths
        p = runtime_paths.get_runtime_data_dir()
        self.assertTrue(p.exists())
        self.assertEqual(runtime_paths.get_user_store_path().name, "user_store.json")
        self.assertEqual(runtime_paths.get_model_tags_path().name, "model_tags.json")


class TestVideoStartupOptimization(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_static_assets_versioned_caching_and_html_no_cache(self):
        # 1. Zasoby ze znacznikiem wersji v= mają długi immutable cache
        res_css = self.client.get("/static/style.css?v=24.0")
        self.assertEqual(res_css.status_code, 200)
        self.assertIn("max-age=31536000", res_css.headers.get("Cache-Control", ""))
        self.assertIn("immutable", res_css.headers.get("Cache-Control", ""))

        # 2. Pliki HTML zawsze są rewalidowane (no-cache)
        res_root = self.client.get("/")
        self.assertEqual(res_root.status_code, 200)
        self.assertIn("no-cache", res_root.headers.get("Cache-Control", ""))

        res_watch = self.client.get("/watch/test_vid_123")
        self.assertEqual(res_watch.status_code, 200)
        self.assertIn("no-cache", res_watch.headers.get("Cache-Control", ""))

    def test_singleflight_details_and_stream_resolution(self):
        from main import _details_cache_path, atomic_write_json, _fetch_details_singleflight
        test_id = "test_singleflight_video_999"
        p = _details_cache_path(test_id)
        
        # Zapisz w cache
        sample_data = {
            "id": test_id,
            "username": "TestModel",
            "direct_url": "https://cdn.example.org/sample_video.mp4",
            "embed_url": "https://mixdrop.ag/e/test999",
            "date": "Dzisiaj"
        }
        atomic_write_json(p, sample_data)

        # Sprawdź odczyt singleflight
        res = _fetch_details_singleflight(test_id)
        self.assertIsNotNone(res)
        self.assertEqual(res.get("direct_url"), sample_data["direct_url"])

        # Zapytanie do endpointu detali
        det_res = self.client.get(f"/api/video/details?id={test_id}")
        self.assertEqual(det_res.status_code, 200)
        json_data = det_res.json()
        self.assertEqual(json_data.get("username"), "TestModel")
        self.assertEqual(json_data.get("proxy_stream_url"), f"/api/video/stream?id={test_id}")

        # Cleanup
        try:
            import os
            os.remove(p)
        except OSError:
            pass

    def test_storyboard_workers_throttled_to_protect_playback_bandwidth(self):
        import storyboard_service
        self.assertLessEqual(storyboard_service.QUICK_WORKERS, 2, "QUICK_WORKERS should be <= 2 to avoid starving video stream bandwidth")
        self.assertLessEqual(storyboard_service.FULL_WORKERS, 2, "FULL_WORKERS should be <= 2 to avoid starving video stream bandwidth")


if __name__ == "__main__":
    unittest.main()

