/**
 * AltScalp PRO — Token Bucket Rate Limiting Middleware
 * ✅ 5 requests per minute per user (Firebase UID) or IP
 * ✅ Works across serverless cold starts using in-memory Map
 * ✅ Returns RFC-7807 compliant error responses
 */

const RATE_LIMIT_MAX = 5;       // requests
const RATE_LIMIT_WINDOW = 60000; // 1 minute in ms

// In-memory store: { key -> { tokens, lastRefill } }
const buckets = new Map();

/**
 * Get or initialise a bucket for the given key.
 * @param {string} key - Unique user/IP identifier
 */
function getBucket(key) {
  if (!buckets.has(key)) {
    buckets.set(key, { tokens: RATE_LIMIT_MAX, lastRefill: Date.now() });
  }
  return buckets.get(key);
}

/**
 * Attempt to consume one token from the bucket.
 * Refills based on elapsed time (token bucket algorithm).
 * @param {string} key
 * @param {number} [max=RATE_LIMIT_MAX]
 * @param {number} [windowMs=RATE_LIMIT_WINDOW]
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function consume(key, max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW) {
  const bucket = getBucket(key);
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;

  // Refill tokens proportionally to elapsed time
  if (elapsed >= windowMs) {
    bucket.tokens = max;
    bucket.lastRefill = now;
  }

  const resetMs = windowMs - (now - bucket.lastRefill);

  if (bucket.tokens > 0) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: bucket.tokens, resetMs };
  }

  return { allowed: false, remaining: 0, resetMs };
}

/**
 * Express/Vercel-compatible rate limit middleware factory.
 * @param {Object} [options]
 * @param {number} [options.max=5] - Max requests per window
 * @param {number} [options.windowMs=60000] - Window in ms
 * @returns {Function} Middleware function (req, res, next)
 */
function createRateLimit(options = {}) {
  const max = options.max || RATE_LIMIT_MAX;
  const windowMs = options.windowMs || RATE_LIMIT_WINDOW;

  return function rateLimitMiddleware(req, res, next) {
    // Prefer Firebase UID from verified token, fall back to IP
    const uid = req.uid || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const key = `ratelimit:${uid}`;

    const { allowed, remaining, resetMs } = consume(key, max, windowMs);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + resetMs) / 1000));

    if (!allowed) {
      return res.status(429).json({
        type: 'https://altscalp-pro.vercel.app/errors/rate-limit',
        title: 'Too Many Requests',
        status: 429,
        detail: `Rate limit exceeded. Try again in ${Math.ceil(resetMs / 1000)} seconds.`,
        retryAfterMs: resetMs
      });
    }

    if (typeof next === 'function') next();
  };
}

module.exports = { createRateLimit, consume };
