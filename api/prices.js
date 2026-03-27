/**
 * AltScalp PRO — Live Price Aggregation API
 * GET /api/prices
 *
 * Aggregates real-time price data from DexScreener (primary) with
 * CoinGecko as a fallback. Returns a normalised array of pair objects
 * compatible with the frontend PAIRS schema.
 *
 * ✅ Firebase ID token verified
 * ✅ Rate limited (5 req/min per user)
 * ✅ Cached in-memory for 10 seconds to reduce external API pressure
 * ✅ CORS restricted to production origin
 */

const admin = require('firebase-admin');
const { createRateLimit } = require('./middleware/rateLimit');

// ── Firebase Admin init ─────────────────────────────────────────────────────
try {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      throw new Error('Missing FIREBASE_SERVICE_ACCOUNT env var');
    }
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
} catch (e) {
  console.error('[prices] Firebase init failed:', e.message);
}

// ── Simple in-memory cache ──────────────────────────────────────────────────
const CACHE_TTL = 10000; // 10 seconds
let cache = { data: null, expiresAt: 0 };

const rateLimitMiddleware = createRateLimit({ max: 5, windowMs: 60000 });

// ── CoinGecko coin IDs for fallback lookup ──────────────────────────────────
const CG_IDS = {
  BTC:  'bitcoin',        ETH:  'ethereum',       BNB:  'binancecoin',
  SOL:  'solana',         AVAX: 'avalanche-2',    DOT:  'polkadot',
  MATIC:'matic-network',  LINK: 'chainlink',      ADA:  'cardano',
  XRP:  'ripple',         UNI:  'uniswap',        AAVE: 'aave',
  DOGE: 'dogecoin',       SHIB: 'shiba-inu',      PEPE: 'pepe',
  WIF:  'dogwifcoin',     BONK: 'bonk',           ARB:  'arbitrum',
  OP:   'optimism',       FET:  'fetch-ai',        RNDR: 'render-token',
  IMX:  'immutable-x',   APT:  'aptos',           SUI:  'sui',
  TON:  'the-open-network', NEAR:'near',          INJ:  'injective-protocol'
};

/**
 * Fetch live prices from DexScreener.
 * @returns {Promise<Array>} Normalised pair array
 */
async function fetchDexScreener() {
  const url = 'https://api.dexscreener.com/latest/dex/search?q=USDT%20USDC';
  const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!resp.ok) throw new Error(`DexScreener HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.pairs || !json.pairs.length) throw new Error('Empty DexScreener response');

  return json.pairs.slice(0, 50).map(p => ({
    p:     p.baseToken.symbol.toUpperCase(),
    price: parseFloat(p.priceUsd) || 0,
    chg:   parseFloat(p.priceChange?.h1) || 0,
    vol:   parseFloat(p.volume?.h24) || 0,
    liq:   parseFloat(p.liquidity?.usd) || 0,
    cat:   p.chainId || 'ethereum',
    src:   'dexscreener'
  }));
}

/**
 * Fetch live prices from CoinGecko as fallback.
 * @returns {Promise<Array>} Normalised pair array
 */
async function fetchCoinGecko() {
  const ids = Object.values(CG_IDS).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`);
  const json = await resp.json();

  return Object.entries(CG_IDS).map(([sym, id]) => ({
    p:     sym,
    price: json[id]?.usd || 0,
    chg:   parseFloat((json[id]?.usd_24h_change || 0).toFixed(3)),
    vol:   json[id]?.usd_24h_vol || 0,
    liq:   0,
    cat:   'ethereum',
    src:   'coingecko'
  })).filter(p => p.price > 0);
}

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://altscalp-pro.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method Not Allowed' });

  // ── Auth (optional — allows unauthenticated for public price data) ─────
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const decoded = await admin.auth().verifyIdToken(token);
      req.uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: 'Invalid auth token' });
    }
  }

  // ── Rate limiting ─────────────────────────────────────────────────────
  let rateLimitPassed = false;
  rateLimitMiddleware(req, res, () => { rateLimitPassed = true; });
  if (!rateLimitPassed) return; // rate limit already sent response

  // ── Cache hit ─────────────────────────────────────────────────────────
  if (cache.data && Date.now() < cache.expiresAt) {
    return res.status(200).json({ prices: cache.data, cached: true, ts: cache.expiresAt - CACHE_TTL });
  }

  // ── Fetch live data ───────────────────────────────────────────────────
  let prices = [];
  let source = 'unknown';

  try {
    prices = await fetchDexScreener();
    source = 'dexscreener';
  } catch (err) {
    console.warn('[prices] DexScreener failed, falling back to CoinGecko:', err.message);
    try {
      prices = await fetchCoinGecko();
      source = 'coingecko';
    } catch (err2) {
      console.error('[prices] Both sources failed:', err2.message);
      return res.status(503).json({ error: 'Price data unavailable', detail: err2.message });
    }
  }

  // ── Update cache ──────────────────────────────────────────────────────
  cache = { data: prices, expiresAt: Date.now() + CACHE_TTL };

  return res.status(200).json({ prices, cached: false, source, ts: Date.now() });
};
