/**
 * AltScalp PRO — Price Sync (frontend)
 * Polls GET /api/prices every 10 seconds and patches window.PAIRS in-place.
 * Upgrades to WebSocket push when window.ALTSCALP_WS_URL is set.
 * Falls back to HTTP polling on WebSocket disconnect.
 */

(function () {
  'use strict';

  const POLL_INTERVAL_MS = 10_000;
  const RECONNECT_DELAY_MS = 5_000;
  const MAX_WS_RETRIES = 5;

  let _pollTimer = null;
  let _ws = null;
  let _wsRetries = 0;
  let _wsActive = false;

  // ── Patch PAIRS in-place ────────────────────────────────────────────────────
  function applyPrices(livePairs) {
    if (!Array.isArray(livePairs) || !livePairs.length) return;
    if (!window.PAIRS || !Array.isArray(window.PAIRS)) return;

    let updated = 0;
    for (const live of livePairs) {
      const idx = window.PAIRS.findIndex(p => p.p === live.p);
      if (idx === -1) continue;
      const existing = window.PAIRS[idx];
      // Patch only fields that are present in the live payload
      if (live.price !== undefined && live.price > 0)  existing.price = live.price;
      if (live.chg   !== undefined)  existing.chg   = live.chg;
      if (live.vol   !== undefined && live.vol > 0)   existing.vol   = live.vol;
      if (live.liq   !== undefined && live.liq > 0)   existing.liq   = live.liq;
      updated++;
    }

    // Notify any listeners that PAIRS has been updated
    if (updated > 0) {
      try { window.dispatchEvent(new CustomEvent('altscalp:prices-updated', { detail: { count: updated } })); }
      catch (_) { /* ignore */ }
    }
  }

  // ── HTTP polling ────────────────────────────────────────────────────────────
  async function pollPrices() {
    try {
      const resp = await fetch('/api/prices', { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data && Array.isArray(data.pairs)) {
        applyPrices(data.pairs);
      }
    } catch (err) {
      // Silent fail — PAIRS will just retain their last known values
      console.debug('[price-sync] Poll failed:', err.message);
    }
  }

  function startPolling() {
    if (_pollTimer) return;
    pollPrices(); // immediate first fetch
    _pollTimer = setInterval(pollPrices, POLL_INTERVAL_MS);
    console.debug('[price-sync] HTTP polling started');
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── WebSocket connection ────────────────────────────────────────────────────
  function connectWebSocket(url) {
    if (_wsRetries >= MAX_WS_RETRIES) {
      console.warn('[price-sync] Max WS retries reached, staying on HTTP polling');
      startPolling();
      return;
    }

    try {
      _ws = new WebSocket(url);
    } catch (e) {
      console.warn('[price-sync] WebSocket constructor failed:', e.message);
      startPolling();
      return;
    }

    _ws.addEventListener('open', () => {
      _wsActive = true;
      _wsRetries = 0;
      stopPolling(); // WS is active — no need to poll
      console.debug('[price-sync] WebSocket connected');
    });

    _ws.addEventListener('message', evt => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'price_tick' && Array.isArray(msg.pairs)) {
          applyPrices(msg.pairs);
        }
      } catch (_) { /* ignore malformed */ }
    });

    _ws.addEventListener('close', () => {
      _wsActive = false;
      _wsRetries++;
      console.warn('[price-sync] WebSocket disconnected, falling back to HTTP polling');
      startPolling();
      // Attempt reconnect after capped exponential backoff
      const delay = Math.min(30_000, RECONNECT_DELAY_MS * _wsRetries);
      setTimeout(() => {
        if (!_wsActive) connectWebSocket(url);
      }, delay);
    });

    _ws.addEventListener('error', () => {
      // 'close' will fire after 'error' — let that handler manage reconnect
    });
  }

  // ── Initialise ───────────────────────────────────────────────────────────────
  function init() {
    const wsUrl = window.ALTSCALP_WS_URL;
    if (wsUrl && typeof WebSocket !== 'undefined') {
      connectWebSocket(wsUrl);
    } else {
      startPolling();
    }
  }

  // Start after the DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
