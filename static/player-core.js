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
  /**
   * Czeka na faktycznie zaprezentowaną klatkę wideo wysłaną do kompozytora
   * za pośrednictwem requestVideoFrameCallback (RVFC) lub bezpiecznego fallbacku loadeddata + 2x rAF.
   * Zwraca obiekt wyniku z jednoznaczną informacją czy klatka została zaprezentowana:
   * { presented: true, reason: 'requestVideoFrameCallback', mediaTime, presentationTime, presentedFrames }
   * lub w przypadku timeoutu watchdogu:
   * { presented: false, reason: 'timeout', timedOut: true }
   */
  function waitForPresentedFrame(video, expectedTime, timeoutMs = 8000) {
    if (!video) {
      return Promise.resolve({
        presented: false,
        reason: 'no-video',
        timedOut: false
      });
    }

    // Obsługa wywołań gdzie timeoutMs był przekazany jako drugi argument
    if (typeof expectedTime === 'number' && (timeoutMs === undefined || timeoutMs === 8000)) {
      if (expectedTime > 0 && expectedTime <= 5000) {
        timeoutMs = expectedTime;
        expectedTime = null;
      }
    }

    if (typeof video.requestVideoFrameCallback === 'function') {
      return new Promise(resolve => {
        let finished = false;
        let callbackId = null;
        let timer = null;
        let errorHandler = null;

        const finish = (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (errorHandler && typeof video.removeEventListener === 'function') {
            video.removeEventListener('error', errorHandler);
          }
          if (callbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
            try { video.cancelVideoFrameCallback(callbackId); } catch (_) {}
          }
          resolve(result);
        };

        try {
          callbackId = video.requestVideoFrameCallback((now, metadata) => {
            finish({
              presented: true,
              reason: 'requestVideoFrameCallback',
              timedOut: false,
              mediaTime: metadata?.mediaTime ?? (typeof video.currentTime === 'number' ? video.currentTime : null),
              presentationTime: metadata?.presentationTime ?? null,
              presentedFrames: metadata?.presentedFrames ?? null,
              now: now
            });
          });

          errorHandler = () => {
            finish({
              presented: false,
              reason: 'video-error',
              timedOut: false,
              error: video.error ? { code: video.error.code, message: video.error.message } : null
            });
          };
          video.addEventListener('error', errorHandler, { once: true });

          timer = setTimeout(() => {
            finish({
              presented: false,
              reason: 'timeout',
              timedOut: true
            });
          }, timeoutMs);
        } catch (_) {
          finish({
            presented: false,
            reason: 'exception',
            timedOut: false
          });
        }
      });
    }

    // Fallback dla przeglądarek bez requestVideoFrameCallback:
    // Czekamy na loadeddata (klatka zdekodowana w RAM) + double requestAnimationFrame (wypchnięcie do GPU/kompozytora)
    return new Promise(resolve => {
      let finished = false;
      let timer = null;
      let errorHandler = null;
      let loadedDataHandler = null;

      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (errorHandler && typeof video.removeEventListener === 'function') {
          video.removeEventListener('error', errorHandler);
        }
        if (loadedDataHandler && typeof video.removeEventListener === 'function') {
          video.removeEventListener('loadeddata', loadedDataHandler);
        }
        resolve(result);
      };

      const triggerDoubleRaf = () => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              finish({
                presented: true,
                reason: 'loadeddata-raf-fallback',
                timedOut: false,
                mediaTime: typeof video.currentTime === 'number' ? video.currentTime : null
              });
            });
          });
        } else {
          setTimeout(() => {
            finish({
              presented: true,
              reason: 'loadeddata-raf-fallback',
              timedOut: false,
              mediaTime: typeof video.currentTime === 'number' ? video.currentTime : null
            });
          }, 32);
        }
      };

      if (video.readyState >= 2) { // HAVE_CURRENT_DATA
        triggerDoubleRaf();
      } else {
        loadedDataHandler = () => {
          triggerDoubleRaf();
        };
        video.addEventListener('loadeddata', loadedDataHandler, { once: true });
      }

      errorHandler = () => {
        finish({
          presented: false,
          reason: 'video-error',
          timedOut: false,
          error: video.error ? { code: video.error.code, message: video.error.message } : null
        });
      };
      video.addEventListener('error', errorHandler, { once: true });

      timer = setTimeout(() => {
        finish({
          presented: false,
          reason: 'timeout',
          timedOut: true
        });
      }, timeoutMs);
    });
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
    let settledSerial = 0;
    let activeTarget = null;

    const settleSeek = (serial, outcome, data = {}) => {
      // Jeśli zniszczony, albo ten request nie jest bieżący, albo został już wcześniej sfinalizowany:
      if (destroyed || serial !== seekSerial || serial <= settledSerial) return;
      settledSerial = serial;
      inFlight = false;
      activeTarget = null;
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }

      // Jeżeli w międzyczasie nadszedł nowszy request (requestedTime !== null),
      // to ten request stał się nieaktualny (stale).
      // Zgodnie z wytycznymi: stale requesty są po cichu ignorowane (nie wywołują ani onFrame, ani onFrameMiss),
      // a kolejka nie zamraża się i natychmiast uruchamiany jest najnowszy request.
      const hasNewerRequest = (requestedTime !== null);

      if (!hasNewerRequest) {
        if (outcome === 'frame') {
          if (typeof options.onFrame === 'function') {
            options.onFrame(data.currentTime, data.targetTime);
          }
        } else if (outcome === 'miss') {
          if (typeof options.onFrameMiss === 'function') {
            options.onFrameMiss(data.result || { presented: false, reason: data.reason || 'unspecified' }, data.targetTime);
          }
        } else if (outcome === 'error') {
          if (typeof options.onError === 'function') {
            options.onError(data.error);
          } else if (typeof options.onFrameMiss === 'function') {
            options.onFrameMiss({ presented: false, reason: 'video-error', error: data.error }, data.targetTime);
          }
        }
      }

      if (requestedTime !== null) {
        request(requestedTime);
      }
    };

    const dispatchPresentedFrame = async (serial, targetTime) => {
      let result = null;
      try {
        result = await waitForPresentedFrame(video, targetTime, Math.min(1300, watchdogMs));
      } catch (err) {
        result = { presented: false, reason: 'exception', error: err };
      }

      if (destroyed || serial !== seekSerial || serial <= settledSerial) return;

      if (!result || !result.presented) {
        if (result?.reason === 'video-error') {
          settleSeek(serial, 'error', { result, error: result.error, targetTime });
        } else {
          settleSeek(serial, 'miss', { result, reason: result?.reason || 'unspecified', targetTime });
        }
        return;
      }

      settleSeek(serial, 'frame', { currentTime: video.currentTime, targetTime });
    };

    const onSeeked = () => {
      if (destroyed || !inFlight) return;
      const serial = seekSerial;
      const target = activeTarget;
      dispatchPresentedFrame(serial, target);
    };

    const onError = () => {
      if (destroyed || !inFlight) return;
      const serial = seekSerial;
      const target = activeTarget;
      settleSeek(serial, 'error', { error: video?.error, targetTime: target });
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
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          settleSeek(serial, 'miss', { reason: 'timeout', timedOut: true, targetTime: seekTime });
        }, watchdogMs);
        dispatchPresentedFrame(serial, seekTime);
        return;
      }

      const serial = ++seekSerial;
      inFlight = true;
      activeTarget = seekTime;
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        settleSeek(serial, 'miss', { reason: 'timeout', timedOut: true, targetTime: seekTime });
      }, watchdogMs);

      try {
        // Nie używamy fastSeek: może stale wybierać ten sam wcześniejszy keyframe.
        video.currentTime = seekTime;
      } catch (err) {
        settleSeek(serial, 'error', { error: err, targetTime: seekTime });
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
      settledSerial = seekSerial;
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

  class VideoPerfTracker {
    constructor(videoId, mode = 'modal') {
      this.videoId = String(videoId || 'unknown');
      this.mode = mode; // '/watch' or 'modal'
      this.cacheType = 'unknown'; // 'cold', 'warm', 'prefetch'
      this.marks = {};
      this.openTime = performance.now();
      this.reported = false;
      this.firstFrameSource = null;
      this.frameDetectionTimeout = false;
      this.frameMetadata = null;
      this.loaderHiddenReason = null;
      this.mark('video_open_start');
      window.__archivebatePerfTracker = this;
    }

    mark(name) {
      if (!this.marks[name]) {
        this.marks[name] = performance.now();
      }
      try {
        if (typeof performance.mark === 'function') {
          performance.mark(`archivebate:${this.videoId}:${name}`);
        }
      } catch (_) {}
    }

    markLoaderHidden(reason) {
      if (!this.marks['loader_hidden']) {
        this.loaderHiddenReason = reason || 'unknown';
        this.mark('loader_hidden');
      }
    }

    setCacheType(type) {
      this.cacheType = type;
    }

    getElapsed(name) {
      if (!this.marks[name]) return null;
      return Math.round(this.marks[name] - this.openTime);
    }

    getMetrics() {
      const firstFrameElapsed = this.getElapsed('first_presented_frame');
      const loadeddataElapsed = this.getElapsed('loadeddata');

      // Sanity check: klatka nie może pojawić się na długo przed załadowaniem danych wideo (loadeddata)
      let isValidFrame = true;
      if (firstFrameElapsed !== null && loadeddataElapsed !== null) {
        if (firstFrameElapsed < (loadeddataElapsed - 25)) {
          isValidFrame = false;
        }
      }

      return {
        videoId: this.videoId,
        mode: this.mode,
        cache: this.cacheType,
        stream_src: this.getElapsed('stream_src_set'),
        details_ready: this.getElapsed('details_request_end'),
        metadata: this.getElapsed('loadedmetadata'),
        loadeddata: loadeddataElapsed,
        first_frame: (isValidFrame && !this.frameDetectionTimeout) ? firstFrameElapsed : null,
        first_presented_frame: firstFrameElapsed,
        first_frame_source: this.firstFrameSource,
        frame_detection_timeout: this.frameDetectionTimeout,
        frame_metadata: this.frameMetadata,
        is_valid_measurement: isValidFrame && !this.frameDetectionTimeout && (firstFrameElapsed !== null),
        loader_hidden: this.getElapsed('loader_hidden'),
        loader_hidden_reason: this.loaderHiddenReason,
        playing: this.getElapsed('playing'),
        storyboard_start: this.getElapsed('storyboard_start'),
        storyboard_quick_ready: this.getElapsed('storyboard_quick_ready'),
        reported: this.reported
      };
    }

    attachToPlayer(video, onFirstFrameCallback, timeoutMs = 8000) {
      if (!video) return;

      video.addEventListener('loadedmetadata', () => {
        this.mark('loadedmetadata');
      }, { once: true });

      video.addEventListener('loadeddata', () => {
        this.mark('loadeddata');
      }, { once: true });

      video.addEventListener('canplay', () => {
        this.mark('canplay');
      }, { once: true });

      video.addEventListener('playing', () => {
        this.mark('playing');
        this.report();
      }, { once: true });

      video.addEventListener('error', () => {
        this.mark('video_error');
        this.markLoaderHidden('video-error');
        this.report();
      }, { once: true });

      waitForPresentedFrame(video, undefined, timeoutMs).then(result => {
        if (result && result.presented) {
          this.mark('first_presented_frame');
          this.firstFrameSource = result.reason;
          this.frameMetadata = {
            mediaTime: result.mediaTime,
            presentationTime: result.presentationTime,
            presentedFrames: result.presentedFrames
          };
          this.markLoaderHidden(result.reason || 'requestVideoFrameCallback');
          if (typeof onFirstFrameCallback === 'function') {
            onFirstFrameCallback(result);
          }
          this.report();
        } else {
          this.frameDetectionTimeout = true;
          this.mark('frame_detection_timeout');
          // Ważne: przy timeoutcie NIE markujemy first_presented_frame
          // i NIE wywołujemy onFirstFrameCallback (loader nie znika na timeoutcie)!
          this.report();
        }
      });
    }

    report() {
      if (this.reported) return;
      // Raportujemy gdy mamy zaprezentowaną pierwszą klatkę, stan playing lub timeout
      if (!this.marks['first_presented_frame'] && !this.marks['playing'] && !this.frameDetectionTimeout) return;
      this.reported = true;

      if (localStorage.getItem('archivebate_debug_perf') !== '1') return;

      const firstFrameDisplay = this.getElapsed('first_presented_frame') !== null
        ? `${this.getElapsed('first_presented_frame')} ms`
        : (this.frameDetectionTimeout ? 'TIMEOUT (frame detection failed)' : '-');

      const lines = [
        `\n[VIDEO PERF]`,
        `video: ${this.videoId}`,
        `mode: ${this.mode}`,
        `cache: ${this.cacheType}`,
        ``,
        `open → stream src: ${this.getElapsed('stream_src_set') ?? '-'} ms`,
        `open → details ready: ${this.getElapsed('details_request_end') ?? '-'} ms`,
        `open → metadata: ${this.getElapsed('loadedmetadata') ?? '-'} ms`,
        `open → loadeddata: ${this.getElapsed('loadeddata') ?? '-'} ms`,
        `open → FIRST PRESENTED FRAME: ${firstFrameDisplay}`,
        `first frame source: ${this.firstFrameSource || (this.frameDetectionTimeout ? 'null (detection timeout)' : '-')}`,
        `open → playing: ${this.getElapsed('playing') ?? '-'} ms`,
        `frame detection timeout: ${this.frameDetectionTimeout}`,
        ``,
        `storyboard start: ${this.getElapsed('storyboard_start') !== null ? this.getElapsed('storyboard_start') + ' ms' : 'deferred'}`,
        `quick storyboard ready: ${this.getElapsed('storyboard_quick_ready') !== null ? this.getElapsed('storyboard_quick_ready') + ' ms' : 'deferred'}`
      ];
      if (this.frameMetadata) {
        lines.push(`frame metadata: mediaTime=${this.frameMetadata.mediaTime}s, presTime=${this.frameMetadata.presentationTime}ms, frames=${this.frameMetadata.presentedFrames}`);
      }

      console.log(lines.join('\n'));
    }
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
    setupIdleTimer,
    VideoPerfTracker
  };
})();
