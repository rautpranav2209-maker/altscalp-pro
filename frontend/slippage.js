/**
 * AltScalp PRO — Slippage Simulation (frontend)
 * Monkey-patches placeOrder() to run each fill through simulateFill(),
 * which models realistic execution costs:
 *   - Half-spread cost
 *   - Market impact (√(size/10K) × illiquidity)
 *   - Volatility noise
 *   - Partial fills for illiquid markets
 *
 * simulateFill() is exposed on window for independent use/testing.
 */

(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────
  const MIN_FILL_RATIO = 0.5;   // Minimum fraction filled for illiquid markets
  const VOL_NOISE_FACTOR = 0.0002; // Base volatility noise per unit of vol

  // ── Core fill simulator ─────────────────────────────────────────────────────

  /**
   * Simulate realistic order fill including slippage and partial fills.
   *
   * @param {string} pair   - Pair symbol (e.g. 'SOL')
   * @param {number} size   - Order size in USD
   * @param {'long'|'short'} side - Trade direction
   * @param {'market'|'limit'} type - Order type
   * @returns {{
   *   fillPrice:  number,   // Actual execution price
   *   fillRatio:  number,   // Fraction filled [0..1]
   *   slippage:   number,   // Total slippage as fraction (negative = cost)
   *   breakdown: {
   *     halfSpread:    number,
   *     marketImpact:  number,
   *     volNoise:      number
   *   }
   * }}
   */
  function simulateFill(pair, size, side, type) {
    // Fetch live pair data from global PAIRS array
    const pairData = window.PAIRS && window.PAIRS.find(p => p.p === pair);
    const price    = pairData ? parseFloat(pairData.price) || 1 : 1;
    const sp       = pairData ? parseFloat(pairData.sp)    || 3 : 3;   // spread in bps
    const liq      = pairData ? parseFloat(pairData.liq)   || 0.5 : 0.5; // liquidity [0..1]
    const vol      = pairData ? parseFloat(pairData.vol)   || 100 : 100;  // 24h vol (millions)

    // ── Half-spread ──────────────────────────────────────────────────────────
    // sp is in bps (basis points). Half-spread is half that as a fraction.
    const halfSpreadFraction = (sp / 2) / 10000;

    // ── Market impact ────────────────────────────────────────────────────────
    // Impact = √(size / 10_000) × (1 - liquidity)
    // Larger orders and lower liquidity → more impact
    const illiquidity = Math.max(0, 1 - liq);
    const marketImpact = Math.sqrt(Math.max(0, size) / 10_000) * illiquidity;

    // ── Volatility noise ─────────────────────────────────────────────────────
    // Adds random execution noise proportional to volatility
    const volNoise = (Math.random() - 0.5) * 2 * VOL_NOISE_FACTOR * Math.sqrt(vol);

    // ── Direction ────────────────────────────────────────────────────────────
    // Longs pay the ask (positive slippage cost), shorts receive the bid
    const direction = side === 'long' ? 1 : -1;

    // Limit orders don't incur spread or market impact (they add liquidity)
    if (type === 'limit') {
      return {
        fillPrice:  price,
        fillRatio:  1,
        slippage:   0,
        breakdown:  { halfSpread: 0, marketImpact: 0, volNoise: 0 }
      };
    }

    // Total slippage fraction (cost for longs, benefit for shorts on spread/impact)
    const totalSlippage = direction * (halfSpreadFraction + marketImpact) + volNoise;

    // Adjusted fill price
    const fillPrice = Math.max(0, price * (1 + totalSlippage));

    // ── Partial fill for illiquid markets ────────────────────────────────────
    // If liquidity is very low and order is large, simulate partial fill
    let fillRatio = 1;
    if (liq < 0.4 && size > 1000) {
      // Reduce fill ratio based on illiquidity and relative order size
      const orderRelativeSize = size / Math.max(1, vol * 1e6 * 0.001); // vs 0.1% of daily vol
      fillRatio = Math.max(MIN_FILL_RATIO, 1 - illiquidity * Math.min(1, orderRelativeSize));
    }

    return {
      fillPrice:  +fillPrice.toFixed(8),
      fillRatio:  +fillRatio.toFixed(4),
      slippage:   +totalSlippage.toFixed(6),
      breakdown: {
        halfSpread:   +(direction * halfSpreadFraction).toFixed(6),
        marketImpact: +(direction * marketImpact).toFixed(6),
        volNoise:     +volNoise.toFixed(6)
      }
    };
  }

  // Expose globally for testing and direct use
  window.simulateFill = simulateFill;

  // ── Monkey-patch placeOrder ─────────────────────────────────────────────────
  function patchPlaceOrder() {
    const original = window.placeOrder;
    if (typeof original !== 'function') {
      setTimeout(patchPlaceOrder, 500);
      return;
    }

    window.placeOrder = function patchedPlaceOrder() {
      // Read current form values to calculate slippage BEFORE calling original
      const typeEl = document.getElementById('of-type');
      const qtyEl  = document.getElementById('of-qty');
      const type   = typeEl ? typeEl.value : 'market';
      const qty    = parseFloat(qtyEl ? qtyEl.value : '0') || 0;
      const pair   = window.cPair || '';
      const side   = window.OSIDE || 'long';

      // Only apply slippage to market orders
      if (type === 'market' && qty > 0 && pair) {
        const fill = simulateFill(pair, qty, side, type);

        // If partial fill, warn the user and adjust order size
        if (fill.fillRatio < 1 && qtyEl) {
          const adjustedQty = +(qty * fill.fillRatio).toFixed(2);
          qtyEl.value = adjustedQty;
          if (typeof window.showToast === 'function') {
            window.showToast(
              `Partial fill: ${(fill.fillRatio * 100).toFixed(0)}% executed (low liquidity)`,
              'warning'
            );
          }
        }

        // Patch window.PAIRS price temporarily so the original placeOrder
        // uses the slippage-adjusted fill price as the market price
        if (window.PAIRS && fill.fillPrice > 0) {
          const pairObj = window.PAIRS.find(p => p.p === pair);
          if (pairObj) {
            const originalPrice = pairObj.price;
            pairObj.price = fill.fillPrice;
            original.apply(this, arguments);
            pairObj.price = originalPrice; // restore immediately
            return;
          }
        }
      }

      // Fallback: call original unchanged
      original.apply(this, arguments);
    };

    console.debug('[slippage] placeOrder patched');
  }

  // ── Initialise ───────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchPlaceOrder);
  } else {
    patchPlaceOrder();
  }
})();
