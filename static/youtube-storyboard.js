(() => {
  'use strict';

  const memory = new Map();
  const preloadMemory = new Map();
  const upgradeWatchers = new Map();

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }

  function cacheKey(videoId, duration) {
    return `${videoId}:${Math.max(1, Math.round(Number(duration) || 0))}`;
  }

  async function preload(url, signal) {
    if (!url) throw new Error('Brak sprite_url');
    if (preloadMemory.has(url)) return preloadMemory.get(url);

    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      img.onload = async () => {
        cleanup();
        try { if (img.decode) await img.decode(); } catch (_) {}
        resolve(img);
      };
      img.onerror = () => {
        cleanup();
        preloadMemory.delete(url);
        reject(new Error('Nie udało się wczytać sprite storyboardu'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      img.src = url;
    });

    preloadMemory.set(url, promise);
    return promise;
  }

  async function fetchStatus(videoId, duration, signal) {
    const endpoint = `/api/storyboard?id=${encodeURIComponent(videoId)}&duration=${encodeURIComponent(duration)}`;
    const res = await fetch(endpoint, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`Storyboard HTTP ${res.status}`);
    return res.json();
  }

  // Tylko uruchamia generator w tle. Nie polluje i nie pobiera sprite'a.
  function warm({ videoId, duration }) {
    if (!videoId || !Number.isFinite(Number(duration)) || Number(duration) <= 0) return;
    const key = cacheKey(videoId, duration);
    const existing = memory.get(key);
    if (existing?.quality === 'full') return;
    fetch(`/api/storyboard?id=${encodeURIComponent(videoId)}&duration=${encodeURIComponent(duration)}`, {
      cache: 'no-store',
      priority: 'low'
    }).catch(() => {});
  }

  async function normalizeReadyBoard(data, signal) {
    const img = await preload(data.sprite_url, signal);
    return { ...data, _image: img };
  }

  function startUpgradeWatcher({ videoId, duration, key, signal, onUpgrade }) {
    if (!onUpgrade || upgradeWatchers.has(key)) return;

    const watcher = (async () => {
      try {
        for (let attempt = 0; attempt < 90; attempt += 1) {
          if (signal?.aborted) return;
          await sleep(attempt < 8 ? 350 : 700, signal);
          const data = await fetchStatus(videoId, duration, signal);
          if (data.status === 'ready' && data.quality === 'full' && data.sprite_url) {
            const board = await normalizeReadyBoard(data, signal);
            memory.set(key, board);
            onUpgrade(board);
            return;
          }
          if (data.status === 'error') return;
        }
      } catch (err) {
        if (err?.name !== 'AbortError') console.debug('[Storyboard upgrade]', err);
      } finally {
        upgradeWatchers.delete(key);
      }
    })();

    upgradeWatchers.set(key, watcher);
  }

  async function prepare({ videoId, duration, signal, onStatus, onUpgrade }) {
    duration = Number(duration);
    if (!videoId || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('Brak ID lub długości filmu');
    }

    const key = cacheKey(videoId, duration);
    const cached = memory.get(key);
    if (cached) {
      if (cached.quality !== 'full') startUpgradeWatcher({ videoId, duration, key, signal, onUpgrade });
      return cached;
    }

    let lastError = '';
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onStatus?.(attempt === 0 ? 'start' : 'building');
      const data = await fetchStatus(videoId, duration, signal);

      if (data.status === 'ready' && data.sprite_url) {
        const board = await normalizeReadyBoard(data, signal);
        memory.set(key, board);
        onStatus?.('ready');
        if (board.quality !== 'full') {
          startUpgradeWatcher({ videoId, duration, key, signal, onUpgrade });
        }
        return board;
      }
      if (data.status === 'error') {
        lastError = data.error || 'Nie udało się przygotować storyboardu';
        break;
      }

      // Pierwsze 2 sekundy pollujemy często, żeby nie dodawać sztucznego ~850 ms lag.
      await sleep(attempt < 12 ? 160 : 420, signal);
    }
    throw new Error(lastError || 'Przekroczono czas przygotowania storyboardu');
  }

  function ensureSpriteImage(element, board) {
    if (!element || !board || !board.sprite_url) return null;
    let img = element.querySelector(':scope > .timeline-sprite-image');
    const boardIdentity = `${board.sprite_url}|${board.frame_width}|${board.frame_height}|${board.columns}|${board.rows}`;

    if (!img) {
      img = document.createElement('img');
      img.className = 'timeline-sprite-image';
      img.alt = '';
      img.draggable = false;
      element.replaceChildren(img);
    }

    if (element.dataset.boardIdentity !== boardIdentity) {
      element.dataset.boardIdentity = boardIdentity;
      element.dataset.frameIndex = '-1';
      img.src = board.sprite_url;
      img.width = (Number(board.columns) || 1) * (Number(board.frame_width) || 160);
      img.height = (Number(board.rows) || 1) * (Number(board.frame_height) || 90);
      img.style.width = `${img.width}px`;
      img.style.height = `${img.height}px`;
      img.style.transform = 'translate3d(0,0,0)';
    }
    return img;
  }

  function applyFrame(element, board, ratio) {
    if (!element || !board || !board.sprite_url) return false;
    const count = Number(board.frame_count) || 0;
    const cols = Number(board.columns) || 1;
    const fw = Number(board.frame_width) || 160;
    const fh = Number(board.frame_height) || 90;
    if (!count) return false;

    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    const idx = Math.min(count - 1, Math.floor(clamped * count));
    const img = ensureSpriteImage(element, board);
    if (!img) return false;

    element.style.display = 'block';
    if (Number(element.dataset.frameIndex) === idx) return true;
    element.dataset.frameIndex = String(idx);

    const col = idx % cols;
    const row = Math.floor(idx / cols);
    // Tylko jeden compositor-friendly zapis na zmianę klatki. Zero clientWidth/layout readów.
    img.style.transform = `translate3d(${-col * fw}px, ${-row * fh}px, 0)`;
    return true;
  }

  function clearFrame(element) {
    if (!element) return;
    element.style.display = 'none';
  }

  window.ArchivebateYouTubeStoryboard = { warm, prepare, applyFrame, clearFrame };
})();
