import math
import os
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Optional, Tuple

from PIL import Image
import imageio_ffmpeg

from cache_store import STORYBOARD_CACHE_DIR, atomic_write_json, read_json_cache, safe_cache_key, trim_cache_directory

# v4: progressive storyboard. Najpierw bardzo lekki QUICK, potem FULL w tle.
STORYBOARD_VERSION = 4
FRAME_WIDTH = 160
FRAME_HEIGHT = 90
QUICK_FRAMES = 8
QUICK_COLUMNS = 4
FULL_MIN_FRAMES = 24
FULL_MAX_FRAMES = 48
FULL_TARGET_SECONDS_PER_FRAME = 20
QUICK_WORKERS = 3
FULL_WORKERS = 3

_MAX_STATES = 300
_state_lock = threading.Lock()
_states: Dict[str, Dict[str, object]] = {}


def _set_state(key: str, val: dict) -> None:
    with _state_lock:
        if len(_states) >= _MAX_STATES and key not in _states:
            try:
                del _states[next(iter(_states))]
            except (StopIteration, KeyError):
                pass
        _states[key] = val



def _key(video_id: str) -> str:
    return safe_cache_key(video_id)


def _paths(video_id: str, quality: str) -> Tuple[Path, Path]:
    k = _key(video_id)
    suffix = "full" if quality == "full" else "quick"
    return (
        Path(STORYBOARD_CACHE_DIR) / f"{k}.{suffix}.jpg",
        Path(STORYBOARD_CACHE_DIR) / f"{k}.{suffix}.json",
    )


def _frame_count(duration: float, quality: str) -> int:
    if quality == "quick":
        return QUICK_FRAMES
    desired = int(math.ceil(max(1.0, duration) / FULL_TARGET_SECONDS_PER_FRAME))
    return max(FULL_MIN_FRAMES, min(FULL_MAX_FRAMES, desired))


def _columns(frame_count: int, quality: str) -> int:
    if quality == "quick":
        return QUICK_COLUMNS
    # Arkusz bliski kwadratowi dekoduje się i mieści w GPU lepiej niż jeden długi pasek.
    return max(6, min(12, int(math.ceil(math.sqrt(frame_count * 16 / 9)))))


def _cached_variant(video_id: str, duration: float, quality: str) -> Optional[dict]:
    sprite_path, meta_path = _paths(video_id, quality)
    meta, _ = read_json_cache(meta_path)
    if not isinstance(meta, dict) or not sprite_path.exists():
        return None
    if meta.get("version") != STORYBOARD_VERSION or meta.get("quality") != quality:
        return None
    cached_duration = float(meta.get("duration") or 0)
    if duration > 0 and cached_duration > 0 and abs(cached_duration - duration) > max(2.0, duration * 0.01):
        return None
    if int(meta.get("frame_width") or 0) != FRAME_WIDTH or int(meta.get("frame_height") or 0) != FRAME_HEIGHT:
        return None
    try:
        os.utime(sprite_path, None)
        os.utime(meta_path, None)
    except OSError:
        pass
    return meta


def get_status(video_id: str, duration: float) -> dict:
    full = _cached_variant(video_id, duration, "full")
    if full:
        return {"status": "ready", **full}
    quick = _cached_variant(video_id, duration, "quick")
    k = _key(video_id)
    with _state_lock:
        state = dict(_states.get(k) or {})
    if quick:
        return {"status": "ready", **quick, "upgrade_status": state.get("upgrade_status", "building")}
    if state:
        return state
    return {"status": "missing"}


def sprite_path(video_id: str, quality: str = "best") -> Optional[Path]:
    if quality == "full":
        path, _ = _paths(video_id, "full")
        return path if path.exists() else None
    if quality == "quick":
        path, _ = _paths(video_id, "quick")
        return path if path.exists() else None
    full, _ = _paths(video_id, "full")
    if full.exists():
        return full
    quick, _ = _paths(video_id, "quick")
    return quick if quick.exists() else None


def _extract_one(ffmpeg: str, source_url: str, target: float, output_path: Path, timeout: int) -> bool:
    cmd = [
        ffmpeg,
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-ss", f"{target:.3f}",
    ]
    if source_url.startswith("http://") or source_url.startswith("https://"):
        cmd.extend(["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2"])
    cmd.extend([
        "-i", source_url,
        "-map", "0:v:0",
        "-frames:v", "1",
        "-update", "1",
        "-an", "-sn", "-dn",
        "-threads", "1",
        "-vf", f"scale={FRAME_WIDTH}:{FRAME_HEIGHT}:force_original_aspect_ratio=increase,crop={FRAME_WIDTH}:{FRAME_HEIGHT}",
        "-q:v", "7",
        "-y", str(output_path),
    ])
    try:
        result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout)
        return result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 350
    except Exception:
        return False


def _nearest_success(index: int, successful: Dict[int, Path]) -> Optional[Path]:
    if not successful:
        return None
    nearest_idx = min(successful.keys(), key=lambda k: abs(k - index))
    return successful[nearest_idx]


