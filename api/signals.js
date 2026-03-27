/**
 * AltScalp PRO — Trading Signal Generation API
 * POST /api/signals
 *
 * Accepts pair market data, calculates server-side signal scores,
 * persists each signal to Firestore (users/{uid}/signals/{signalId}),
 * and returns the computed signal result.
 *
 * ✅ Firebase ID token required
 * ✅ Rate limited (5 req/min per user)
 * ✅ Input validated before signal calculation
 * ✅ Signal persisted with TTL metadata for querying
 */

const admin = require('firebase-admin');
const { generateSignals } = require('./utils/signalEngine');
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
  console.error('[signals] Firebase init failed:', e.message);
}

const db = admin.firestore();
const rateLimitMiddleware = createRateLimit({ max: 5, windowMs: 60000 });

/**
 * Validate and sanitise the request body.
 * @param {Object} body
 * @returns {{ valid: boolean, errors: string[], data: Object }}
 */
function validateInput(body) {
  const errors = [];
  const required = ['pair', 'chg', 'ob', 'rsi', 'vd', 'fr', 'sp', 'sent', 'liq', 'vol', 'corr'];

  required.forEach(field => {
    if (body[field] === undefined || body[field] === null) errors.push(`Missing field: ${field}`);
  });

  if (errors.length) return { valid: false, errors, data: null };

  // Clamp to expected ranges to prevent injection of extreme values
  return {
    valid: true,
    errors: [],
    data: {
      chg:  Math.max(-50, Math.min(50,  parseFloat(body.chg)  || 0)),
      ob:   Math.max(-1,  Math.min(1,   parseFloat(body.ob)   || 0)),
      rsi:  Math.max(0,   Math.min(100, parseFloat(body.rsi)  || 50)),
      vd:   Math.max(-1,  Math.min(1,   parseFloat(body.vd)   || 0)),
      fr:   Math.max(-0.1,Math.min(0.1, parseFloat(body.fr)   || 0)),
      sp:   Math.max(0,   Math.min(50,  parseFloat(body.sp)   || 0)),
      sent: Math.max(-1,  Math.min(1,   parseFloat(body.sent) || 0)),
      liq:  Math.max(0,   Math.min(1,   parseFloat(body.liq)  || 0.5)),
      vol:  Math.max(0,   Math.min(500, parseFloat(body.vol)  || 0)),
      corr: Math.max(0,   Math.min(1,   parseFloat(body.corr) || 0))
    }
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://altscalp-pro.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

  // ── Auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
    req.uid = uid;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired auth token' });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────
  let rateLimitPassed = false;
  rateLimitMiddleware(req, res, () => { rateLimitPassed = true; });
  if (!rateLimitPassed) return;

  // ── Input validation ──────────────────────────────────────────────────
  const body = req.body || {};
  const pair = (typeof body.pair === 'string' ? body.pair : '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (!pair) return res.status(400).json({ error: 'Invalid or missing pair' });

  const { valid, errors, data } = validateInput(body);
  if (!valid) return res.status(400).json({ error: 'Validation failed', details: errors });

  // ── Compute signal ────────────────────────────────────────────────────
  const result = generateSignals(data);
  const signalRecord = {
    uid,
    pair,
    ...data,
    ...result,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour TTL hint
  };

  // ── Persist to Firestore ──────────────────────────────────────────────
  try {
    const ref = await db
      .collection('users').doc(uid)
      .collection('signals')
      .add(signalRecord);

    return res.status(200).json({
      id:     ref.id,
      pair,
      sig1m:  result.sig1m,
      sig5m:  result.sig5m,
      action: result.action,
      confirmed:  result.confirmed,
      confidence: result.confidence
    });
  } catch (err) {
    console.error('[signals] Firestore write failed:', err.message);
    // Still return the computed signal even if persistence fails
    return res.status(200).json({
      pair,
      sig1m:  result.sig1m,
      sig5m:  result.sig5m,
      action: result.action,
      confirmed:  result.confirmed,
      confidence: result.confidence,
      persisted:  false
    });
  }
};
