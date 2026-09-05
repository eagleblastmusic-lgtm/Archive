(() => {
  'use strict';

  class LRUCache {
    constructor(limit = 180) {
      this.limit = Math.max(1, limit);
      this.map = new Map();
    }
    has(key) { return this.map.has(key); }
    get(key) {
      if (!this.map.has(key)) return undefined;
      const value = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, value);
      return value;
    }
    set(key, value) {
      if (this.map.has(key)) this.map.delete(key);
      this.map.set(key, value);
      while (this.map.size > this.limit) {
        const first = this.map.keys().next().value;
        this.map.delete(first);
      }
      return this;
    }
    delete(key) { return this.map.delete(key); }
    clear() { this.map.clear(); }
    get size() { return this.map.size; }
  }

  function idle(callback, timeout = 500) {
    if ('requestIdleCallback' in window) return requestIdleCallback(callback, { timeout });
    return setTimeout(callback, 32);
  }

  async function prefetchUrls(urls, { concurrency = 4, signal } = {}) {
    const queue = [...new Set((urls || []).filter(Boolean))];
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        if (signal && signal.aborted) return;
        const index = cursor++;
        try {
          await fetch(queue[index], { cache: 'force-cache', priority: 'low', signal });
        } catch (_) { /* prefetch nigdy nie blokuje UI */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  }

  window.ArchivebatePerf = { LRUCache, idle, prefetchUrls };
})();
