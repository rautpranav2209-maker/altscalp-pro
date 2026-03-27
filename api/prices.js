/**
 * AltScalp PRO — Live Price Aggregator
 * Fetches real-time cryptocurrency prices from DexScreener + CoinGecko.
 * Results are cached for 10 seconds to reduce upstream API calls.
 *
 * Response format:
 *   { SYMBOL: { price, change24h, volume }, ... }
 */

'use strict';

const DEXSCREENER_API = process.env.DEXSCREENER_API || 'https://api.dexscreener.com/latest';
const COINGECKO_API   = process.env.COINGECKO_API   || 'https://api.coingecko.com/api/v3';

// Symbols to track — DexScreener pair addresses and CoinGecko IDs
const COINGECKO_IDS = {
  BTC:  'bitcoin',
  ETH:  'ethereum',
  SOL:  'solana',
  BNB:  'binancecoin',
  AVAX: 'avalanche-2',
  MATIC:'matic-network',
  DOGE: 'dogecoin',
  XRP:  'ripple',
  ADA:  'cardano',
  LINK: 'chainlink'
};

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10_000; // 10 seconds

const cache = {
  data:      null,
  updatedAt: 0
};

function isCacheValid() {
  return cache.data !== null && (Date.now() - cache.updatedAt) < CACHE_TTL_MS;
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

/**
 * Fetch prices from CoinGecko.
 * @returns {Promise<Object>} Normalized price map
 */
async function fetchCoinGeckoPrices() {
  const ids = Object.values(COINGECKO_IDS).join(',');
  const url = `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000)
  });

  if (!res.ok) {
    throw new Error(`CoinGecko HTTP ${res.status}`);
  }

  const raw = await res.json();

  const prices = {};
  for (const [symbol, cgId] of Object.entries(COINGECKO_IDS)) {
    const entry = raw[cgId];
    if (!entry) continue;
    prices[symbol] = {
      price:     entry.usd                ?? null,
      change24h: entry.usd_24h_change     ?? null,
      volume:    entry.usd_24h_vol        ?? null,
      source:    'coingecko'
    };
  }
  return prices;
}

/**
 * Fetch prices from DexScreener for on-chain DEX tokens.
 * Falls back gracefully if the upstream is unavailable.
 * @returns {Promise<Object>} Normalized price map (may be empty on error)
 */
async function fetchDexScreenerPrices() {
  // Query a set of popular token pairs; DexScreener returns the most liquid pair.
  const tokens = [
    'solana',   // SOL/USDC on Solana
    'ethereum'  // ETH/USDC on Ethereum
  ];

  const url = `${DEXSCREENER_API}/dex/search?q=USDC`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000)
    });
  } catch (err) {
    console.warn('[prices] DexScreener fetch failed:', err.message);
    return {};
  }

  if (!res.ok) {
    console.warn(`[prices] DexScreener HTTP ${res.status}`);
    return {};
  }

  const raw = await res.json();
  const pairs = raw.pairs || [];

  const prices = {};

  for (const pair of pairs) {
    if (!pair.baseToken || !pair.priceUsd) continue;
    const symbol = pair.baseToken.symbol.toUpperCase();

    // Only override if we don't already have a higher-liquidity entry
    if (!prices[symbol] && pair.priceUsd) {
      prices[symbol] = {
        price:     parseFloat(pair.priceUsd)            || null,
        change24h: pair.priceChange?.h24                ?? null,
        volume:    parseFloat(pair.volume?.h24)         || null,
        source:    'dexscreener'
      };
    }
  }

  return prices;
}

// ── Main aggregator ──────────────────────────────────────────────────────────

/**
 * Return aggregated live prices (CoinGecko primary, DexScreener supplement).
 * Uses an in-memory cache with a 10-second TTL to reduce API load.
 *
 * @returns {Promise<Object>} { SYMBOL: { price, change24h, volume, source } }
 */
async function getLivePrices() {
  if (isCacheValid()) {
    return cache.data;
  }

  let cgPrices = {};
  let dexPrices = {};

  // Run both fetches concurrently; treat each failure independently
  const [cgResult, dexResult] = await Promise.allSettled([
    fetchCoinGeckoPrices(),
    fetchDexScreenerPrices()
  ]);

  if (cgResult.status === 'fulfilled') {
    cgPrices = cgResult.value;
  } else {
    console.warn('[prices] CoinGecko error:', cgResult.reason?.message);
  }

  if (dexResult.status === 'fulfilled') {
    dexPrices = dexResult.value;
  } else {
    console.warn('[prices] DexScreener error:', dexResult.reason?.message);
  }

  // Merge: CoinGecko takes precedence for supported symbols
  const merged = { ...dexPrices, ...cgPrices };

  if (Object.keys(merged).length === 0) {
    throw new Error('All price sources failed — no data available');
  }

  cache.data      = merged;
  cache.updatedAt = Date.now();

  return merged;
}

module.exports = { getLivePrices };
