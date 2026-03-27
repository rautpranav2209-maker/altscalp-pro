/**
 * AltScalp PRO — GET /api/prices
 * Aggregates live pair data from DexScreener (primary) / CoinGecko (fallback).
 * 10-second in-memory cache to avoid excessive upstream requests.
 * Optional Firebase auth (non-blocking) + rate limiting.
 */

'use strict';

const https = require('https');
const rateLimit = require('./middleware/rateLimit');
const authenticateToken = require('./middleware/authenticateToken');

// ── In-memory cache ───────────────────────────────────────────────────────────
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 10_000; // 10 seconds

// ── Pairs to fetch from DexScreener ──────────────────────────────────────────
const DEXSCREENER_PAIRS = [
  'SOL', 'AVAX', 'DOT', 'MATIC', 'LINK', 'NEAR', 'FTM', 'ALGO',
  'DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'MEME',
  'UNI', 'AAVE', 'CRV', 'SNX', 'SUSHI', 'MKR', 'COMP',
  'FET', 'RNDR', 'TAO', 'WLD', 'AGIX', 'OCEAN',
  'AXS', 'GALA', 'NOT', 'IMX', 'SAND', 'MANA',
  'ARB', 'OP', 'LRC', 'METIS', 'BOBA',
  'PYTH', 'W', 'ZRO', 'EIGEN', 'LDO', 'RPL'
];

// CoinGecko symbol → id mapping (for fallback)
const COINGECKO_IDS = {
  SOL: 'solana', AVAX: 'avalanche-2', DOT: 'polkadot', MATIC: 'matic-network',
  LINK: 'chainlink', NEAR: 'near', FTM: 'fantom', ALGO: 'algorand',
  DOGE: 'dogecoin', SHIB: 'shiba-inu', PEPE: 'pepe', FLOKI: 'floki',
  BONK: 'bonk', WIF: 'dogwifcoin', MEME: 'memecoin-2',
  UNI: 'uniswap', AAVE: 'aave', CRV: 'curve-dao-token', SNX: 'havven',
  SUSHI: 'sushi', MKR: 'maker', COMP: 'compound-governance-token',
  FET: 'fetch-ai', RNDR: 'render-token', TAO: 'bittensor', WLD: 'worldcoin-wld',
  AGIX: 'singularitynet', OCEAN: 'ocean-protocol',
  AXS: 'axie-infinity', GALA: 'gala', NOT: 'notcoin', IMX: 'immutable-x',
  SAND: 'the-sandbox', MANA: 'decentraland',
  ARB: 'arbitrum', OP: 'optimism', LRC: 'loopring', METIS: 'metis-token',
  BOBA: 'boba-network',
  PYTH: 'pyth-network', W: 'wormhole', ZRO: 'layerzero', EIGEN: 'eigenlayer',
  LDO: 'lido-dao', RPL: 'rocket-pool'
};

// ── HTTPS helper ──────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// ── DexScreener fetch ─────────────────────────────────────────────────────────
async function fetchDexScreener() {
  // Search for all USDT pairs; client-side filtering to DEXSCREENER_PAIRS below
  const url = `https://api.dexscreener.com/latest/dex/search?q=USDT`;
  const data = await fetchJson(url);
  const pairs = data.pairs || [];

  const bySymbol = {};
  for (const p of pairs) {
    const sym = (p.baseToken?.symbol || '').toUpperCase();
    if (!DEXSCREENER_PAIRS.includes(sym)) continue;
    // Prefer higher-liquidity pairs
    if (!bySymbol[sym] || (p.liquidity?.usd || 0) > (bySymbol[sym].liquidity?.usd || 0)) {
      bySymbol[sym] = p;
    }
  }

  const result = [];
  for (const sym of DEXSCREENER_PAIRS) {
    const p = bySymbol[sym];
    if (!p) continue;
    result.push({
      p: sym,
      price: parseFloat(p.priceUsd) || 0,
      chg:   parseFloat(p.priceChange?.m5 || 0),
      vol:   (p.volume?.h24 || 0) / 1e6, // to millions
      liq:   Math.min(1, (p.liquidity?.usd || 0) / 5e6),
      ob:    0, rsi: 50, vd: 0, fr: 0, sp: 0, sent: 0, corr: 0.5,
      source: 'dexscreener'
    });
  }
  return result;
}

// ── CoinGecko fetch (fallback) ────────────────────────────────────────────────
async function fetchCoinGecko() {
  const ids = Object.values(COINGECKO_IDS).join('%2C');
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=1h%2C24h&per_page=100&order=market_cap_desc`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) throw new Error('CoinGecko returned unexpected shape');

  const idToSym = {};
  for (const [sym, id] of Object.entries(COINGECKO_IDS)) idToSym[id] = sym;

  return data.map(coin => {
    const sym = idToSym[coin.id];
    if (!sym) return null;
    // CoinGecko returns 'price_change_percentage_1h_in_currency' when vs_currency is set
    const chg1h = parseFloat(
      coin.price_change_percentage_1h_in_currency
      ?? coin.price_change_percentage_1h
      ?? 0
    );
    return {
      p:     sym,
      price: parseFloat(coin.current_price) || 0,
      chg:   chg1h,
      vol:   (coin.total_volume || 0) / 1e6,
      liq:   Math.min(1, (coin.market_cap || 0) / 1e9),
      ob:    0, rsi: 50, vd: 0, fr: 0, sp: 0, sent: 0, corr: 0.5,
      source: 'coingecko'
    };
  }).filter(Boolean);
}

// ── Main fetch with primary/fallback logic ────────────────────────────────────
async function fetchLivePrices() {
  try {
    const data = await fetchDexScreener();
    if (data.length >= 10) return data; // consider successful if ≥10 pairs
    throw new Error('DexScreener returned insufficient pairs');
  } catch (dsErr) {
    console.warn('[prices] DexScreener failed, using CoinGecko fallback:', dsErr.message);
    return await fetchCoinGecko();
  }
}

// ── Vercel serverless handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  const allowed = process.env.ALLOWED_ORIGIN || 'https://altscalp-pro.vercel.app';
  const origin  = req.headers.origin;
  if (origin === allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Optional auth (non-blocking — unauthenticated requests still get prices)
  try { await authenticateToken(req, res, () => {}); } catch (_) { /* ignore */ }

  // Rate limit (per uid or IP)
  let rateLimitPassed = false;
  await new Promise(resolve => {
    rateLimit('prices')(req, res, () => { rateLimitPassed = true; resolve(); });
    // If rateLimit calls res directly (429), the promise still resolves via the override
    if (!rateLimitPassed) resolve();
  });
  if (res.headersSent) return; // 429 was already sent

  // Serve from cache if fresh
  const now = Date.now();
  if (_cache && (now - _cacheTs) < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', `public, max-age=${Math.floor((CACHE_TTL_MS - (now - _cacheTs)) / 1000)}`);
    return res.status(200).json({ pairs: _cache, ts: _cacheTs, source: _cache[0]?.source || 'cache' });
  }

  try {
    const pairs = await fetchLivePrices();
    _cache  = pairs;
    _cacheTs = Date.now();
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`);
    return res.status(200).json({ pairs, ts: _cacheTs, source: pairs[0]?.source || 'unknown' });
  } catch (err) {
    console.error('[prices] All sources failed:', err.message);
    // Return stale cache if available
    if (_cache) {
      res.setHeader('X-Cache', 'STALE');
      return res.status(200).json({ pairs: _cache, ts: _cacheTs, source: 'stale-cache' });
    }
    return res.status(502).json({ error: 'Failed to fetch live prices', detail: err.message });
  }
};
