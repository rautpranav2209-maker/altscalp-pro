/**
 * AltScalp PRO — Enhanced Slippage Simulation
 *
 * Provides a realistic simulateFill() function that accounts for:
 *   - Bid/ask spread
 *   - Market impact (larger orders move price against you)
 *   - Volatility-based slippage
 *   - Partial fill simulation for illiquid markets
 *
 * Include this script AFTER the main app script so it can reference PAIRS.
 *
 * Usage: <script src="/frontend/slippage.js"></script>
 */

(function () {
  'use strict';

  /**
   * Simulate a realistic fill price for a paper trade order.
   *
   * @param {string} pair     - Pair symbol, e.g. 'SOL'
   * @param {number} size     - Order size in USD
   * @param {string} side     - 'long' or 'short'
   * @param {string} [type]   - 'market' | 'limit' | 'stop' (default: 'market')
   * @param {number} [limitPrice] - Required when type is 'limit' or 'stop'
   * @returns {{ fillPrice: number, slippagePct: number, fillRatio: number, note: string }}
   */
  function simulateFill(pair, size, side, type = 'market', limitPrice = null) {
    const pairData = Array.isArray(window.PAIRS) ? window.PAIRS.find(p => p.p === pair) : null;

    const marketPrice = pairData?.price || limitPrice || 1;
    const spreadBps   = pairData?.sp   || 5;  // basis points
    const liq         = pairData?.liq  || 0.7; // 0–1
    const vol         = pairData?.vol  || 80;  // volatility score

    // ── Spread cost ───────────────────────────────────────────────────────
    // Half-spread applied in the direction that hurts the trader
    const halfSpreadPct = (spreadBps / 10000) / 2;

    // ── Market impact (larger order → worse fill) ─────────────────────────
    // Assume $10K is a "neutral" order for a mid-cap pair
    const impactFactor  = Math.sqrt(size / 10000) * (1 - liq) * 0.005; // 0–~0.5%

    // ── Volatility-based random slippage ──────────────────────────────────
    // High volatility (>150) can add extra adverse movement
    const volExtra = vol > 200 ? 0.003 : vol > 150 ? 0.002 : vol > 100 ? 0.001 : 0;
    const randSlip = (Math.random() * volExtra); // 0 to volExtra

    const totalSlippage = halfSpreadPct + impactFactor + randSlip;

    // Slippage is always adverse: longs fill higher, shorts fill lower
    const fillPrice = side === 'long'
      ? marketPrice * (1 + totalSlippage)
      : marketPrice * (1 - totalSlippage);

    // ── Partial fill simulation for illiquid markets ───────────────────────
    // Very thin liquidity (<0.4) → might not fill fully
    let fillRatio = 1.0;
    let note = '';

    if (type === 'market' && liq < 0.4 && size > 500) {
      fillRatio = Math.max(0.5, liq + Math.random() * 0.3);
      note = `Partial fill (${(fillRatio * 100).toFixed(0)}%) — thin liquidity`;
    } else if (type === 'limit') {
      // Limit orders don't incur market impact, only half-spread
      const adjPrice = side === 'long'
        ? (limitPrice || marketPrice) * (1 + halfSpreadPct)
        : (limitPrice || marketPrice) * (1 - halfSpreadPct);
      return {
        fillPrice:  +adjPrice.toFixed(8),
        slippagePct: +(halfSpreadPct * 100).toFixed(4),
        fillRatio:   1.0,
        note:        'Limit order — spread cost only'
      };
    } else if (type === 'stop') {
      // Stop orders trigger at stop price but fill at market (with slippage)
      note = 'Stop order triggered — market slippage applied';
    }

    const slippagePct = +(totalSlippage * 100).toFixed(4);

    return {
      fillPrice:  +fillPrice.toFixed(8),
      slippagePct,
      fillRatio,
      note: note || `Slippage: ${slippagePct}%`
    };
  }

  /**
   * Patch the existing placeOrder() function to apply slippage on market orders.
   * Modifies the fill price stored in the order object.
   */
  function patchPlaceOrder() {
    const original = window.placeOrder;
    if (typeof original !== 'function') return;

    window.placeOrder = function patchedPlaceOrder() {
      // Let the original function run (it creates the order)
      original.apply(this, arguments);

      // Find the most recently added market order and adjust entry price
      if (!Array.isArray(window.ORDERS) || !window.ORDERS.length) return;

      const latestIdx = window.ORDERS.length - 1;
      const ord = window.ORDERS[latestIdx];
      if (!ord || ord.type !== 'market' || ord.status !== 'filled') return;

      const fill = simulateFill(ord.pair, ord.qty, ord.side, 'market');

      // Store slippage metadata on the order without mutating entry too aggressively
      // (entry is already set; we track effective fill for analytics)
      ord.fillPrice    = fill.fillPrice;
      ord.slippagePct  = fill.slippagePct;
      ord.fillNote     = fill.note;
      ord.fillRatio    = fill.fillRatio;

      // Apply partial fill: reduce order size and return un-filled portion
      if (fill.fillRatio < 1.0) {
        const unfilled = ord.qty * (1 - fill.fillRatio);
        ord.qty       = +(ord.qty * fill.fillRatio).toFixed(2);
        if (typeof window.AVAIL === 'number') window.AVAIL += unfilled;
        if (typeof window.showToast === 'function') {
          window.showToast(fill.note, 'warning');
        }
        if (typeof window.updCapDisplay === 'function') window.updCapDisplay();
      }
    };
  }

  // ── Initialise ─────────────────────────────────────────────────────────────
  // Patch after DOM is ready so placeOrder is defined
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchPlaceOrder);
  } else {
    patchPlaceOrder();
  }

  // Expose for direct use and testing
  window.simulateFill = simulateFill;
}());
