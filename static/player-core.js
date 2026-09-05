(() => {
  'use strict';

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function ratioFromPointer(event, element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width) return 0;
    return clamp((event.clientX - rect.left) / rect.width, 0, 1);
  }

  function tooltipX(event, element, halfWidth = 84) {
    const rect = element.getBoundingClientRect();
    if (!rect.width) return 0;
    const raw = event.clientX - rect.left;
    if (rect.width <= halfWidth * 2) return rect.width / 2;
    return clamp(raw, halfWidth, rect.width - halfWidth);
  }

  function nextAnimationFrame() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  /**
   * `seeked` oznacza tylko koniec operacji seek. Nie gwarantuje, że nowa klatka
   * została już wysłana do kompozytora. To było źródłem "jednego kadru".
   * requestVideoFrameCallback daje nam faktycznie zaprezentowaną klatkę.
   */
  function waitForPresentedFrame(video, expectedTime, timeoutMs = 1200) {
    if (!video) return Promise.resolve();

    if (typeof video.requestVideoFrameCallback === 'function') {
      return new Promise(resolve => {
        let finished = false;
        let callbackId = null;
        let timer = null;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (callbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
            try { video.cancelVideoFrameCallback(callbackId); } catch (_) {}
          }
          resolve();
        };

        // Callback rejestrujemy już po `seeked`, więc pierwszy zaprezentowany frame
        // jest dokładnie tym, na który chcemy czekać. Nie wymagamy idealnego mediaTime:
        // GOP/keyframe może przesunąć go o kilka klatek.
        try {
          callbackId = video.requestVideoFrameCallback(() => finish());
          timer = setTimeout(finish, timeoutMs);
        } catch (_) {
          finish();
        }
      });
    }

    return nextAnimationFrame();
  }

  function createPreviewSeeker(video, options = {}) {
    const minInterval = options.minInterval ?? 45;
    const watchdogMs = options.watchdogMs ?? 1800;
    let requestedTime = null;
    let inFlight = false;
    let timer = null;
    let watchdog = null;
    let lastSeekAt = 0;
    let destroyed = false;
    let seekSerial = 0;
    let activeTarget = null;

    const dispatchPresentedFrame = async (serial, targetTime) => {
      try {
        await waitForPresentedFrame(video, targetTime, Math.min(1300, watchdogMs));
      } catch (_) {}
      if (destroyed || serial !== seekSerial) return;
      clearTimeout(watchdog);
      inFlight = false;
      activeTarget = null;
      if (typeof options.onFrame === 'function') options.onFrame(video.currentTime, targetTime);
      if (requestedTime !== null) request(requestedTime);
    };

    const onSeeked = () => {
      if (destroyed || !inFlight) return;
      const serial = seekSerial;
      const target = activeTarget;
      dispatchPresentedFrame(serial, target);
    };

    const onError = () => {
      clearTimeout(watchdog);
      inFlight = false;
      activeTarget = null;
      if (typeof options.onError === 'function') options.onError();
      if (requestedTime !== null) request(requestedTime);
    };

    const onMetadata = () => {
      if (requestedTime !== null) request(requestedTime);
    };

    function perform() {
      if (destroyed || !video || inFlight || requestedTime === null) return;
      if (video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) return;

      const maxTime = Math.max(0, video.duration - 0.05);
      const seekTime = clamp(requestedTime, 0, maxTime);
      requestedTime = null;
      lastSeekAt = performance.now();

      // Nawet gdy target jest bardzo blisko currentTime, poczekaj na prezentację klatki.
      // Dzięki temu po zmianie src / metadata nie pokazujemy starego poster-frame.
      if (Math.abs((video.currentTime || 0) - seekTime) < 0.02) {
        const serial = ++seekSerial;
        inFlight = true;
        activeTarget = seekTime;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (serial !== seekSerial) return;
          inFlight = false;
          activeTarget = null;
          if (requestedTime !== null) request(requestedTime);
        }, watchdogMs);
        dispatchPresentedFrame(serial, seekTime);
        return;
      }

      const serial = ++seekSerial;
      inFlight = true;
      activeTarget = seekTime;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (serial !== seekSerial) return;
        inFlight = false;
        activeTarget = null;
        if (requestedTime !== null) request(requestedTime);
      }, watchdogMs);

      try {
        // Nie używamy fastSeek: może stale wybierać ten sam wcześniejszy keyframe.
        video.currentTime = seekTime;
      } catch (_) {
        onError();
      }
    }

    function request(targetTime) {
      if (destroyed || !video || !Number.isFinite(targetTime)) return;
      requestedTime = Math.max(0, targetTime);
      if (video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) return;
      if (inFlight) return;
      clearTimeout(timer);
      const delay = Math.max(0, minInterval - (performance.now() - lastSeekAt));
      timer = setTimeout(perform, delay);
    }

    function reset() {
      requestedTime = null;
      inFlight = false;
      activeTarget = null;
      seekSerial += 1; // unieważnia oczekujące callbacki starego hovera
      clearTimeout(timer);
      clearTimeout(watchdog);
    }

    function destroy() {
      destroyed = true;
      reset();
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('error', onError);
    }

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('error', onError);

    return { request, reset, destroy };
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remS = s % 60;
    if (h > 0) {
      return `${h}:${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
    }
    return `${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
  }

  function parseDurationToSeconds(durStr) {
    if (!durStr) return 0;
    const str = String(durStr).trim();
    const hMatch = str.match(/(\d+)\s*h/i);
    const mMatch = str.match(/(\d+)\s*m/i);
    if (hMatch || mMatch) {
      const h = hMatch ? parseInt(hMatch[1], 10) : 0;
      const m = mMatch ? parseInt(mMatch[1], 10) : 0;
      return h * 3600 + m * 60;
    }
    const parts = str.split(':').map(p => parseInt(p, 10));
    if (parts.length === 3 && !parts.some(isNaN)) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2 && !parts.some(isNaN)) {
      return parts[0] * 60 + parts[1];
    }
    const num = parseFloat(str);
    return Number.isFinite(num) ? num : 0;
  }

  function updateVolumeIcon(video, btn) {
    if (!btn || !video) return;
    if (video.muted || video.volume === 0) {
      btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else if (video.volume < 0.5) {
      btn.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
    } else {
      btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }
  }

  function setupVolumeControls(video, slider, btn) {
    if (!video) return;
    if (slider) {
      slider.addEventListener('input', (e) => {
        video.volume = parseFloat(e.target.value);
        video.muted = (video.volume === 0);
        updateVolumeIcon(video, btn);
      });
    }
    if (btn) {
      btn.addEventListener('click', () => {
        video.muted = !video.muted;
        if (slider && !video.muted && video.volume === 0) {
          video.volume = 0.5;
          slider.value = 0.5;
        }
        updateVolumeIcon(video, btn);
      });
    }
  }

  function setupSpeedToggle(video, btn, speeds = [1, 1.25, 1.5, 2, 0.75]) {
    if (!video || !btn) return;
    let idx = 0;
    btn.addEventListener('click', () => {
      idx = (idx + 1) % speeds.length;
      const s = speeds[idx];
      video.playbackRate = s;
      btn.innerText = `${s}x`;
    });
  }

  function setupFullscreenToggle(wrapper, btn) {
    if (!wrapper || !btn) return;
    btn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        wrapper.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  function setupIdleTimer(wrapper, controlsBar, video, timeoutMs = 2500) {
    if (!wrapper || !controlsBar || !video) return () => {};
    let timer = null;
    const reset = () => {
      controlsBar.classList.remove('idle');
      clearTimeout(timer);
      if (!video.paused) {
        timer = setTimeout(() => {
          controlsBar.classList.add('idle');
        }, timeoutMs);
      }
    };
    wrapper.addEventListener('mousemove', reset, { passive: true });
    wrapper.addEventListener('mouseleave', () => {
      if (!video.paused) controlsBar.classList.add('idle');
    }, { passive: true });
    video.addEventListener('play', reset);
    video.addEventListener('pause', () => {
      controlsBar.classList.remove('idle');
      clearTimeout(timer);
    });
    return reset;
  }

  window.ArchivebatePlayerCore = {
    clamp,
    ratioFromPointer,
    tooltipX,
    waitForPresentedFrame,
    createPreviewSeeker,
    formatTime,
    parseDurationToSeconds,
    updateVolumeIcon,
    setupVolumeControls,
    setupSpeedToggle,
    setupFullscreenToggle,
    setupIdleTimer
  };
})();
