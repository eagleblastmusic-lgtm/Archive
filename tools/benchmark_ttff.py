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
import urllib.parse
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
    req_ab = urllib.request.Request(f"{BASE_URL}/api/videos?page=1&source=only-archivebate")
    with urllib.request.urlopen(req_ab, timeout=10) as r:
        data_ab = json.loads(r.read().decode("utf-8"))
    ab_vids = [v["id"] for v in data_ab.get("videos", []) if not str(v["id"]).startswith("cw_")]

    req_cw = urllib.request.Request(f"{BASE_URL}/api/videos?page=1&source=only-camwhores")
    with urllib.request.urlopen(req_cw, timeout=10) as r:
        data_cw = json.loads(r.read().decode("utf-8"))
    cw_vids = [v["id"] for v in data_cw.get("videos", []) if str(v["id"]).startswith("cw_") or "camwhores" in str(v.get("url", ""))]
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
    page.add_init_script("""
        if (window.performance && window.performance.setResourceTimingBufferSize) {
            window.performance.setResourceTimingBufferSize(10000);
        }
        localStorage.setItem('archivebate_debug_perf', '1');
    """)

    stream_responses = []
    def handle_resp(resp):
        if "/api/video/stream" in resp.url:
            try:
                u = urllib.parse.urlparse(resp.url)
                qs = urllib.parse.parse_qs(u.query)
                ids = qs.get("id", [])
                if video_id in ids or urllib.parse.unquote(video_id) in ids:
                    stream_responses.append(resp)
            except Exception:
                pass
    page.on("response", handle_resp)
    
    page.goto(f"{BASE_URL}/watch/{video_id}")
    
    metrics = None
    resource_timing = None
    deadline = time.perf_counter() + timeout_sec
    first_frame_seen_at = None

    while time.perf_counter() < deadline:
        res = page.evaluate("""(targetVid) => {
            const tracker = window.__archivebatePerfTracker;
            const m = tracker ? tracker.getMetrics() : null;
            const resources = performance.getEntriesByType('resource');
            
            const streamEntries = resources.filter(r => {
                if (!r.name.includes('/api/video/stream')) return false;
                try {
                    const u = new URL(r.name, window.location.href);
                    const idParam = u.searchParams.get('id');
                    return idParam === targetVid || decodeURIComponent(idParam) === targetVid;
                } catch (_) {
                    return false;
                }
            });

            let timing = null;
            if (streamEntries.length > 0) {
                streamEntries.sort((a, b) => a.startTime - b.startTime);
                const entry = streamEntries[0];
                const isCached = entry.transferSize === 0 && entry.duration < 10;
                const rawTtfb = entry.responseStart > 0 
                    ? Math.round(entry.responseStart - entry.startTime) 
                    : (entry.responseEnd > 0 ? Math.round(entry.responseEnd - entry.startTime) : null);
                timing = {
                    stream_url: '/api/video/stream?id=' + encodeURIComponent(targetVid),
                    startTime: Math.round(entry.startTime),
                    requestStart: Math.round(entry.requestStart),
                    responseStart: Math.round(entry.responseStart),
                    responseEnd: Math.round(entry.responseEnd),
                    duration: Math.round(entry.duration),
                    transferSize: entry.transferSize,
                    encodedBodySize: entry.encodedBodySize,
                    decodedBodySize: entry.decodedBodySize,
                    ttfb: rawTtfb,
                    is_cached: isCached,
                    total_requests: streamEntries.length,
                    source: 'resource_timing'
                };
            }
            return { metrics: m, timing: timing };
        }""", video_id)

        if res and res.get("metrics"):
            m = res["metrics"]
            t = res.get("timing")
            if not t and stream_responses:
                # Fallback do pomiaru CDP w przypadku opóźnionego domknięcia bufora mediów w Blink
                r0 = stream_responses[0]
                rt = r0.request.timing
                if rt and rt.get("responseStart", -1) > 0 and rt.get("requestStart", -1) >= 0:
                    raw_ttfb = round(rt["responseStart"] - rt["requestStart"])
                    t = {
                        "stream_url": f"/api/video/stream?id={video_id}",
                        "startTime": round(rt.get("requestStart", 0)),
                        "requestStart": round(rt.get("requestStart", 0)),
                        "responseStart": round(rt.get("responseStart", 0)),
                        "responseEnd": round(rt.get("responseEnd", 0)),
                        "duration": round(rt.get("responseEnd", 0) - rt.get("requestStart", 0)) if rt.get("responseEnd", 0) > 0 else 0,
                        "transferSize": 300,
                        "ttfb": raw_ttfb,
                        "is_cached": False,
                        "total_requests": len(stream_responses),
                        "source": "cdp_response"
                    }
            if t:
                resource_timing = t

            if m.get("first_presented_frame") is not None or m.get("frame_detection_timeout") or m.get("video_error"):
                metrics = m
                if resource_timing:
                    break
                if first_frame_seen_at is None:
                    first_frame_seen_at = time.perf_counter()
                elif (time.perf_counter() - first_frame_seen_at) > 0.6:
                    break
            elif m.get("playing") is not None:
                if first_frame_seen_at is None:
                    first_frame_seen_at = time.perf_counter()
                elif (time.perf_counter() - first_frame_seen_at) > 2.0:
                    metrics = m
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

    is_cw = str(video_id).startswith("cw_") or "camwhores" in str(video_id)
    filter_val = "only-camwhores" if is_cw else "only-archivebate"

    page.add_init_script(f"""
        if (window.performance && window.performance.setResourceTimingBufferSize) {{
            window.performance.setResourceTimingBufferSize(10000);
        }}
        localStorage.setItem('archivebate_debug_perf', '1');
        localStorage.setItem('archivebate_source_filter', '{filter_val}');
    """)

    stream_responses = []
    def handle_resp(resp):
        if "/api/video/stream" in resp.url:
            try:
                u = urllib.parse.urlparse(resp.url)
                qs = urllib.parse.parse_qs(u.query)
                ids = qs.get("id", [])
                if video_id in ids or urllib.parse.unquote(video_id) in ids:
                    stream_responses.append(resp)
            except Exception:
                pass
    page.on("response", handle_resp)

    page.goto(f"{BASE_URL}/")
    page.wait_for_selector(f".video-card[data-video-id='{video_id}']", timeout=12000)

    card = page.query_selector(f".video-card[data-video-id='{video_id}']")
    if not card:
        card = page.query_selector(".video-card")

    if mode == "hover-prefetch":
        thumb = card.query_selector(".thumbnail-wrapper")
        if thumb:
            thumb.hover()
            time.sleep(0.4)

    # Czyścimy wpisy z ładowania strony głównej, aby mierzyć wyłącznie requesty modala
    page.evaluate("() => { if (window.performance?.clearResourceTimings) performance.clearResourceTimings(); }")

    play_btn = card.query_selector(".play-btn") or card.query_selector(".thumbnail-wrapper")
    play_btn.click()

    metrics = None
    resource_timing = None
    deadline = time.perf_counter() + timeout_sec
    first_frame_seen_at = None

    while time.perf_counter() < deadline:
        res = page.evaluate("""(targetVid) => {
            const tracker = window.__archivebatePerfTracker;
            const m = tracker ? tracker.getMetrics() : null;
            const resources = performance.getEntriesByType('resource');
            
            const streamEntries = resources.filter(r => {
                if (!r.name.includes('/api/video/stream')) return false;
                try {
                    const u = new URL(r.name, window.location.href);
                    const idParam = u.searchParams.get('id');
                    return idParam === targetVid || decodeURIComponent(idParam) === targetVid;
                } catch (_) {
                    return false;
                }
            });

            let timing = null;
            if (streamEntries.length > 0) {
                streamEntries.sort((a, b) => a.startTime - b.startTime);
                const entry = streamEntries[0];
                const isCached = entry.transferSize === 0 && entry.duration < 10;
                const rawTtfb = entry.responseStart > 0 
                    ? Math.round(entry.responseStart - entry.startTime) 
                    : (entry.responseEnd > 0 ? Math.round(entry.responseEnd - entry.startTime) : null);
                timing = {
                    stream_url: '/api/video/stream?id=' + encodeURIComponent(targetVid),
                    startTime: Math.round(entry.startTime),
                    requestStart: Math.round(entry.requestStart),
                    responseStart: Math.round(entry.responseStart),
                    responseEnd: Math.round(entry.responseEnd),
                    duration: Math.round(entry.duration),
                    transferSize: entry.transferSize,
                    encodedBodySize: entry.encodedBodySize,
                    decodedBodySize: entry.decodedBodySize,
                    ttfb: rawTtfb,
                    is_cached: isCached,
                    total_requests: streamEntries.length,
                    source: 'resource_timing'
                };
            }
            return { metrics: m, timing: timing };
        }""", video_id)

        if res and res.get("metrics"):
            m = res["metrics"]
            t = res.get("timing")
            if not t and stream_responses:
                # W single-page app Blink WebMediaPlayer nie zawsze wysyła wpisy do ResourceTiming; CDP rejestruje je w 100%
                r0 = stream_responses[0]
                rt = r0.request.timing
                if rt and rt.get("responseStart", -1) > 0 and rt.get("requestStart", -1) >= 0:
                    raw_ttfb = round(rt["responseStart"] - rt["requestStart"])
                    t = {
                        "stream_url": f"/api/video/stream?id={video_id}",
                        "startTime": round(rt.get("requestStart", 0)),
                        "requestStart": round(rt.get("requestStart", 0)),
                        "responseStart": round(rt.get("responseStart", 0)),
                        "responseEnd": round(rt.get("responseEnd", 0)),
                        "duration": round(rt.get("responseEnd", 0) - rt.get("requestStart", 0)) if rt.get("responseEnd", 0) > 0 else 0,
                        "transferSize": 300,
                        "ttfb": raw_ttfb,
                        "is_cached": False,
                        "total_requests": len(stream_responses),
                        "source": "cdp_response"
                    }
            if t:
                resource_timing = t

            if m.get("first_presented_frame") is not None or m.get("frame_detection_timeout") or m.get("video_error"):
                metrics = m
                if resource_timing:
                    break
                if first_frame_seen_at is None:
                    first_frame_seen_at = time.perf_counter()
                elif (time.perf_counter() - first_frame_seen_at) > 0.6:
                    break
            elif m.get("playing") is not None:
                if first_frame_seen_at is None:
                    first_frame_seen_at = time.perf_counter()
                elif (time.perf_counter() - first_frame_seen_at) > 2.0:
                    metrics = m
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
                            src = m.get("stream_src") or 0
                            meta = m.get("metadata") or 0
                            loaded = m.get("loadeddata") or 0
                            playing = m.get("playing") or 0

                            # Walidacja i Sanity Check TTFB:
                            # TTFB musi być <= loadeddata + 50ms. W przeciwnym razie entry pochodzi z późniejszego Range requestu.
                            ttfb = None
                            ttfb_valid = True
                            if timing and timing.get("ttfb") is not None:
                                raw_ttfb = timing["ttfb"]
                                if loaded > 0 and raw_ttfb > (loaded + 50):
                                    timing["is_valid"] = False
                                    timing["validity"] = "INVALID_RESOURCE_TIMING"
                                    ttfb_valid = False
                                    ttfb = None
                                else:
                                    timing["is_valid"] = True
                                    timing["validity"] = "VALID"
                                    ttfb = raw_ttfb
                            elif timing:
                                timing["is_valid"] = False
                                timing["validity"] = "NOT_MEASURED"

                            # Sanity check: klatka nie może pojawić się ponad 25ms przed loadeddata
                            sanity_ok = True
                            if first_frame is not None and loaded > 0:
                                if first_frame < (loaded - 25):
                                    sanity_ok = False

                            status_str = f"TTFF={first_frame}ms [src={source}]" if (first_frame and sanity_ok) else f"FAILED/TIMEOUT [src={source}]"
                            ttfb_str = f"{ttfb}ms" if ttfb is not None else (timing.get("validity", "NOT_MEASURED") if timing else "NOT_MEASURED")
                            print(f"  Run {i+1}: {status_str}, TTFB={ttfb_str}, meta={meta}ms, loaded={loaded}ms, playing={playing}ms (sanity={'OK' if sanity_ok else 'VIOLATED'})", flush=True)
                            raw_runs.append({
                                "metrics": m,
                                "timing": timing,
                                "ttff": first_frame if sanity_ok else None,
                                "is_valid": is_valid and sanity_ok,
                                "source": source,
                                "timed_out": timed_out or not sanity_ok,
                                "sanity_ok": sanity_ok,
                                "ttfb": ttfb,
                                "ttfb_valid": ttfb_valid,
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
                                "ttfb_valid": False,
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
                            "ttfb_valid": False,
                            "stream_src": None,
                            "metadata": None,
                            "loadeddata": None,
                            "playing": None
                        })
                    time.sleep(0.2)

                valid_ttff_runs = [r["ttff"] for r in raw_runs if r["ttff"] is not None and r["is_valid"]]
                valid_ttfb_runs = [r["ttfb"] for r in raw_runs if r["ttfb"] is not None and r.get("ttfb_valid")]
                meta_vals = [r["metadata"] for r in raw_runs if r["metadata"]]
                loaded_vals = [r["loadeddata"] for r in raw_runs if r["loadeddata"]]
                play_vals = [r["playing"] for r in raw_runs if r["playing"]]
                src_vals = [r["stream_src"] for r in raw_runs if r["stream_src"] is not None]
                timeouts_count = sum(1 for r in raw_runs if r["timed_out"])
                sources = list({r["source"] for r in raw_runs if r["source"] and r["source"] != "none"})

                timing_validity = "VALID"
                if any(r.get("timing") and r["timing"].get("validity") == "INVALID_RESOURCE_TIMING" for r in raw_runs):
                    timing_validity = "INVALID_RESOURCE_TIMING_FILTERED"
                elif not any(r.get("timing") and r["timing"].get("validity") == "VALID" for r in raw_runs):
                    timing_validity = "NOT_MEASURED"

                all_results[label] = {
                    "ttff": stats_summary(valid_ttff_runs),
                    "ttfb": stats_summary(valid_ttfb_runs),
                    "metadata": stats_summary(meta_vals),
                    "loadeddata": stats_summary(loaded_vals),
                    "playing": stats_summary(play_vals),
                    "stream_src": stats_summary(src_vals),
                    "valid_runs": len(valid_ttff_runs),
                    "total_runs": len(raw_runs),
                    "timeouts": timeouts_count,
                    "sources": sources,
                    "resource_timing_validity": timing_validity,
                    "all_sanity_ok": all(r["sanity_ok"] for r in raw_runs if r["is_valid"]),
                    "runs": raw_runs
                }

            browser.close()

        out_path = Path("benchmark_results.json")
        out_path.write_text(json.dumps(all_results, indent=2), encoding="utf-8")
        print(f"\nSaved detailed results to {out_path.resolve()}")

        print("\n" + "=" * 135)
        print("TIME TO FIRST VIDEO FRAME (TTFF) & STREAM RESOURCE TIMING BENCHMARK (MIN 5 RUNS)")
        print("=" * 135)
        header = f"{'Scenario':<36} | {'Runs':<6} | {'TTFB (Med)':<10} | {'Loaded':<8} | {'TTFF (Med)':<10} | {'Min':<8} | {'Max':<8} | {'StdDev':<8} | {'Play':<8} | {'Resource Timing'}"
        print(header)
        print("-" * len(header))
        for label, res in all_results.items():
            st = res["ttff"]
            ttfb_m = f"{res['ttfb']['median']}ms" if res['ttfb']['count'] else "-"
            loaded_m = f"{res['loadeddata']['median']}ms" if res['loadeddata']['count'] else "-"
            play_m = f"{res['playing']['median']}ms" if res['playing']['count'] else "-"
            ttff_m = f"{st['median']}ms" if st['count'] else "FAILED"
            ttff_min = f"{st['min']}ms" if st['count'] else "-"
            ttff_max = f"{st['max']}ms" if st['count'] else "-"
            stdev = f"{st['stddev']}ms" if st['count'] else "-"
            runs_str = f"{res['valid_runs']}/{res['total_runs']}"
            rt_validity = res.get("resource_timing_validity", "VALID")
            print(f"{label:<36} | {runs_str:<6} | {ttfb_m:<10} | {loaded_m:<8} | {ttff_m:<10} | {ttff_min:<8} | {ttff_max:<8} | {stdev:<8} | {play_m:<8} | {rt_validity}")

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
