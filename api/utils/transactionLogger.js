/**
 * AltScalp PRO — Audit Transaction Logger
 * ✅ Logs every payment attempt (success & failure) to Firestore
 * ✅ Records IP address & user agent for fraud detection
 * ✅ Retention: records include timestamp; cleanup policy enforced via Firestore TTL
 * ✅ Logs are read-only for end-users (enforced in firestore.rules)
 */

'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

const RETENTION_DAYS = 90;
const RETENTION_MS   = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Log a payment transaction to the `transactions` collection.
 *
 * @param {object} params
 * @param {string}  params.uid             - Firebase user ID
 * @param {string}  params.paymentId       - Razorpay payment ID
 * @param {string}  params.orderId         - Razorpay order ID
 * @param {number}  params.amount          - Amount in paise
 * @param {string}  params.plan            - Subscription plan (monthly|yearly)
 * @param {'success'|'failed'|'refunded'} params.status - Payment status
 * @param {string}  [params.source]        - Source of the log (verify-payment|webhook)
 * @param {object}  [params.req]           - Express request object (for IP & UA)
 * @returns {Promise<string>} Document ID of the created log entry
 */
async function logTransaction({ uid, paymentId, orderId, amount, plan, status, source = 'unknown', req }) {
  const ipAddress = req
    ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    : 'unknown';
  const userAgent = req ? (req.headers['user-agent'] || 'unknown') : 'unknown';

  const data = {
    uid,
    paymentId:  paymentId  || null,
    orderId:    orderId    || null,
    amount:     amount     || null,
    plan:       plan       || null,
    status,
    source,
    ipAddress,
    userAgent,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    // TTL field: Firestore TTL policy should delete docs older than RETENTION_DAYS days
    expiresAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + RETENTION_MS)
    )
  };

  const docRef = await db.collection('transactions').add(data);
  console.log(`[transactionLogger] Logged ${status} for uid=${uid}, paymentId=${paymentId}, docId=${docRef.id}`);
  return docRef.id;
}

module.exports = { logTransaction };
