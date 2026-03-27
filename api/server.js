/**
 * AltScalp PRO — Main Express Server
 * Wires all middleware and routes together.
 * Designed for local development; production uses Vercel serverless functions.
 *
 * Usage:
 *   npm install (inside api/ directory)
 *   node api/server.js
 */

'use strict';

const express    = require('express');
const crypto     = require('crypto');
const expressRateLimit = require('express-rate-limit');

const authenticateToken  = require('./middleware/authenticateToken');
const { validatePayment } = require('./middleware/validatePayment');
const { issueCsrfToken, verifyCsrfToken } = require('./middleware/csrf');

const createOrder   = require('./create-order');
const verifyPayment = require('./verify-payment');
const razorpayWebhook = require('./webhooks/razorpay');

const rateLimit         = require('./middleware/rateLimit');
const { getLivePrices } = require('./prices');
const { attachWebSocket } = require('./websocket');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Global middleware ────────────────────────────────────────────────────────

// Parse JSON bodies; for webhooks we need raw body for HMAC verification
app.use((req, res, next) => {
  if (req.path === '/webhooks/razorpay') {
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', () => {
      try { req.body = JSON.parse(rawBody); } catch { req.body = {}; }
      req.rawBody = rawBody;
      next();
    });
  } else {
    express.json({ limit: '16kb' })(req, res, next);
  }
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS — restrict to known origin
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://altscalp-pro.vercel.app';
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Rate limiters — 5 requests per minute per IP/user
const paymentRateLimit = expressRateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a minute and try again.' }
});

// ── Routes ───────────────────────────────────────────────────────────────────

// CSRF token issuance (no auth required)
app.get('/api/csrf-token', issueCsrfToken);

// Payment order creation
app.post(
  '/api/create-order',
  paymentRateLimit,
  authenticateToken,
  verifyCsrfToken,
  createOrder
);

// Payment verification
app.post(
  '/api/verify-payment',
  paymentRateLimit,
  authenticateToken,
  verifyCsrfToken,
  validatePayment,
  verifyPayment
);

// Razorpay webhook (no auth — verified by HMAC signature)
app.post('/webhooks/razorpay', razorpayWebhook);

// Live cryptocurrency prices (public, rate-limited)
app.get('/api/prices', rateLimit('prices'), async (req, res) => {
  try {
    const prices = await getLivePrices();
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=5');
    return res.status(200).json(prices);
  } catch (err) {
    console.error('[server] /api/prices error:', err.message);
    return res.status(503).json({ message: 'Price data temporarily unavailable. Please retry shortly.' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// 404 catch-all
app.use((req, res) => res.status(404).json({ message: 'Not found' }));

// Error handler — 'next' must be declared for Express to recognise this as an error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ message: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`[server] AltScalp PRO API listening on port ${PORT}`);
});

// Attach WebSocket server for real-time price streaming
attachWebSocket(server);

module.exports = app;
