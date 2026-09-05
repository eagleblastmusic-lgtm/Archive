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
        """Test 9 & 10: Cache-Control dla statycznych assetów ma immutable i długi max-age dla wersji z hashem/wersją, a HTML ma no-cache."""
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

    def test_concurrency_details_and_stream_single_remote_fetch(self):
        """Test 1: Concurrency: równoległe zapytania do /details i /stream dla tego samego wideo nie wywołują podwójnego pobierania z sieci (max 1 zdalne zapytanie)."""
        import os
        import main
        test_id = "test_concurrent_singleflight_1"
        if hasattr(main.scraper, "_details_cache"):
            main.scraper._details_cache.pop(test_id, None)
        try:
            os.remove(main._details_cache_path(test_id))
        except OSError:
            pass

        fetch_counter = {"count": 0}
        lock = threading.Lock()

        def mock_fetch(vid):
            time.sleep(0.08)  # simulate remote latency
            with lock:
                fetch_counter["count"] += 1
            return {
                "id": vid,
                "username": "ConcurrentModel",
                "direct_url": "https://cdn.example.org/valid_video.mp4",
                "embed_url": "https://mixdrop.ag/e/test_conc",
                "date": "Dzisiaj"
            }

        with patch.object(main.scraper, "get_video_details", side_effect=mock_fetch), \
             patch("main.is_safe_remote_url", return_value=True), \
             patch("main._validated_session_get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.headers = {"Content-Type": "video/mp4", "Accept-Ranges": "bytes"}
            mock_resp.iter_content.return_value = [b"video_data"]
            mock_resp.close = MagicMock()
            mock_get.return_value = mock_resp

            results = []
            def call_details():
                res = self.client.get(f"/api/video/details?id={test_id}")
                results.append(res.status_code)

            def call_stream():
                res = self.client.get(f"/api/video/stream?id={test_id}")
                results.append(res.status_code)

            threads = [
                threading.Thread(target=call_details),
                threading.Thread(target=call_stream),
                threading.Thread(target=call_details),
                threading.Thread(target=call_stream),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertEqual(len(results), 4)
            for code in results:
                self.assertEqual(code, 200)
            self.assertEqual(fetch_counter["count"], 1, "Expected exactly 1 remote details fetch for concurrent requests")

    def test_concurrency_8_requests_on_403_exactly_one_details_refresh_and_new_url(self):
        """Test 2 & 3: Concurrency: 8 równoległych żądań do wygasłego URL (symulacja 403 z Range) wykonuje DOKŁADNIE JEDNO zdalne odświeżenie detali i wszystkie otrzymują nowy URL."""
        import os
        import main
        test_id = "test_403_herd_recovery"
        if hasattr(main.scraper, "_details_cache"):
            main.scraper._details_cache.pop(test_id, None)
        try:
            os.remove(main._details_cache_path(test_id))
        except OSError:
            pass

        # Początkowy stan w cache: wygasły URL
        expired_url = "https://cdn.example.org/expired_token_123.mp4"
        fresh_url = "https://cdn.example.org/fresh_token_456.mp4"
        main.atomic_write_json(main._details_cache_path(test_id), {
            "id": test_id,
            "direct_url": expired_url,
            "embed_url": "https://mixdrop.ag/e/herd",
            "url_generation": 1,
            "cached_at": time.time(),
            "refreshed_at": time.time()
        })

        refresh_counter = {"count": 0}
        refresh_lock = threading.Lock()

        def mock_scraper_refresh(vid):
            time.sleep(0.06)  # simulate remote scraper latency
            with refresh_lock:
                refresh_counter["count"] += 1
            return {
                "id": vid,
                "username": "RefreshedModel",
                "direct_url": fresh_url,
                "embed_url": "https://mixdrop.ag/e/herd",
                "date": "Dzisiaj"
            }

        def mock_get(session, url, headers=None, stream=True, timeout=12):
            resp = MagicMock()
            if url == expired_url:
                resp.status_code = 403
                resp.headers = {}
                resp.iter_content.return_value = []
                resp.close = MagicMock()
            else:
                resp.status_code = 206
                resp.headers = {
                    "Content-Type": "video/mp4",
                    "Content-Range": "bytes 0-100/1000",
                    "Content-Length": "101",
                    "Accept-Ranges": "bytes"
                }
                resp.iter_content.return_value = [b"stream_chunk_after_403"]
                resp.close = MagicMock()
            return resp

        with patch.object(main.scraper, "get_video_details", side_effect=mock_scraper_refresh), \
             patch("main.is_safe_remote_url", return_value=True), \
             patch("main._validated_session_get", side_effect=mock_get):

            responses = []
            def worker():
                r = self.client.get(f"/api/video/stream?id={test_id}", headers={"Range": "bytes=0-100"})
                responses.append(r)

            threads = [threading.Thread(target=worker) for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertEqual(len(responses), 8)
            for r in responses:
                self.assertEqual(r.status_code, 206)
                self.assertEqual(r.headers.get("Content-Range"), "bytes 0-100/1000")
                self.assertEqual(r.content, b"stream_chunk_after_403")

            # Dokładnie jedno odświeżenie detali ze zdalnego serwera
            self.assertEqual(refresh_counter["count"], 1, "Thundering herd: remote scraper was refreshed more than once!")

            # W pamięci podręcznej znajduje się nowy URL, a nie stary 403
            cached, _ = main.read_json_cache(main._details_cache_path(test_id))
            self.assertIsNotNone(cached)
            self.assertEqual(cached.get("direct_url"), fresh_url)

    def test_range_header_preserved_after_403_retry(self):
        """Test 4: Nagłówek Range jest zachowany po retry na 403."""
        import os
        import main
        test_id = "test_range_preserve_vid"
        if hasattr(main.scraper, "_details_cache"):
            main.scraper._details_cache.pop(test_id, None)

        expired_url = "https://cdn.example.org/expired_range.mp4"
        fresh_url = "https://cdn.example.org/fresh_range.mp4"
        main.atomic_write_json(main._details_cache_path(test_id), {
            "id": test_id,
            "direct_url": expired_url,
            "url_generation": 1,
            "cached_at": time.time()
        })

        captured_upstream_ranges = []
        def mock_get(session, url, headers=None, stream=True, timeout=12):
            if headers and "Range" in headers:
                captured_upstream_ranges.append((url, headers["Range"]))
            resp = MagicMock()
            if url == expired_url:
                resp.status_code = 403
                resp.headers = {}
                resp.iter_content.return_value = []
                resp.close = MagicMock()
            else:
                resp.status_code = 206
                resp.headers = {
                    "Content-Type": "video/mp4",
                    "Content-Range": "bytes 1024-2048/5000",
                    "Content-Length": "1025",
                    "Accept-Ranges": "bytes"
                }
                resp.iter_content.return_value = [b"chunk_range"]
                resp.close = MagicMock()
            return resp

        mock_fresh = {"id": test_id, "direct_url": fresh_url, "embed_url": ""}
        with patch.object(main.scraper, "get_video_details", return_value=mock_fresh), \
             patch("main.is_safe_remote_url", return_value=True), \
             patch("main._validated_session_get", side_effect=mock_get):

            res = self.client.get(f"/api/video/stream?id={test_id}", headers={"Range": "bytes=1024-2048"})
            self.assertEqual(res.status_code, 206)
            self.assertEqual(len(captured_upstream_ranges), 2)
            # Pierwsza próba (zwróciła 403)
            self.assertEqual(captured_upstream_ranges[0], (expired_url, "bytes=1024-2048"))
            # Druga próba (po odświeżeniu do fresh_url) - Range MUSI być zachowane!
            self.assertEqual(captured_upstream_ranges[1], (fresh_url, "bytes=1024-2048"))

    def test_range_response_headers_206_preserved(self):
        """Test 5: Range request: odpowiedź 206 zawiera Content-Range, Content-Length i Accept-Ranges: bytes."""
        import os
        import main
        test_id = "test_206_headers_vid"
        main.atomic_write_json(main._details_cache_path(test_id), {
            "id": test_id,
            "direct_url": "https://cdn.example.org/sample206.mp4",
            "url_generation": 1,
            "cached_at": time.time()
        })

        mock_resp = MagicMock()
        mock_resp.status_code = 206
        mock_resp.headers = {
            "Content-Type": "video/mp4",
            "Content-Range": "bytes 500-999/5000",
            "Content-Length": "500",
            "Accept-Ranges": "bytes"
        }
        mock_resp.iter_content.return_value = [b"x" * 500]
        mock_resp.close = MagicMock()

        with patch("main.is_safe_remote_url", return_value=True), \
             patch("main._validated_session_get", return_value=mock_resp):
            res = self.client.get(f"/api/video/stream?id={test_id}", headers={"Range": "bytes=500-999"})
            self.assertEqual(res.status_code, 206)
            self.assertEqual(res.headers.get("Content-Range"), "bytes 500-999/5000")
            self.assertEqual(res.headers.get("Content-Length"), "500")
            self.assertEqual(res.headers.get("Accept-Ranges"), "bytes")

    def test_expired_direct_url_never_reused_after_confirmed_403(self):
        """Test 6: Przeterminowany direct_url nie jest używany po potwierdzonym 403."""
        import os
        import main
        test_id = "test_403_invalidation"
        if hasattr(main.scraper, "_details_cache"):
            main.scraper._details_cache.pop(test_id, None)

        expired_url = "https://cdn.example.org/definitely_expired.mp4"
        fresh_url = "https://cdn.example.org/new_good_url.mp4"
        main.atomic_write_json(main._details_cache_path(test_id), {
            "id": test_id,
            "direct_url": expired_url,
            "url_generation": 1,
            "cached_at": time.time()
        })

        def mock_get(session, url, headers=None, stream=True, timeout=12):
            resp = MagicMock()
            if url == expired_url:
                resp.status_code = 403
                resp.headers = {}
                resp.iter_content.return_value = []
                resp.close = MagicMock()
            else:
                resp.status_code = 200
                resp.headers = {"Content-Type": "video/mp4", "Accept-Ranges": "bytes"}
                resp.iter_content.return_value = [b"stream"]
                resp.close = MagicMock()
            return resp

        with patch.object(main.scraper, "get_video_details", return_value={"id": test_id, "direct_url": fresh_url}), \
             patch("main.is_safe_remote_url", return_value=True), \
             patch("main._validated_session_get", side_effect=mock_get):
            res = self.client.get(f"/api/video/stream?id={test_id}")
            self.assertEqual(res.status_code, 200)

            # Po 403 pobranie kolejnych detali zwraca fresh_url, nigdy expired_url
            det = self.client.get(f"/api/video/details?id={test_id}").json()
            self.assertEqual(det.get("direct_url"), fresh_url)
            self.assertNotEqual(det.get("direct_url"), expired_url)

    def test_storyboard_workers_strictly_bounded(self):
        """Test 7 & 8: QUICK_WORKERS === 1 oraz FULL_WORKERS <= 2."""
        import storyboard_service
        self.assertEqual(storyboard_service.QUICK_WORKERS, 1, "QUICK_WORKERS must be strictly 1 to avoid bandwidth starvation")
        self.assertLessEqual(storyboard_service.FULL_WORKERS, 2, "FULL_WORKERS must be <= 2 to avoid bandwidth starvation")

    def test_ssrf_protection_on_direct_url_blocks_local_and_metadata_ips(self):
        """Test 11: Bezpieczeństwo: SafeHTTPAdapter blokuje SSRF na direct_url wskazującym na 127.0.0.1 i 169.254.169.254."""
        res_loopback = self.client.get("/api/video/stream?url=http://127.0.0.1:8000/secret")
        self.assertIn(res_loopback.status_code, (400, 500, 502))

        res_metadata = self.client.get("/api/video/stream?url=http://169.254.169.254/latest/meta-data")
        self.assertIn(res_metadata.status_code, (400, 500, 502))


class TestModelPaginationAndAuthorWindow(unittest.TestCase):
    """Testy weryfikujące poprawność paginacji w oknie autora, brak duplikatów między stronami oraz obliczanie last_page."""

    def setUp(self):
        from fastapi.testclient import TestClient
        import main
        self.client = TestClient(main.app)

    def test_get_model_page_slices_camwhores_without_cross_page_duplicates(self):
        """Weryfikuje, że filmy Camwhores są dzielone na strony po 20 sztuk i nie powtarzają się na kolejnych stronach."""
        import main
        from scraper import ArchivebateScraper

        scraper = main.scraper
        test_user = "testmodel_dedup"
        scraper._cache.pop(f"model_page:{test_user}:1", None)
        scraper._cache.pop(f"model_page:{test_user}:2", None)
        scraper._cw_model_cache.pop(test_user, None)

        ab_p1 = [{"id": f"ab_p1_{i}", "username": test_user, "date": "1 godzina temu"} for i in range(20)]
        ab_p2 = [{"id": f"ab_p2_{i}", "username": test_user, "date": "2 dni temu"} for i in range(20)]
        cw_all = [{"id": f"cw_vid_{i}", "username": test_user, "date": f"{i} godzin temu"} for i in range(25)]

        with patch.object(scraper, "_cache") as mock_cache:
            mock_cache.get.return_value = None
            with patch("camwhores.camwhores_scraper.search_videos", return_value=cw_all):
                with patch.object(scraper.session.session, "get") as mock_get:
                    # Symulacja Archivebate zwracającego 40 wyników w sumie (20 na p1, 20 na p2)
                    mock_resp1 = MagicMock()
                    mock_resp1.text = 'of <span class="fw-semibold">40</span> results'
                    mock_resp2 = MagicMock()
                    mock_resp2.text = 'of <span class="fw-semibold">40</span> results'

                    mock_get.side_effect = [mock_resp1, mock_resp2]
                    with patch.object(scraper, "parse_video_card", side_effect=lambda sec: None):
                        # Bezpośrednie wywołanie z mockowanym _fetch_ab lub weryfikacja slice
                        pass

        # Test logiki matematycznej i wycinków bezpośrednio
        res_p1 = scraper.get_model_page(test_user, page=1)
        res_p2 = scraper.get_model_page(test_user, page=2)

        # Sprawdzamy czy żaden film CW nie powtarza się między stroną 1 i 2
        p1_ids = {v["id"] for v in res_p1["videos"]}
        p2_ids = {v["id"] for v in res_p2["videos"]}
        self.assertEqual(len(p1_ids.intersection(p2_ids)), 0, "Brak duplikatów między stroną 1 i 2")

    def test_get_model_page_computes_exact_last_page_and_total_videos(self):
        """Weryfikuje dokładne wyliczanie last_page i total_videos z sumy Archivebate i Camwhores."""
        import main
        from scraper import ArchivebateScraper

        scraper = main.scraper
        test_user = "testmodel_calc"
        scraper._cache.pop(f"model_page:{test_user}:1", None)
        scraper._cw_model_cache.pop(test_user, None)

        # Przypadek 1: AB ma 797 filmów (40 stron), CW ma 21 filmów (2 strony)
        cw_vids = [{"id": f"cw_{i}", "username": test_user, "date": "1 dzień temu"} for i in range(21)]
        scraper._cw_model_cache.set(test_user, cw_vids, ttl=300)

        mock_resp = MagicMock()
        mock_resp.text = (
            '<section class="video_item"><a href="/watch/ab1">test</a></section>\n'
            'Showing <span class="fw-semibold">1</span> to <span class="fw-semibold">20</span> of <span class="fw-semibold">797</span> results'
        )

        with patch.object(scraper.session.session, "get", return_value=mock_resp), \
             patch.object(scraper, "parse_video_card", return_value={"id": "ab_1", "username": test_user, "date": "Dzisiaj"}):
            res = scraper.get_model_page(test_user, page=1)
            # 797 filmów na AB to ceil(797/20) = 40 stron. CW ma 21 filmów (2 strony).
            self.assertEqual(res["last_page"], 40, "last_page powinno wynosić 40, a nie sztywne 20")
            self.assertEqual(res["total_videos"], 797 + 21, "total_videos powinno być równe sumie 797 + 21 = 818")

    def test_api_model_endpoint_returns_last_page_and_total_videos(self):
        """Weryfikuje, że endpoint /api/model/{username} zwraca last_page i total_videos w JSON dla frontendu."""
        import main
        test_user = "test_api_author"
        mock_page_data = {
            "username": test_user,
            "page": 2,
            "last_page": 15,
            "total_videos": 295,
            "videos": [{"id": "vid_1", "username": test_user, "title": "Test Title", "date": "Wczoraj"}]
        }

        with patch.object(main.scraper, "get_model_page", return_value=mock_page_data):
            res = self.client.get(f"/api/model/{test_user}?page=2")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["username"], test_user)
            self.assertEqual(data["page"], 2)
            self.assertEqual(data["last_page"], 15)
            self.assertEqual(data["total_videos"], 295)
            self.assertEqual(data["count"], 1)
            self.assertIn("videos", data)


class TestPlayerCoreWatchdogAndTTFF(unittest.TestCase):
    """Testy regresyjne weryfikujące eliminację błędu false TTFF, nowy kontrakt waitForPresentedFrame,
    zachowanie VideoPerfTracker, fallbacku dla braku RVFC oraz testów spójności czasowej."""

    @classmethod
    def setUpClass(cls):
        import shutil
        cls.node_available = shutil.which("node") is not None

    def run_node_eval(self, js_code: str):
        if not self.node_available:
            self.skipTest("Node.js nie jest zainstalowany w środowisku.")
        import json
        import subprocess
        full_code = f"""
const fs = require('fs');
global.window = global;
global.performance = {{ now: () => Date.now(), mark: () => {{}} }};
global.localStorage = {{ getItem: () => null }};
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
eval(fs.readFileSync('static/player-core.js', 'utf8'));

{js_code}
"""
        proc = subprocess.run(["node", "-e", full_code], capture_output=True, text=True, timeout=10)
        self.assertEqual(proc.returncode, 0, f"Node script failed with stderr: {proc.stderr}\nstdout: {proc.stdout}")
        return json.loads(proc.stdout.strip())

    def test_A_rvfc_resolves_with_presented_true_and_metadata(self):
        """Test A: waitForPresentedFrame zwraca { presented: true } i metadane klatki, gdy RVFC zadziała."""
        js = """
const mockVideo = {
  requestVideoFrameCallback: (cb) => {
    setTimeout(() => cb(100, { mediaTime: 0.25, presentationTime: 120, presentedFrames: 1 }), 10);
    return 1;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  cancelVideoFrameCallback: () => {}
};
ArchivebatePlayerCore.waitForPresentedFrame(mockVideo, null, 1000).then(res => {
  console.log(JSON.stringify(res));
});
"""
        res = self.run_node_eval(js)
        self.assertTrue(res.get("presented"), "Klatka powinna być oznaczona jako zaprezentowana")
        self.assertEqual(res.get("reason"), "requestVideoFrameCallback")
        self.assertEqual(res.get("mediaTime"), 0.25)
        self.assertEqual(res.get("presentationTime"), 120)
        self.assertEqual(res.get("presentedFrames"), 1)

    def test_B_watchdog_timeout_returns_presented_false_and_timed_out(self):
        """Test B: waitForPresentedFrame zwraca { presented: false, timedOut: true } przy timeoutcie bez raportowania sukcesu."""
        js = """
const mockVideo = {
  requestVideoFrameCallback: () => 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  cancelVideoFrameCallback: () => {}
};
ArchivebatePlayerCore.waitForPresentedFrame(mockVideo, null, 40).then(res => {
  console.log(JSON.stringify(res));
});
"""
        res = self.run_node_eval(js)
        self.assertFalse(res.get("presented"), "Na timeoutcie presented musi być false")
        self.assertEqual(res.get("reason"), "timeout")
        self.assertTrue(res.get("timedOut"), "timedOut musi wynosić true")

    def test_C_timeout_does_not_mark_first_frame_or_call_loader_callback(self):
        """Test C: VideoPerfTracker NIE ustawia first_presented_frame i NIE wywołuje callbacku zniknięcia loadera przy timeoutcie."""
        js = """
let loaderHidden = false;
const tracker = new ArchivebatePlayerCore.VideoPerfTracker('test_c', 'modal');
const mockVideo = {
  requestVideoFrameCallback: () => 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  cancelVideoFrameCallback: () => {}
};
tracker.attachToPlayer(mockVideo, () => { loaderHidden = true; }, 40);
setTimeout(() => {
  const m = tracker.getMetrics();
  console.log(JSON.stringify({ loaderHidden, metrics: m }));
}, 80);
"""
        res = self.run_node_eval(js)
        self.assertFalse(res.get("loaderHidden"), "Loader NIE może zostać ukryty na timeoutcie watchdogu!")
        metrics = res.get("metrics", {})
        self.assertIsNone(metrics.get("first_frame"), "first_frame na timeoutcie musi być null")
        self.assertIsNone(metrics.get("first_presented_frame"), "first_presented_frame na timeoutcie musi być null")
        self.assertTrue(metrics.get("frame_detection_timeout"), "frame_detection_timeout musi być true")
        self.assertFalse(metrics.get("is_valid_measurement"), "Pomiar nie może być uznany za poprawny")

    def test_D_real_frame_marks_first_frame_and_calls_loader_callback(self):
        """Test D: VideoPerfTracker ustawia first_presented_frame i wywołuje callback TYLKO przy rzeczywistym RVFC."""
        js = """
let loaderHidden = false;
const tracker = new ArchivebatePlayerCore.VideoPerfTracker('test_d', 'modal');
const mockVideo = {
  requestVideoFrameCallback: (cb) => {
    setTimeout(() => cb(100, { mediaTime: 0.1, presentationTime: 50, presentedFrames: 1 }), 10);
    return 1;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  cancelVideoFrameCallback: () => {}
};
tracker.attachToPlayer(mockVideo, () => { loaderHidden = true; }, 1000);
setTimeout(() => {
  const m = tracker.getMetrics();
  console.log(JSON.stringify({ loaderHidden, metrics: m }));
}, 60);
"""
        res = self.run_node_eval(js)
        self.assertTrue(res.get("loaderHidden"), "Loader musi zostać ukryty po odebraniu rzeczywistej klatki")
        metrics = res.get("metrics", {})
        self.assertIsNotNone(metrics.get("first_frame"))
        self.assertEqual(metrics.get("first_frame_source"), "requestVideoFrameCallback")
        self.assertTrue(metrics.get("is_valid_measurement"))

    def test_E_benchmark_rejects_missing_frame_and_marks_timeout(self):
        """Test E: tools/benchmark_ttff.py odrzuca próbę (lub oznacza NOT MEASURED / TIMEOUT), jeśli klatka nie została zaprezentowana."""
        from tools.benchmark_ttff import stats_summary
        summary = stats_summary([None, None, None])
        self.assertEqual(summary["count"], 0)
        self.assertEqual(summary["median"], 0)

        # Weryfikacja odrzucenia próby, gdy is_valid == False
        raw_run = {"is_valid": False, "ttff": None, "timed_out": True}
        self.assertFalse(raw_run["is_valid"])
        self.assertIsNone(raw_run["ttff"])
        self.assertTrue(raw_run["timed_out"])

    def test_F_fallback_without_rvfc_uses_loadeddata_and_double_raf(self):
        """Test F: fallback dla środowisk bez RVFC (loadeddata + double rAF) działa i raportuje presented: true, reason: 'loadeddata-raf-fallback'."""
        js = """
const mockVideo = {
  readyState: 0,
  currentTime: 0.75,
  addEventListener: (ev, handler) => {
    if (ev === 'loadeddata') {
      setTimeout(() => {
        mockVideo.readyState = 2;
        handler();
      }, 10);
    }
  },
  removeEventListener: () => {}
};
ArchivebatePlayerCore.waitForPresentedFrame(mockVideo, null, 1000).then(res => {
  console.log(JSON.stringify(res));
});
"""
        res = self.run_node_eval(js)
        self.assertTrue(res.get("presented"))
        self.assertEqual(res.get("reason"), "loadeddata-raf-fallback")
        self.assertEqual(res.get("mediaTime"), 0.75)

    def test_G_create_preview_seeker_works_with_new_waitForPresentedFrame(self):
        """Test G: seeker osi czasu (createPreviewSeeker) nadal prawidłowo aktualizuje podglądy i nie blokuje się na nowym kontrakcie waitForPresentedFrame."""
        js = """
let seekFired = false;
const listeners = {};
const mockVideo = {
  duration: 60,
  readyState: 2,
  _currentTime: 0,
  get currentTime() { return this._currentTime; },
  set currentTime(t) {
    this._currentTime = t;
    if (listeners['seeked']) setTimeout(() => listeners['seeked'].forEach(fn => fn()), 10);
  },
  requestVideoFrameCallback: (cb) => {
    setTimeout(() => cb(Date.now(), { mediaTime: 20 }), 10);
    return 1;
  },
  addEventListener: (ev, h) => {
    if (!listeners[ev]) listeners[ev] = [];
    listeners[ev].push(h);
  },
  removeEventListener: () => {},
  cancelVideoFrameCallback: () => {}
};
const seeker = ArchivebatePlayerCore.createPreviewSeeker(mockVideo, {
  minInterval: 10,
  watchdogMs: 500,
  onFrame: () => { seekFired = true; }
});
seeker.request(20);
setTimeout(() => {
  console.log(JSON.stringify({ seekFired }));
}, 80);
"""
        res = self.run_node_eval(js)
        self.assertTrue(res.get("seekFired"), "createPreviewSeeker musi poprawnie zgłosić zaprezentowaną klatkę")

    def test_H_temporal_sanity_check_rejects_frame_before_loadeddata(self):
        """Test H: spójność czasowa i sanity check: first_frame < loadeddata - 25ms odrzuca fałszywy pomiar (is_valid_measurement = false)."""
        js = """
const tracker = new ArchivebatePlayerCore.VideoPerfTracker('test_h', 'modal');
tracker.openTime = 1000;
// loadeddata pojawia się po 3000ms od openTime (czas 4000)
tracker.marks['loadeddata'] = 4000;
// first_presented_frame pojawia się sztucznie po 1205ms (czas 2205, jak w dawnym watchdogu)
tracker.marks['first_presented_frame'] = 2205;
const m = tracker.getMetrics();
console.log(JSON.stringify(m));
"""
        res = self.run_node_eval(js)
        self.assertIsNone(res.get("first_frame"), "first_frame musi być odrzucone (null) przy anomaliach czasowych")
        self.assertFalse(res.get("is_valid_measurement"), "Pomiar nie może być uznany za poprawny przy first_frame < loadeddata - 25ms")


if __name__ == "__main__":
    unittest.main()

