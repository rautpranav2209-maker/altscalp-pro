/**
 * AltScalp PRO — CSRF Token Validation Middleware
 * ✅ Generates CSRF tokens for the frontend to include in headers
 * ✅ Validates token on mutating requests (POST/PUT/DELETE)
 * ✅ Stored in HTTP-only cookie; compared against X-CSRF-Token header
 * ✅ Tokens are single-use per session, regenerated on each issuance
 *
 * Usage in Express:
 *   GET /api/csrf-token  → returns { csrfToken }
 *   POST endpoints       → require X-CSRF-Token header matching cookie
 *
 * Frontend:
 *   1. Fetch token: GET /api/csrf-token
 *   2. Store token in memory (not localStorage/sessionStorage)
 *   3. Send as header: X-CSRF-Token: <token>
 */

'use strict';

const crypto = require('crypto');

const COOKIE_NAME   = '__Host-csrf';
const HEADER_NAME   = 'x-csrf-token';
const TOKEN_TTL_MS  = 30 * 60 * 1000; // 30 minutes

/** Generate a cryptographically random CSRF token. */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Express route handler: issues a new CSRF token in a cookie
 * and returns it in the JSON response body.
 */
function issueCsrfToken(req, res) {
  const token   = generateToken();
  const expires = new Date(Date.now() + TOKEN_TTL_MS);

  // __Host- prefix enforces: Secure, no Domain, Path=/
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires.toUTCString()}`
  ]);

  return res.status(200).json({ csrfToken: token });
}

/**
 * Middleware: validates the CSRF token on mutating requests.
 * Compares the X-CSRF-Token header against the __Host-csrf cookie.
 */
function verifyCsrfToken(req, res, next) {
  // Only enforce on state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const headerToken = req.headers[HEADER_NAME] || '';
  const cookieHeader = req.headers.cookie || '';
  const cookieToken = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${COOKIE_NAME}=`))
    ?.split('=')[1] || '';

  if (!headerToken || !cookieToken) {
    return res.status(403).json({ message: 'CSRF token missing' });
  }

  // Timing-safe comparison to prevent oracle attacks
  try {
    const hBuf = Buffer.from(headerToken, 'utf8');
    const cBuf = Buffer.from(cookieToken,  'utf8');
    if (hBuf.length !== cBuf.length || !crypto.timingSafeEqual(hBuf, cBuf)) {
      return res.status(403).json({ message: 'CSRF token invalid' });
    }
  } catch {
    return res.status(403).json({ message: 'CSRF token invalid' });
  }

  next();
}

module.exports = { issueCsrfToken, verifyCsrfToken };
