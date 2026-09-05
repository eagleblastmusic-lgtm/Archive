"""
Automated Benchmark Runner for Time To First Video Frame (TTFF)
Uses Playwright headless Chromium against local Archivebate instance.
Measures 100% REAL network and rendering timings across:
1. Archivebate Cold Cache (Modal & /watch)
2. Archivebate Hover-Prefetch (>= 300ms hover before click)
3. Archivebate Warm Cache (Modal & /watch)
4. Camwhores (Modal & /watch)
"""

import json
import math
import os
import statistics
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = str(Path(__file__).resolve().parent.parent)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from playwright.sync_api import sync_playwright

BENCHMARK_PORT = 8008
BASE_URL = f"http://127.0.0.1:{BENCHMARK_PORT}"

def start_server():
    print(f"Starting benchmark server on port {BENCHMARK_PORT}...")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(BENCHMARK_PORT), "--log-level", "warning"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=REPO_ROOT
    )
    # Wait for server to become responsive
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE_URL}/api/status", timeout=1) as r:
                if r.getcode() == 200:
                    print("Benchmark server is UP and ready!")
                    return proc
        except Exception:
            time.sleep(0.3)
    raise RuntimeError("Failed to start benchmark server within 15s")

def get_clean_video_ids():
    req = urllib.request.Request(f"{BASE_URL}/api/videos?page=1")
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    vids = data.get("videos", [])
    ab_vids = [v["id"] for v in vids if not str(v["id"]).startswith("cw_") and "camwhores" not in str(v.get("url", ""))]
    cw_vids = [v["id"] for v in vids if str(v["id"]).startswith("cw_") or "camwhores" in str(v.get("url", ""))]
    return ab_vids, cw_vids

def clear_video_cache(video_id: str):
    from main import _details_cache_path, scraper
    clean_id = str(video_id).split("/")[-1].split("?")[0]
    p = Path(_details_cache_path(clean_id))
    try:
        if p.exists():
            os.remove(p)
    except OSError:
        pass
    if hasattr(scraper, "_details_cache") and clean_id in scraper._details_cache:
        scraper._details_cache.pop(clean_id, None)

def warm_video_cache(video_id: str):
    req = urllib.request.Request(f"{BASE_URL}/api/video/details?id={urllib.request.quote(video_id)}")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            _ = r.read()
    except Exception as e:
        print(f"Failed to warm cache for {video_id}: {e}")

def measure_run_watch(browser, video_id: str, is_cold: bool = False, timeout_sec: float = 16.0):
    if is_cold:
        clear_video_cache(video_id)
    else:
        warm_video_cache(video_id)

    context = browser.new_context()
    page = context.new_page()
    page.add_init_script("localStorage.setItem('archivebate_debug_perf', '1');")
    
    page.goto(f"{BASE_URL}/watch/{video_id}")
    
    metrics = None
    resource_timing = None
    deadline = time.perf_counter() + timeout_sec
    playing_seen_at = None

    while time.perf_counter() < deadline:
        res = page.evaluate("""() => {
            const tracker = window.__archivebatePerfTracker;
            const m = tracker ? tracker.getMetrics() : null;
            const resources = performance.getEntriesByType('resource');
            const streamEntry = resources.find(r => r.name.includes('/api/video/stream'));
            let timing = null;
            if (streamEntry) {
                timing = {
                    startTime: Math.round(streamEntry.startTime),
                    requestStart: Math.round(streamEntry.requestStart),
                    responseStart: Math.round(streamEntry.responseStart),
                    ttfb: Math.round(streamEntry.responseStart - streamEntry.startTime)
                };
            }
            return { metrics: m, timing: timing };
        }""")
        if res and res.get("metrics"):
            m = res["metrics"]
            if m.get("first_presented_frame") is not None or m.get("frame_detection_timeout") or m.get("video_error"):
                metrics = m
                resource_timing = res.get("timing")
                break
            if m.get("playing") is not None:
                if playing_seen_at is None:
                    playing_seen_at = time.perf_counter()
                elif (time.perf_counter() - playing_seen_at) > 2.0:
                    metrics = m
                    resource_timing = res.get("timing")
                    break
        time.sleep(0.05)

    context.close()
    return metrics, resource_timing

