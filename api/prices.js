/**
 * AltScalp PRO — Live Price Aggregation
 * ✅ Fetches real-time crypto prices from DexScreener and CoinGecko
 * ✅ Caches results for 10 seconds to reduce external API calls
 * ✅ Falls back gracefully when one source is unavailable
 */

'use strict';

const CACHE_TTL_MS = 10_000; // 10 seconds

// Symbols to track: { coingeckoId, dexScreenerPair }
const TRACKED_TOKENS = [
  { symbol: 'BTC',  coingeckoId: 'bitcoin',         dexPair: null },
  { symbol: 'ETH',  coingeckoId: 'ethereum',        dexPair: null },
  { symbol: 'SOL',  coingeckoId: 'solana',          dexPair: null },
  { symbol: 'BNB',  coingeckoId: 'binancecoin',     dexPair: null },
  { symbol: 'AVAX', coingeckoId: 'avalanche-2',     dexPair: null },
  { symbol: 'MATIC',coingeckoId: 'matic-network',   dexPair: null },
  { symbol: 'LINK', coingeckoId: 'chainlink',       dexPair: null },
  { symbol: 'ARB',  coingeckoId: 'arbitrum',        dexPair: null },
];

const COINGECKO_IDS = TRACKED_TOKENS.map(t => t.coingeckoId).join(',');

/** In-memory price cache */
let priceCache = null;
let cacheTimestamp = 0;

/**
 * Fetch prices from CoinGecko public API (no key required).
 * @returns {Promise<Record<string, { price: number, change24h: number, volume: number }>>}
 */
async function fetchCoinGeckoPrices() {
  const url =
    `https://api.coingecko.com/api/v3/simple/price` +
    `?ids=${COINGECKO_IDS}` +
    `&vs_currencies=usd` +
    `&include_24hr_change=true` +
    `&include_24hr_vol=true`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`CoinGecko responded with ${res.status}`);

  const data = await res.json();

  const result = {};
  for (const token of TRACKED_TOKENS) {
    const entry = data[token.coingeckoId];
    if (!entry) continue;
    result[token.symbol] = {
      price:     entry.usd             ?? null,
      change24h: entry.usd_24h_change  ?? null,
      volume:    entry.usd_24h_vol     ?? null,
      source:    'coingecko',
    };
  }
  return result;
}

/**
 * Fetch prices from DexScreener for any DEX-traded tokens not covered by CoinGecko.
 * Currently used as a supplementary source; returns an empty object if no pairs configured.
 * @returns {Promise<Record<string, { price: number, change24h: number, volume: number }>>}
 */
async function fetchDexScreenerPrices() {
  const pairsToFetch = TRACKED_TOKENS.filter(t => t.dexPair);
  if (pairsToFetch.length === 0) return {};

  const addresses = pairsToFetch.map(t => t.dexPair).join(',');
  const url = `https://api.dexscreener.com/latest/dex/pairs/ethereum/${addresses}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`DexScreener responded with ${res.status}`);

  const data = await res.json();
  const result = {};

  for (const pair of (data.pairs || [])) {
    const token = pairsToFetch.find(t => t.dexPair?.toLowerCase() === pair.pairAddress?.toLowerCase());
    if (!token) continue;
    result[token.symbol] = {
      price:     parseFloat(pair.priceUsd)       || null,
      change24h: pair.priceChange?.h24            ?? null,
      volume:    pair.volume?.h24                 ?? null,
      source:    'dexscreener',
    };
  }
  return result;
}

/**
 * Return cached prices if still fresh; otherwise re-fetch from both sources.
 * DexScreener results override CoinGecko for the same symbol when available.
 *
 * @returns {Promise<Record<string, { price: number, change24h: number, volume: number, source: string }>>}
 */
async function getLivePrices() {
  const now = Date.now();
  if (priceCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return priceCache;
  }

  // Fetch both sources in parallel; tolerate partial failures
  const [cgPrices, dexPrices] = await Promise.allSettled([
    fetchCoinGeckoPrices(),
    fetchDexScreenerPrices(),
  ]);

  const merged = {};

  if (cgPrices.status === 'fulfilled') {
    Object.assign(merged, cgPrices.value);
  } else {
    console.error('[prices] CoinGecko fetch failed:', cgPrices.reason?.message);
  }

  if (dexPrices.status === 'fulfilled') {
    // DexScreener takes precedence for DEX-native tokens
    Object.assign(merged, dexPrices.value);
  } else {
    console.error('[prices] DexScreener fetch failed:', dexPrices.reason?.message);
  }

  if (Object.keys(merged).length === 0) {
    throw new Error('All price sources failed');
  }

  priceCache     = merged;
  cacheTimestamp = now;
  return merged;
}

/**
 * Express handler for GET /api/prices
 */
async function pricesHandler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const prices = await getLivePrices();
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.status(200).json(prices);
  } catch (err) {
    console.error('[prices] Handler error:', err.message);
    return res.status(503).json({ message: 'Price data temporarily unavailable' });
  }
}

module.exports = { pricesHandler, getLivePrices };
