/**
 * AltScalp PRO — /api/prices Next.js API Route
 * Wraps the price aggregation logic for use as a Next.js serverless function.
 *
 * GET /api/prices
 *   Returns: { SYMBOL: { price, change24h, volume, source }, ... }
 *   Cache-Control: max-age=10 (mirrors the server-side 10-second cache)
 *
 * Rate limiting is applied via the shared token-bucket middleware.
 * Re-uses the same getLivePrices() aggregator as the Express route.
 */

'use strict';

const { getLivePrices } = require('../../api/prices');
const rateLimit         = require('../../api/middleware/rateLimit');

// Build an in-memory rate-limiter guard for the prices endpoint.
// The token-bucket middleware is Express-style; we invoke it manually here.
const rateLimiter = rateLimit('prices');

/**
 * Invoke Express-style middleware in a Next.js API handler.
 *
 * @param {Function} middleware - (req, res, next) => void
 * @param {Object}   req
 * @param {Object}   res
 * @returns {Promise<void>} Resolves when next() is called, rejects on error
 */
function runMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      resolve(result);
    });
  });
}

/**
 * Next.js API handler — GET /api/prices
 *
 * @param {import('next').NextApiRequest}  req
 * @param {import('next').NextApiResponse} res
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Identify caller for rate-limiting: uid from auth header fallback to IP
  req.uid = req.headers['x-user-id'] || null;

  try {
    await runMiddleware(rateLimiter, req, res);
  } catch (err) {
    // runMiddleware rejects only on hard errors; 429 is handled inside rateLimiter
    console.error('[api/prices] Rate-limit middleware error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }

  // If rate-limiter already sent a 429, stop here
  if (res.headersSent) return;

  try {
    const prices = await getLivePrices();
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5');
    return res.status(200).json(prices);
  } catch (err) {
    console.error('[api/prices] Failed to fetch prices:', err.message);
    return res.status(503).json({ message: 'Price data temporarily unavailable. Please retry shortly.' });
  }
}

module.exports = handler;
