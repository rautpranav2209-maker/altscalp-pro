/**
 * AltScalp PRO — Centralized Signal Calculation Engine
 * ✅ Single source of truth for signal math (mirrors frontend calcSig)
 * ✅ Used by /api/signals for server-side calculation and persistence
 */

/**
 * Spread penalty — wide spread reduces signal score
 * @param {number} sp - Spread in basis points
 * @returns {number}
 */
function spen(sp) {
  return sp > 10 ? -2 : sp > 7 ? -1.2 : sp > 5 ? -0.6 : sp > 3 ? -0.2 : 0;
}

/**
 * Volatility penalty — extreme volatility penalises signal
 * @param {number} v - Volatility score (0–400+)
 * @returns {number}
 */
function vpen(v) {
  return v > 280 ? 0.45 : v > 200 ? 0.60 : v > 150 ? 0.75 : v > 100 ? 0.88 : 1.0;
}

/**
 * Liquidity penalty — thin liquidity reduces signal confidence
 * @param {number} l - Liquidity score (0–1)
 * @returns {number}
 */
function lpen(l) {
  return l < 0.4 ? 0.55 : l < 0.55 ? 0.70 : l < 0.70 ? 0.85 : 1.0;
}

/**
 * Calculate a composite signal score for a trading pair.
 * Matches the frontend calcSig() implementation exactly.
 *
 * @param {Object} d - Pair data object
 * @param {number} d.chg  - 1m price change %
 * @param {number} d.ob   - Order book imbalance (-1 to +1)
 * @param {number} d.rsi  - RSI (0–100)
 * @param {number} d.vd   - Volume delta (signed)
 * @param {number} d.fr   - Funding rate (bps)
 * @param {number} d.sp   - Spread (bps)
 * @param {number} d.sent - Sentiment (-1 to +1)
 * @param {number} d.liq  - Liquidity score (0–1)
 * @param {number} d.vol  - Volatility score (0–400)
 * @param {number} d.corr - BTC correlation (0–1)
 * @returns {number} Signal score (typically –3 to +3)
 */
function calcSig(d) {
  const raw =
    d.chg  * 2.2 +
    d.ob   * 1.5 +
    (d.rsi - 50) * 0.04 +
    d.vd   * 1.4 +
    d.fr   * 20 +
    d.sent * 1.2 +
    spen(d.sp);

  return +(raw * vpen(d.vol) * lpen(d.liq)).toFixed(3);
}

/**
 * Generate both 1m and 5m signal scores for a pair.
 * @param {Object} d - Pair data object (same shape as calcSig input)
 * @returns {{ sig1m: number, sig5m: number, action: string, confidence: number }}
 */
function generateSignals(d) {
  const sig1m = calcSig(d);
  const sig5m = calcSig({
    chg:  d.chg  * 0.7,
    ob:   d.ob   * 0.85,
    rsi:  d.rsi,
    vd:   d.vd   * 0.9,
    fr:   d.fr,
    sp:   d.sp,
    sent: d.sent,
    liq:  d.liq,
    vol:  d.vol,
    corr: d.corr
  });

  const agree = (sig1m > 0.5 && sig5m > 0.5) || (sig1m < -0.5 && sig5m < -0.5);

  let action = 'HOLD';
  if (sig1m > 1.5 && agree) action = 'STRONG_LONG';
  else if (sig1m > 0.5 && agree) action = 'LONG';
  else if (sig1m < -1.5 && agree) action = 'STRONG_SHORT';
  else if (sig1m < -0.5 && agree) action = 'SHORT';

  const confidence = agree ? Math.min(100, Math.abs(sig1m) * 25 + 50) : Math.min(60, Math.abs(sig1m) * 20 + 30);

  return {
    sig1m,
    sig5m,
    action,
    confirmed: agree,
    confidence: +confidence.toFixed(1)
  };
}

module.exports = { calcSig, generateSignals, spen, vpen, lpen };