def measure_run_modal(browser, video_id: str, mode: str = "cold", timeout_sec: float = 16.0):
    if mode == "cold":
        clear_video_cache(video_id)
    elif mode == "warm":
        warm_video_cache(video_id)

    context = browser.new_context()
    page = context.new_page()
    page.add_init_script("localStorage.setItem('archivebate_debug_perf', '1');")

    page.goto(f"{BASE_URL}/")
    page.wait_for_selector(".video-card", timeout=10000)

    card = page.query_selector(f".video-card[data-video-id='{video_id}']")
    if not card:
        card = page.query_selector(".video-card")

    if mode == "hover-prefetch":
        thumb = card.query_selector(".thumbnail-wrapper")
        if thumb:
            thumb.hover()
            time.sleep(0.4)

    play_btn = card.query_selector(".play-btn") or card.query_selector(".thumbnail-wrapper")
    play_btn.click()

    metrics = None
    resource_timing = None
    deadline = time.perf_counter() + timeout_sec
    playing_seen_at = None

    while time.perf_counter() < deadline:
        res = page.evaluate("""() => {
            const tracker = window.__archivebatePerfTracker;
            const m = tracker ? tracker.getMetrics() : null;
            const resources = performance.getEntriesByType('resource');
            const streamEntry = resources.find(r => r.name.includes('/api/video/stream'));
            let timing = null;
            if (streamEntry) {
                timing = {
                    startTime: Math.round(streamEntry.startTime),
                    requestStart: Math.round(streamEntry.requestStart),
                    responseStart: Math.round(streamEntry.responseStart),
                    ttfb: Math.round(streamEntry.responseStart - streamEntry.startTime)
                };
            }
            return { metrics: m, timing: timing };
        }""")
        if res and res.get("metrics"):
            m = res["metrics"]
            if m.get("first_presented_frame") is not None or m.get("frame_detection_timeout") or m.get("video_error"):
                metrics = m
                resource_timing = res.get("timing")
                break
            if m.get("playing") is not None:
                if playing_seen_at is None:
                    playing_seen_at = time.perf_counter()
                elif (time.perf_counter() - playing_seen_at) > 2.0:
                    metrics = m
                    resource_timing = res.get("timing")
                    break
        time.sleep(0.05)

    context.close()
    return metrics, resource_timing

def stats_summary(values):
    cleaned = [v for v in values if v is not None and v > 0]
    if not cleaned:
        return {"median": 0, "min": 0, "max": 0, "stddev": 0, "count": 0}
    med = statistics.median(cleaned)
    mn = min(cleaned)
    mx = max(cleaned)
    stdev = statistics.stdev(cleaned) if len(cleaned) > 1 else 0.0
    return {
        "median": round(med, 1),
        "min": round(mn, 1),
        "max": round(mx, 1),
        "stddev": round(stdev, 1),
        "count": len(cleaned)
    }

