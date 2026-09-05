(() => {
  'use strict';

  class ApiError extends Error {
    constructor(message, status = 0, code = 'network_error', details = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  function friendlyMessage(status, fallback = 'Nie udało się wykonać żądania.') {
    if (status === 401 || status === 403) return 'Sesja wygasła albo źródło odmówiło dostępu.';
    if (status === 404) return 'Żądany materiał nie jest już dostępny.';
    if (status === 408 || status === 504) return 'Serwer odpowiada zbyt wolno. Spróbuj ponownie.';
    if (status === 429) return 'Za dużo zapytań w krótkim czasie. Spróbuj ponownie za chwilę.';
    if (status >= 500) return 'Źródło lub lokalny serwer chwilowo nie odpowiada.';
    return fallback;
  }

  async function request(url, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12000;
    const controller = new AbortController();
    const externalSignal = options.signal;
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
    }

    const init = { ...options, signal: controller.signal };
    delete init.timeoutMs;

    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        let details = null;
        try { details = await res.json(); } catch (_) { /* noop */ }
        throw new ApiError(
          (details && (details.detail || details.message)) || friendlyMessage(res.status),
          res.status,
          'http_error',
          details
        );
      }
      return res;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (controller.signal.aborted) {
        throw new ApiError('Przekroczono czas oczekiwania na odpowiedź.', 408, 'timeout');
      }
      if (!navigator.onLine) {
        throw new ApiError('Brak połączenia z internetem.', 0, 'offline');
      }
      throw new ApiError(err && err.message ? err.message : 'Błąd połączenia.', 0, 'network_error');
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJSON(url, options = {}) {
    const res = await request(url, { cache: 'no-store', ...options });
    return res.json();
  }

  async function postJSON(url, body, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await request(url, {
      method: 'POST',
      ...options,
      headers,
      body: JSON.stringify(body ?? {})
    });
    return res.json();
  }

  window.ArchivebateAPI = { ApiError, request, getJSON, postJSON, friendlyMessage };
})();