def _build_variant(video_id: str, duration: float, source_url: str, quality: str) -> dict:
    sprite_path_out, meta_path = _paths(video_id, quality)
    frame_count = _frame_count(duration, quality)
    columns = _columns(frame_count, quality)
    rows = int(math.ceil(frame_count / columns))
    times = [
        min(max(0.05, duration * ((i + 0.5) / frame_count)), max(0.05, duration - 0.12))
        for i in range(frame_count)
    ]

    workers = QUICK_WORKERS if quality == "quick" else FULL_WORKERS
    timeout = 14 if quality == "quick" else 20

    with tempfile.TemporaryDirectory(prefix=f"archivebate_storyboard_{quality}_") as tmp_dir:
        tmp = Path(tmp_dir)
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        successful: Dict[int, Path] = {}

        with ThreadPoolExecutor(max_workers=min(workers, frame_count)) as pool:
            futures = {}
            for i, target in enumerate(times):
                out = tmp / f"frame_{i:03d}.jpg"
                futures[pool.submit(_extract_one, ffmpeg, source_url, target, out, timeout)] = (i, out)
            for future in as_completed(futures):
                i, out = futures[future]
                try:
                    if future.result():
                        successful[i] = out
                except Exception:
                    pass

        minimum = max(4, int(frame_count * (0.42 if quality == "quick" else 0.55)))
        if len(successful) < minimum:
            raise RuntimeError(f"FFmpeg przygotował tylko {len(successful)}/{frame_count} klatek ({quality})")

        sprite = Image.new("RGB", (columns * FRAME_WIDTH, rows * FRAME_HEIGHT), (12, 12, 12))
        for i in range(frame_count):
            source = successful.get(i) or _nearest_success(i, successful)
            if not source:
                continue
            with Image.open(source) as frame:
                frame = frame.convert("RGB")
                if frame.size != (FRAME_WIDTH, FRAME_HEIGHT):
                    frame = frame.resize((FRAME_WIDTH, FRAME_HEIGHT), Image.Resampling.BILINEAR)
                x = (i % columns) * FRAME_WIDTH
                y = (i // columns) * FRAME_HEIGHT
                sprite.paste(frame, (x, y))

        tmp_sprite = sprite_path_out.with_suffix(".tmp.jpg")
        # Bez optimize/progressive: znacznie szybsze kodowanie i szybszy decode w przeglądarce.
        sprite.save(tmp_sprite, format="JPEG", quality=74, optimize=False, progressive=False, subsampling=2)
        os.replace(tmp_sprite, sprite_path_out)

    meta = {
        "version": STORYBOARD_VERSION,
        "quality": quality,
        "video_id": str(video_id),
        "duration": float(duration),
        "frame_count": frame_count,
        "columns": columns,
        "rows": rows,
        "frame_width": FRAME_WIDTH,
        "frame_height": FRAME_HEIGHT,
        "times": [round(t, 3) for t in times],
        "created_at": int(time.time()),
    }
    atomic_write_json(meta_path, meta)
    try:
        trim_cache_directory(STORYBOARD_CACHE_DIR, 500 * 1024 * 1024, preserve_suffixes=())
    except Exception:
        pass
    return meta


def start(video_id: str, duration: float, source_url: str, force: bool = False) -> dict:
    duration = float(duration or 0)
    if not video_id or duration <= 0 or not math.isfinite(duration):
        return {"status": "error", "error": "Brak poprawnego ID lub długości filmu."}

    if force:
        for quality in ("quick", "full"):
            sprite, meta = _paths(video_id, quality)
            try:
                sprite.unlink(missing_ok=True)
                meta.unlink(missing_ok=True)
            except OSError:
                pass

    full = _cached_variant(video_id, duration, "full")
    if full:
        return {"status": "ready", **full, "upgrade_status": "ready"}

    quick = _cached_variant(video_id, duration, "quick")
    k = _key(video_id)
    with _state_lock:
        current = dict(_states.get(k) or {})

    # QUICK już istnieje: oddajemy go natychmiast; FULL może nadal budować się w tle.
    if quick:
        if not current or current.get("upgrade_status") not in ("building", "ready"):
            def upgrade_worker():
                _set_state(k, {"status": "ready", **quick, "upgrade_status": "building"})
                try:
                    full_result = _build_variant(video_id, duration, source_url, "full")
                    _set_state(k, {"status": "ready", **full_result, "upgrade_status": "ready"})
                except Exception as exc:
                    _set_state(k, {"status": "ready", **quick, "upgrade_status": "error", "upgrade_error": str(exc)})
            threading.Thread(target=upgrade_worker, daemon=True, name=f"storyboard-full-{k[:8]}").start()
        return {"status": "ready", **quick, "upgrade_status": "building"}

    if current and current.get("status") == "building":
        return current
    if current and current.get("status") == "error" and not force:
        if time.time() - float(current.get("finished_at") or 0) < 30:
            return current

    _set_state(k, {"status": "building", "stage": "quick", "started_at": int(time.time())})

    def worker():
        try:
            quick_result = _build_variant(video_id, duration, source_url, "quick")
            _set_state(k, {"status": "ready", **quick_result, "upgrade_status": "building"})
            try:
                full_result = _build_variant(video_id, duration, source_url, "full")
                _set_state(k, {"status": "ready", **full_result, "upgrade_status": "ready"})
            except Exception as full_exc:
                _set_state(k, {"status": "ready", **quick_result, "upgrade_status": "error", "upgrade_error": str(full_exc)})
        except Exception as exc:
            _set_state(k, {"status": "error", "error": str(exc), "finished_at": int(time.time())})

    threading.Thread(target=worker, daemon=True, name=f"storyboard-{k[:8]}").start()
    return {"status": "building", "stage": "quick"}