def run_benchmarks():
    server_proc = start_server()
    try:
        print("Fetching live videos for benchmark...")
        ab_vids, cw_vids = get_clean_video_ids()
        if not ab_vids:
            print("No Archivebate videos found!")
            return
        if not cw_vids:
            print("No Camwhores videos found!")
            return

        test_ab_id = ab_vids[0]
        test_cw_id = cw_vids[0]
        print(f"Selected Archivebate ID: {test_ab_id}")
        print(f"Selected Camwhores ID: {test_cw_id}")

        iterations = 5
        scenarios = [
            ("Archivebate Cold (/watch)", "watch", test_ab_id, True, "cold"),
            ("Archivebate Warm (/watch)", "watch", test_ab_id, False, "warm"),
            ("Archivebate Cold (Modal)", "modal", test_ab_id, True, "cold"),
            ("Archivebate Hover-Prefetch (Modal)", "modal", test_ab_id, False, "hover-prefetch"),
            ("Archivebate Warm (Modal)", "modal", test_ab_id, False, "warm"),
            ("Camwhores Cold (/watch)", "watch", test_cw_id, True, "cold"),
            ("Camwhores Warm (/watch)", "watch", test_cw_id, False, "warm"),
            ("Camwhores Warm (Modal)", "modal", test_cw_id, False, "warm"),
        ]

        all_results = {}

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--autoplay-policy=no-user-gesture-required",
                    "--mute-audio",
                    "--no-sandbox",
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows"
                ]
            )

            for label, kind, vid, is_cold, modal_mode in scenarios:
                print(f"\n--- Running scenario: {label} ({iterations} runs) ---", flush=True)
                raw_runs = []
                for i in range(iterations):
                    try:
                        if kind == "watch":
                            m, timing = measure_run_watch(browser, vid, is_cold=is_cold)
                        else:
                            m, timing = measure_run_modal(browser, vid, mode=modal_mode)
                        
                        if m:
                            is_valid = bool(m.get("is_valid_measurement", False))
                            first_frame = m.get("first_frame") if is_valid else None
                            source = m.get("first_frame_source") or ("timeout" if m.get("frame_detection_timeout") else "none")
                            timed_out = bool(m.get("frame_detection_timeout", False)) or (first_frame is None)
                            ttfb = timing.get("ttfb") if timing else None
                            src = m.get("stream_src") or 0
                            meta = m.get("metadata") or 0
                            loaded = m.get("loadeddata") or 0
                            playing = m.get("playing") or 0

                            # Sanity check: klatka nie może pojawić się ponad 25ms przed loadeddata
                            sanity_ok = True
                            if first_frame is not None and loaded > 0:
                                if first_frame < (loaded - 25):
                                    sanity_ok = False

                            status_str = f"TTFF={first_frame}ms [src={source}]" if (first_frame and sanity_ok) else f"FAILED/TIMEOUT [src={source}]"
                            print(f"  Run {i+1}: {status_str}, TTFB={ttfb}ms, meta={meta}ms, loaded={loaded}ms, playing={playing}ms (sanity={'OK' if sanity_ok else 'VIOLATED'})", flush=True)
                            raw_runs.append({
                                "metrics": m,
                                "timing": timing,
                                "ttff": first_frame if sanity_ok else None,
                                "is_valid": is_valid and sanity_ok,
                                "source": source,
                                "timed_out": timed_out or not sanity_ok,
                                "sanity_ok": sanity_ok,
                                "ttfb": ttfb,
                                "stream_src": src,
                                "metadata": meta,
                                "loadeddata": loaded,
                                "playing": playing
                            })
                        else:
                            print(f"  Run {i+1}: TIMEOUT / NO METRICS", flush=True)
                            raw_runs.append({
                                "metrics": None,
                                "timing": None,
                                "ttff": None,
                                "is_valid": False,
                                "source": "timeout",
                                "timed_out": True,
                                "sanity_ok": False,
                                "ttfb": None,
                                "stream_src": None,
                                "metadata": None,
                                "loadeddata": None,
                                "playing": None
                            })
                    except Exception as e:
                        print(f"  Run {i+1}: ERROR {e}", flush=True)
                        raw_runs.append({
                            "metrics": None,
                            "timing": None,
                            "ttff": None,
                            "is_valid": False,
                            "source": f"error: {e}",
                            "timed_out": True,
                            "sanity_ok": False,
                            "ttfb": None,
                            "stream_src": None,
                            "metadata": None,
                            "loadeddata": None,
                            "playing": None
                        })
                    time.sleep(0.2)

                valid_ttff_runs = [r["ttff"] for r in raw_runs if r["ttff"] is not None and r["is_valid"]]
                ttfb_vals = [r["ttfb"] for r in raw_runs if r["ttfb"]]
                meta_vals = [r["metadata"] for r in raw_runs if r["metadata"]]
                loaded_vals = [r["loadeddata"] for r in raw_runs if r["loadeddata"]]
                play_vals = [r["playing"] for r in raw_runs if r["playing"]]
                src_vals = [r["stream_src"] for r in raw_runs if r["stream_src"] is not None]
                timeouts_count = sum(1 for r in raw_runs if r["timed_out"])
                sources = list({r["source"] for r in raw_runs if r["source"] and r["source"] != "none"})

                all_results[label] = {
                    "ttff": stats_summary(valid_ttff_runs),
                    "ttfb": stats_summary(ttfb_vals),
                    "metadata": stats_summary(meta_vals),
                    "loadeddata": stats_summary(loaded_vals),
                    "playing": stats_summary(play_vals),
                    "stream_src": stats_summary(src_vals),
                    "valid_runs": len(valid_ttff_runs),
                    "total_runs": len(raw_runs),
                    "timeouts": timeouts_count,
                    "sources": sources,
                    "all_sanity_ok": all(r["sanity_ok"] for r in raw_runs if r["is_valid"]),
                    "runs": raw_runs
                }

            browser.close()

        out_path = Path("benchmark_results.json")
        out_path.write_text(json.dumps(all_results, indent=2), encoding="utf-8")
        print(f"\nSaved detailed results to {out_path.resolve()}")

        print("\n" + "=" * 115)
        print("TIME TO FIRST VIDEO FRAME (TTFF) - REAL BENCHMARK RESULTS (MIN 5 RUNS PER SCENARIO)")
        print("=" * 115)
        header = f"{'Scenario':<36} | {'Runs':<6} | {'Source':<14} | {'TTFB':<8} | {'Loaded':<8} | {'TTFF (Median)':<14} | {'Min/Max':<14} | {'StdDev':<8} | {'Play':<8} | {'Timeouts':<8}"
        print(header)
        print("-" * len(header))
        for label, res in all_results.items():
            st = res["ttff"]
            ttfb_m = f"{res['ttfb']['median']}ms" if res['ttfb']['count'] else "-"
            loaded_m = f"{res['loadeddata']['median']}ms" if res['loadeddata']['count'] else "-"
            play_m = f"{res['playing']['median']}ms" if res['playing']['count'] else "-"
            ttff_m = f"{st['median']}ms" if st['count'] else "FAILED"
            min_max = f"{st['min']}/{st['max']}ms" if st['count'] else "-"
            stdev = f"{st['stddev']}ms" if st['count'] else "-"
            runs_str = f"{res['valid_runs']}/{res['total_runs']}"
            src_str = ",".join(res["sources"]) if res["sources"] else "-"
            if len(src_str) > 14:
                src_str = src_str[:11] + "..."
            print(f"{label:<36} | {runs_str:<6} | {src_str:<14} | {ttfb_m:<8} | {loaded_m:<8} | {ttff_m:<14} | {min_max:<14} | {stdev:<8} | {play_m:<8} | {res['timeouts']:<8}")

        print("\n" + "=" * 105)
        print("TEMPORAL CONSISTENCY & SANITY VERIFICATION")
        print("=" * 105)
        for label, res in all_results.items():
            st = res["ttff"]
            loaded = res["loadeddata"]["median"]
            play = res["playing"]["median"]
            if st['count'] > 0 and loaded > 0:
                diff_loaded = st['median'] - loaded
                diff_play = play - st['median'] if play > 0 else 0
                sanity_status = "PASS (first_frame >= loadeddata)" if diff_loaded >= -25 else "FAIL (first_frame < loadeddata - 25ms)"
                print(f"{label:<36}: TTFF={st['median']}ms, loadeddata={loaded}ms (diff: {diff_loaded:+0.1f}ms), playing={play}ms (diff: {diff_play:+0.1f}ms) -> {sanity_status}")
            else:
                print(f"{label:<36}: No valid frames measured")
    finally:
        print("\nTerminating benchmark server...")
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except Exception:
            server_proc.kill()

if __name__ == "__main__":
    run_benchmarks()
