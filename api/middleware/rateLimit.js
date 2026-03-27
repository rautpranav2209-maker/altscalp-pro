/**
 * AltScalp PRO — Token Bucket Rate Limiter Middleware
 * ✅ 5 requests per minute per user per endpoint
 * ✅ In-memory token bucket algorithm (Redis-compatible interface for scaling)
 * ✅ Returns 429 Too Many Requests when limit exceeded
 */

'use strict';

// Token bucket store: Map<key, { tokens, lastRefill }>
const buckets = new Map();

const BUCKET_CAPACITY = 5;       // Max requests allowed in window
const REFILL_RATE_MS  = 60_000;  // 1 minute window

/**
 * Get or create a token bucket for the given key.
 * @param {string} key - Unique identifier (e.g., `uid:endpoint`)
 * @returns {{ tokens: number, lastRefill: number }}
 */
function getBucket(key) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: BUCKET_CAPACITY, lastRefill: now };
    buckets.set(key, bucket);
    return bucket;
  }
  // Refill tokens proportionally to elapsed time (smooth bucket)
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    const refill = (elapsed / REFILL_RATE_MS) * BUCKET_CAPACITY;
    bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + refill);
    bucket.lastRefill = now;
  }
  return bucket;
}

/**
 * Factory: creates a rate-limit middleware for a named endpoint.
 * Usage: app.use('/api/verify-payment', rateLimit('verify-payment'));
 *
 * @param {string} endpoint - Label used in the bucket key
 * @returns {Function} Express middleware
 */
function rateLimit(endpoint) {
  return function rateLimitMiddleware(req, res, next) {
    // Identify the caller — prefer authenticated uid, fall back to IP
    const uid = req.uid || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'anonymous';
    const key = `${uid}:${endpoint}`;
    const bucket = getBucket(key);

    if (bucket.tokens <= 0) {
      const retryAfterSec = Math.ceil(REFILL_RATE_MS / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      res.setHeader('X-RateLimit-Limit', BUCKET_CAPACITY);
      res.setHeader('X-RateLimit-Remaining', 0);
      console.warn(`[rateLimit] 429 for key=${key}`);
      return res.status(429).json({ message: 'Too many requests. Please wait a minute and try again.' });
    }

    bucket.tokens -= 1;
    res.setHeader('X-RateLimit-Limit', BUCKET_CAPACITY);
    res.setHeader('X-RateLimit-Remaining', bucket.tokens);
    next();
  };
}

module.exports = rateLimit;
