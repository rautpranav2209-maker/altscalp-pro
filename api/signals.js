/**
 * AltScalp PRO — POST /api/signals
 * Server-side signal calculation with input clamping/validation.
 * Persists signal record to Firestore users/{uid}/signals/ when auth is present.
 */

'use strict';

const authenticateToken = require('./middleware/authenticateToken');
const rateLimit = require('./middleware/rateLimit');
const { calcSig } = require('./utils/signalEngine');

// Lazy-init Firebase Admin (may not be present in all environments)
let _db = null;
function getDb() {
  if (_db) return _db;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(Buffer.from(sa, 'base64').toString('utf8')))
      });
    }
    _db = admin.firestore();
  } catch (e) {
    console.warn('[signals] Firestore unavailable:', e.message);
    _db = null;
  }
  return _db;
}

// ── Allowed/required fields for signal input ──────────────────────────────────
const NUM_FIELDS = ['chg', 'm5', 'flow', 'ob', 'rsi', 'vd', 'fr', 'sp', 'sent', 'liq', 'vol', 'corr'];

function parseInput(body) {
  if (!body || typeof body !== 'object') throw new Error('Request body must be a JSON object');
  const pair = typeof body.pair === 'string' ? body.pair.toUpperCase().slice(0, 10) : '';
  if (!pair) throw new Error('Field "pair" is required');

  const d = { p: pair };
  for (const f of NUM_FIELDS) {
    const v = body[f];
    if (v !== undefined && v !== null && v !== '') {
      const n = parseFloat(v);
      if (!isNaN(n)) d[f] = n;
    }
  }
  // Default rsi to 50 if not provided
  if (d.rsi === undefined) d.rsi = 50;

  const tf = body.tf === '5m' ? '5m' : '1m';
  return { d, tf };
}

// ── Vercel serverless handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  const allowed = process.env.ALLOWED_ORIGIN || 'https://altscalp-pro.vercel.app';
  const origin  = req.headers.origin;
  if (origin === allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth (optional — allows unauthenticated callers, but won't persist to Firestore)
  await new Promise(resolve => authenticateToken(req, res, resolve));
  if (res.headersSent) return;

  // Rate limit
  let passed = false;
  await new Promise(resolve => {
    rateLimit('signals')(req, res, () => { passed = true; resolve(); });
    if (!passed) resolve();
  });
  if (res.headersSent) return;

  // Parse and validate input
  let d, tf;
  try {
    ({ d, tf } = parseInput(req.body));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Calculate signal server-side
  const sig  = calcSig(d, tf);
  const side = sig > 0.5 ? 'long' : sig < -0.5 ? 'short' : 'wait';

  const record = {
    pair: d.p,
    sig,
    side,
    tf,
    input: d,
    ts: Date.now()
  };

  // Persist to Firestore if user is authenticated
  if (req.uid) {
    const db = getDb();
    if (db) {
      try {
        await db.collection('users').doc(req.uid).collection('signals').add(record);
      } catch (fsErr) {
        console.warn('[signals] Firestore write failed:', fsErr.message);
        // Non-fatal — still return the signal to the client
      }
    }
  }

  return res.status(200).json(record);
};
