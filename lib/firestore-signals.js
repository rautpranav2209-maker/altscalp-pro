/**
 * AltScalp PRO — Firestore Signal Persistence
 * Saves trading signals, keeps last 20 per user, auto-expires after 90 days.
 *
 * Collections:
 *   /users/{uid}/signals/{signalId}
 *     Fields: symbol, direction, entryPrice, takeProfit, stopLoss,
 *             confidence, createdAt (Timestamp), expiresAt (Timestamp)
 *
 *   /alerts/{alertId}
 *     Fields: uid, message, symbol, createdAt (Timestamp), expiresAt (Timestamp)
 *     (Top-level collection for server-side cross-user queries)
 */

'use strict';

const admin = require('firebase-admin');

// ── Firebase Admin init (shared singleton) ───────────────────────────────────

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

// ── Constants ─────────────────────────────────────────────────────────────────

const SIGNAL_TTL_DAYS  = 90;
const MAX_SIGNALS      = 20;   // Max signals stored per user
const MAX_ALERTS       = 20;   // Max alerts stored per user

function ttlTimestamp(days = SIGNAL_TTL_DAYS) {
  const ms = Date.now() + days * 24 * 60 * 60 * 1_000;
  return admin.firestore.Timestamp.fromMillis(ms);
}

// ── Signal operations ─────────────────────────────────────────────────────────

/**
 * Save a trading signal for a user.
 * Prunes older signals when the count exceeds MAX_SIGNALS.
 *
 * @param {string} uid - Firebase user ID
 * @param {Object} signal - Signal data
 * @param {string} signal.symbol       - e.g. 'BTC'
 * @param {string} signal.direction    - 'LONG' | 'SHORT'
 * @param {number} signal.entryPrice
 * @param {number} signal.takeProfit
 * @param {number} signal.stopLoss
 * @param {number} [signal.confidence] - 0–100
 * @returns {Promise<string>} The new signal document ID
 */
async function saveSignal(uid, signal) {
  if (!uid || typeof uid !== 'string') throw new Error('Invalid uid');
  const { symbol, direction, entryPrice, takeProfit, stopLoss, confidence } = signal;

  if (!symbol || !direction || entryPrice == null) {
    throw new Error('signal must include symbol, direction, and entryPrice');
  }

  const now      = admin.firestore.Timestamp.now();
  const colRef   = db.collection('users').doc(uid).collection('signals');

  const docData = {
    uid,
    symbol:      symbol.toUpperCase(),
    direction:   direction.toUpperCase(),
    entryPrice:  Number(entryPrice),
    takeProfit:  takeProfit != null ? Number(takeProfit) : null,
    stopLoss:    stopLoss   != null ? Number(stopLoss)   : null,
    confidence:  confidence != null ? Number(confidence) : null,
    createdAt:   now,
    expiresAt:   ttlTimestamp(SIGNAL_TTL_DAYS)
  };

  const docRef = await colRef.add(docData);

  // Prune: keep only the most recent MAX_SIGNALS documents
  await pruneCollection(colRef, 'createdAt', MAX_SIGNALS);

  return docRef.id;
}

/**
 * Retrieve the most recent signals for a user.
 *
 * @param {string} uid  - Firebase user ID
 * @param {number} [limit=20] - Max number of signals to return
 * @returns {Promise<Array<Object>>}
 */
async function getSignals(uid, limit = MAX_SIGNALS) {
  if (!uid || typeof uid !== 'string') throw new Error('Invalid uid');

  const snapshot = await db
    .collection('users')
    .doc(uid)
    .collection('signals')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(limit, MAX_SIGNALS))
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ── Alert operations ──────────────────────────────────────────────────────────

/**
 * Store a trading alert for a user.
 * Prunes older alerts when the count per user exceeds MAX_ALERTS.
 *
 * @param {string} uid     - Firebase user ID
 * @param {Object} alert   - Alert payload
 * @param {string} alert.message  - Human-readable alert message
 * @param {string} [alert.symbol] - Associated trading symbol
 * @returns {Promise<string>} The new alert document ID
 */
async function saveAlert(uid, alert) {
  if (!uid || typeof uid !== 'string') throw new Error('Invalid uid');
  const { message, symbol } = alert;

  if (!message || typeof message !== 'string') throw new Error('alert.message is required');

  const now    = admin.firestore.Timestamp.now();
  const colRef = db.collection('users').doc(uid).collection('alerts');

  const docData = {
    uid,
    message,
    symbol:    symbol ? symbol.toUpperCase() : null,
    createdAt: now,
    expiresAt: ttlTimestamp(SIGNAL_TTL_DAYS)
  };

  const docRef = await colRef.add(docData);

  // Prune: keep only the most recent MAX_ALERTS per user
  await pruneCollection(colRef, 'createdAt', MAX_ALERTS);

  return docRef.id;
}

/**
 * Retrieve the most recent alerts for a user.
 *
 * @param {string} uid    - Firebase user ID
 * @param {number} [limit=20]
 * @returns {Promise<Array<Object>>}
 */
async function getAlerts(uid, limit = MAX_ALERTS) {
  if (!uid || typeof uid !== 'string') throw new Error('Invalid uid');

  const snapshot = await db
    .collection('users')
    .doc(uid)
    .collection('alerts')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(limit, MAX_ALERTS))
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Delete oldest documents from a collection when its size exceeds maxDocs.
 *
 * @param {FirebaseFirestore.CollectionReference} colRef
 * @param {string} orderField - Field to sort by (ascending = oldest first)
 * @param {number} maxDocs
 */
async function pruneCollection(colRef, orderField, maxDocs) {
  const snapshot = await colRef.orderBy(orderField, 'asc').get();
  const excess = snapshot.docs.length - maxDocs;
  if (excess <= 0) return;

  const batch = db.batch();
  snapshot.docs.slice(0, excess).forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

module.exports = { saveSignal, getSignals, saveAlert, getAlerts };
