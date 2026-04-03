/**
 * AltScalp PRO — Signal Engine (shared module)
 * Calculates trading signals using CORRECTED weights from PR #6:
 *   RSI multiplier:   0.15  (was 0.04)
 *   Flow weight:      1.2/1.5 (was 3.0/2.0)
 *   Order book:       0.9  (was 1.5)
 *   Volatility damping: applied EARLY, before weights
 *   Divergence protection: gentle 40% dampen (was hard flip to ±0.6)
 */

'use strict';

// ── Penalty helpers ───────────────────────────────────────────────────────────

/** Volatility penalty: high vol → smaller signal magnitude */
function vpen(vol) {
  if (!vol || vol <= 0) return 1;
  if (vol > 500) return 0.4;
  if (vol > 300) return 0.6;
  if (vol > 200) return 0.8;
  return 1;
}

/** Liquidity penalty: low liquidity → smaller signal magnitude */
function lpen(liq) {
  if (!liq || liq <= 0) return 0.5;
  if (liq < 0.3) return 0.5;
  if (liq < 0.5) return 0.7;
  return 1;
}

/** Spread penalty: wide spread → reduce signal */
function spen(sp) {
  if (!sp || sp <= 0) return 0;
  if (sp > 10) return -0.5;
  if (sp > 7) return -0.3;
  if (sp > 5) return -0.1;
  return 0;
}

// ── Core signal calculator ────────────────────────────────────────────────────

/**
 * Calculate signal score for a single pair data object.
 * All inputs are clamped to prevent outliers from dominating.
 *
 * @param {Object} d - Pair data
 * @param {number} [d.chg]   - 5m price change %
 * @param {number} [d.m5]    - 5m momentum (falls back to chg)
 * @param {number} [d.flow]  - Order flow delta [-1..1]
 * @param {number} [d.ob]    - Order book imbalance [-1..1]
 * @param {number} [d.rsi]   - RSI [0..100]
 * @param {number} [d.vd]    - Volume delta [-1..1]
 * @param {number} [d.fr]    - Funding rate
 * @param {number} [d.sp]    - Spread bps
 * @param {number} [d.sent]  - Sentiment [-1..1]
 * @param {number} [d.liq]   - Liquidity [0..1]
 * @param {number} [d.vol]   - 24h volume USD (millions)
 * @param {number} [d.corr]  - BTC correlation
 * @param {'1m'|'5m'} [tf]   - Time frame, defaults to '1m'
 * @returns {number} Signal score, clamped to ±4
 */
function calcSig(d, tf = '1m') {
  // ── Input clamping ────────────────────────────────────────────────────────
  const m5   = Math.max(-5, Math.min(5,   d.m5   !== undefined ? d.m5   : (d.chg || 0)));
  const flow = Math.max(-1, Math.min(1,   d.flow || 0));
  const ob   = Math.max(-1, Math.min(1,   d.ob   || 0));
  const rsi  = Math.max(0,  Math.min(100, d.rsi  !== undefined ? d.rsi  : 50));
  const vd   = Math.max(-1, Math.min(1,   d.vd   || 0));
  const fr   = Math.max(-0.1, Math.min(0.1, d.fr  || 0));
  const sent = Math.max(-1, Math.min(1,   d.sent || 0));

  // ── Volatility damping applied EARLY ─────────────────────────────────────
  const volDamp = vpen(d.vol);

  // ── Timeframe-adjusted flow weights (corrected) ───────────────────────────
  const wMom  = tf === '1m' ? 0.75 : 0.95;
  const wFlow = tf === '1m' ? 1.2  : 1.5;   // was 3.0/2.0

  const mom = (m5 * wMom) + (flow * wFlow);

  // ── Signal composition (corrected weights) ────────────────────────────────
  let r = volDamp * (
    mom  * 1.8           // was 2.2
    + ob   * 0.9         // was 1.5
    + (rsi - 50) * 0.15  // was 0.04
    + vd   * 1.4
    + fr   * 20
    + sent * 1.2
    + spen(d.sp)
  );

  // ── Gentle divergence protection (40% dampen, not hard flip) ─────────────
  if (m5 < -0.05 && r > 0.1) r *= 0.6;
  if (m5 > 0.05  && r < -0.1) r *= 0.6;

  // ── Safety hard-caps ──────────────────────────────────────────────────────
  if ((m5 < -0.8 || flow < -0.5) && r > 0.1) r = 0.1;
  if ((m5 >  0.8 || flow >  0.5) && r < -0.1) r = -0.1;

  // ── Apply liquidity penalty and clamp ────────────────────────────────────
  const raw = r * lpen(d.liq);
  return +Math.max(-4, Math.min(4, raw)).toFixed(3);
}

// ── Batch signal generator ────────────────────────────────────────────────────

/**
 * Generate signal scores for an array of pair data objects.
 *
 * @param {Object[]} pairs - Array of pair data objects
 * @param {'1m'|'5m'} [tf] - Time frame
 * @returns {Object[]} Pairs with added `sig` property, sorted by |sig| descending
 */
function generateSignals(pairs, tf = '1m') {
  if (!Array.isArray(pairs)) return [];
  return pairs
    .map(d => ({ ...d, sig: calcSig(d, tf) }))
    .sort((a, b) => Math.abs(b.sig) - Math.abs(a.sig));
}

module.exports = { calcSig, generateSignals, vpen, lpen, spen };
