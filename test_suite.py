import unittest
import time
import tempfile
import threading
from pathlib import Path
from fastapi.testclient import TestClient

from main import app
from cache_store import BoundedTTLCache, safe_cache_key, atomic_write_json, read_json_cache
from camwhores import deduplicate_videos, normalize_model_name, extract_date_signature
from scraper import parse_date_to_sort_seconds, sort_videos_newest_first, extract_video_tags
from storage import UserStorage
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


if __name__ == "__main__":
    unittest.main()
