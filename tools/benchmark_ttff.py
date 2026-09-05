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

def measure_run_watch(browser, video_id: str, is_cold: bool = False, timeout_sec: float = 14.0):
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
        if res and res.get("metrics") and (res["metrics"].get("first_frame") or res["metrics"].get("playing")):
            metrics = res["metrics"]
            resource_timing = res.get("timing")
            break
        time.sleep(0.05)

    context.close()
    return metrics, resource_timing

def measure_run_modal(browser, video_id: str, mode: str = "cold", timeout_sec: float = 14.0):
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
        if res and res.get("metrics") and (res["metrics"].get("first_frame") or res["metrics"].get("playing")):
            metrics = res["metrics"]
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

        iterations = 3
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
                            first_frame = m.get("first_frame") or m.get("playing")
                            ttfb = timing.get("ttfb") if timing else None
                            src = m.get("stream_src") or 0
                            meta = m.get("metadata") or 0
                            loaded = m.get("loadeddata") or 0
                            playing = m.get("playing") or 0
                            print(f"  Run {i+1}: TTFF={first_frame}ms, TTFB={ttfb}ms, meta={meta}ms, loaded={loaded}ms, playing={playing}ms", flush=True)
                            raw_runs.append({
                                "metrics": m,
                                "timing": timing,
                                "ttff": first_frame,
                                "ttfb": ttfb,
                                "stream_src": src,
                                "metadata": meta,
                                "loadeddata": loaded,
                                "playing": playing
                            })
                        else:
                            print(f"  Run {i+1}: TIMEOUT / NO FRAME", flush=True)
                    except Exception as e:
                        print(f"  Run {i+1}: ERROR {e}", flush=True)
                    time.sleep(0.2)

                ttff_vals = [r["ttff"] for r in raw_runs if r["ttff"]]
                ttfb_vals = [r["ttfb"] for r in raw_runs if r["ttfb"]]
                meta_vals = [r["metadata"] for r in raw_runs if r["metadata"]]
                loaded_vals = [r["loadeddata"] for r in raw_runs if r["loadeddata"]]
                play_vals = [r["playing"] for r in raw_runs if r["playing"]]
                src_vals = [r["stream_src"] for r in raw_runs if r["stream_src"] is not None]

                all_results[label] = {
                    "ttff": stats_summary(ttff_vals),
                    "ttfb": stats_summary(ttfb_vals),
                    "metadata": stats_summary(meta_vals),
                    "loadeddata": stats_summary(loaded_vals),
                    "playing": stats_summary(play_vals),
                    "stream_src": stats_summary(src_vals),
                    "runs": raw_runs
                }

            browser.close()

        out_path = Path("benchmark_results.json")
        out_path.write_text(json.dumps(all_results, indent=2), encoding="utf-8")
        print(f"\nSaved detailed results to {out_path.resolve()}")

        print("\n" + "=" * 80)
        print("TIME TO FIRST VIDEO FRAME (TTFF) - REAL BENCHMARK RESULTS")
        print("=" * 80)
        header = f"{'Scenario':<38} | {'Median TTFF':<12} | {'Min':<8} | {'Max':<8} | {'StdDev':<8} | {'Runs':<6}"
        print(header)
        print("-" * len(header))
        for label, res in all_results.items():
            st = res["ttff"]
            print(f"{label:<38} | {str(st['median']) + ' ms':<12} | {str(st['min']) + ' ms':<8} | {str(st['max']) + ' ms':<8} | {str(st['stddev']) + ' ms':<8} | {st['count']:<6}")

        print("\n" + "=" * 80)
        print("STAGE BREAKDOWN (MEDIANS)")
        print("=" * 80)
        stage_header = f"{'Scenario':<38} | {'Src (ms)':<9} | {'TTFB (ms)':<10} | {'Meta (ms)':<10} | {'Loaded':<9} | {'TTFF (ms)':<10} | {'Play (ms)':<10}"
        print(stage_header)
        print("-" * len(stage_header))
        for label, res in all_results.items():
            src = res["stream_src"]["median"]
            ttfb = res["ttfb"]["median"]
            meta = res["metadata"]["median"]
            loaded = res["loadeddata"]["median"]
            ttff = res["ttff"]["median"]
            play = res["playing"]["median"]
            print(f"{label:<38} | {src:<9} | {ttfb:<10} | {meta:<10} | {loaded:<9} | {ttff:<10} | {play:<10}")
    finally:
        print("Terminating benchmark server...")
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except Exception:
            server_proc.kill()

if __name__ == "__main__":
    run_benchmarks()
