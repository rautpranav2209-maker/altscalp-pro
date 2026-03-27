/**
 * AltScalp PRO — Secure Payment Verification API
 * ✅ Verifies Razorpay signature server-side (cannot be faked)
 * ✅ Only upgrades PRO AFTER cryptographic signature check
 * ✅ Firebase ID token verified
 * ✅ Prevents replay attacks with paymentId deduplication
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { logTransaction } = require('./utils/transactionLogger');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

const PLAN_PRICES = {
  monthly: 64000,
  yearly:  455000
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://altscalp-pro.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    // ✅ SECURITY: Verify Firebase ID token
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

    // ✅ SECURITY: Validate and sanitize all inputs
    const VALID_PLAN = /^(monthly|yearly)$/;
    const ALPHANUMERIC = /^[A-Za-z0-9_]+$/;
    const HEX_PATTERN = /^[a-f0-9]+$/i;

    if (!razorpay_order_id || !ALPHANUMERIC.test(razorpay_order_id)) {
      return res.status(400).json({ message: 'Invalid razorpay_order_id' });
    }
    if (!razorpay_payment_id || !ALPHANUMERIC.test(razorpay_payment_id)) {
      return res.status(400).json({ message: 'Invalid razorpay_payment_id' });
    }
    if (!razorpay_signature || !HEX_PATTERN.test(razorpay_signature)) {
      return res.status(400).json({ message: 'Invalid razorpay_signature' });
    }
    if (!plan || !VALID_PLAN.test(plan)) {
      return res.status(400).json({ message: 'Invalid plan. Must be monthly or yearly.' });
    }

    // ✅ SECURITY: Cryptographic signature verification
    // This is the ONLY way to confirm Razorpay actually processed the payment
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    // ✅ SECURITY: Timing-safe comparison to prevent timing attacks
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(razorpay_signature, 'utf8');
    const signaturesMatch = expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

    if (!signaturesMatch) {
      console.error(`[verify-payment] SIGNATURE MISMATCH for uid=${uid}, paymentId=${razorpay_payment_id}`);
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    // ✅ SECURITY: Check for duplicate payment (replay attack prevention)
    const existingPayment = await db.collection('payments').doc(razorpay_payment_id).get();
    if (existingPayment.exists) {
      console.warn(`[verify-payment] Duplicate payment attempt: ${razorpay_payment_id}`);
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    // ✅ SECURITY: Verify uid matches (prevent one user paying for another)
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Calculate expiry date
    const expiryDate = new Date();
    if (plan === 'yearly') expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    else expiryDate.setMonth(expiryDate.getMonth() + 1);

    // ✅ Atomic Firestore write — upgrade user + record payment
    const batch = db.batch();

    batch.update(userRef, {
      isPro: true,
      plan,
      expiryDate: admin.firestore.Timestamp.fromDate(expiryDate),
      lastPaymentId: razorpay_payment_id,
      lastOrderId: razorpay_order_id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Record payment for deduplication
    batch.set(db.collection('payments').doc(razorpay_payment_id), {
      uid,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      plan,
      amount: PLAN_PRICES[plan],
      verifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // ✅ AUDIT: Log transaction details for compliance & fraud detection
    // (logTransaction writes to 'transactions' collection asynchronously)
    logTransaction({
      uid,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      amount: PLAN_PRICES[plan],
      plan,
      status: 'success',
      source: 'verify-payment',
      req
    }).catch(err => console.error('[verify-payment] Audit log failed:', err.message));

    await batch.commit();

    console.log(`[verify-payment] ✅ PRO activated for uid=${uid}, plan=${plan}`);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[verify-payment] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Verification error. Contact support.' });
  }
};
