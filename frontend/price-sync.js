/**
 * AltScalp PRO — Live Price Sync
 * Periodically calls /api/prices and patches the in-memory PAIRS array,
 * then triggers a lightweight scanner DOM update without a full rebuild.
 *
 * Include this script at the end of <body> AFTER the main app script so
 * PAIRS, buildScanner, buildCorrBars, buildMTFTable etc. are already defined.
 *
 * Usage: <script src="/frontend/price-sync.js"></script>
 */

(function () {
  'use strict';

  const POLL_INTERVAL = 10000; // 10 seconds
  const API_ENDPOINT  = '/api/prices';

  let pollTimer = null;
  let failCount  = 0;
  const MAX_FAILS = 5;

  /**
   * Merge a live price update into the global PAIRS array.
   * Only updates fields that the API returns; leaves simulator-state
   * fields (price history, orders, etc.) untouched.
   * @param {Array} livePrices - Array of { p, price, chg, vol, liq, cat } objects
   */
  function mergePrices(livePrices) {
    if (!Array.isArray(window.PAIRS) || !livePrices.length) return;

    livePrices.forEach(live => {
      const idx = window.PAIRS.findIndex(p => p.p === live.p);
      if (idx !== -1) {
        window.PAIRS[idx].price = live.price;
        window.PAIRS[idx].chg   = live.chg;
        if (live.vol) window.PAIRS[idx].vol = live.vol;
        if (live.liq) window.PAIRS[idx].liq = live.liq;
      }
    });
  }

  /**
   * Fetch live prices from the backend and apply them.
   */
  async function fetchAndApply() {
    try {
      const headers = { 'Content-Type': 'application/json' };

      // Attach Firebase auth token if available
      if (window.firebase?.auth) {
        const user = window.firebase.auth().currentUser;
        if (user) {
          try {
            const token = await user.getIdToken();
            headers['Authorization'] = `Bearer ${token}`;
          } catch { /* proceed without auth */ }
        }
      }

      const resp = await fetch(API_ENDPOINT, { headers });
      if (resp.status === 429) {
        // Back off on rate limit
        console.warn('[price-sync] Rate limited, backing off');
        stopPoll();
        setTimeout(startPoll, 60000);
        return;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json = await resp.json();
      if (Array.isArray(json.prices) && json.prices.length) {
        mergePrices(json.prices);

        // Lightweight DOM update (already defined in main app)
        if (typeof window.updateScannerPrices === 'function') {
          window.updateScannerPrices();
        }
        if (typeof window.buildMTFTable === 'function') {
          window.buildMTFTable();
        }
      }

      failCount = 0;
    } catch (err) {
      failCount++;
      console.warn('[price-sync] Fetch failed:', err.message);
      if (failCount >= MAX_FAILS) {
        console.warn('[price-sync] Too many failures — stopping live sync');
        stopPoll();
      }
    }
  }

  function startPoll() {
    if (pollTimer) return;
    fetchAndApply(); // immediate first fetch
    pollTimer = setInterval(fetchAndApply, POLL_INTERVAL);
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ── WebSocket integration (optional — connects if WS_URL is configured) ──
  const WS_URL = window.ALTSCALP_WS_URL || null;

  function connectWs() {
    if (!WS_URL) return;
    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      console.warn('[price-sync] WebSocket unavailable:', e.message);
      return;
    }

    ws.addEventListener('open', () => {
      console.log('[price-sync] WebSocket connected');
      stopPoll(); // prefer WS over polling when connected
    });

    ws.addEventListener('message', event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'prices') {
          mergePrices(msg.data);
          if (typeof window.updateScannerPrices === 'function') window.updateScannerPrices();
        } else if (msg.type === 'signal') {
          // Surface strong confirmed signals as alerts
          if (msg.data.confirmed && msg.data.action !== 'HOLD') {
            if (typeof window.addAlert === 'function') window.addAlert();
          }
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      } catch { /* ignore malformed messages */ }
    });

    ws.addEventListener('close', () => {
      console.warn('[price-sync] WebSocket closed, falling back to polling');
      startPoll();
    });

    ws.addEventListener('error', () => {
      console.warn('[price-sync] WebSocket error, falling back to polling');
      startPoll();
    });
  }

  // ── Initialise ────────────────────────────────────────────────────────────
  if (WS_URL) {
    connectWs();
  } else {
    startPoll();
  }

  // Expose for debugging
  window._priceSync = { startPoll, stopPoll, connectWs };
}());
