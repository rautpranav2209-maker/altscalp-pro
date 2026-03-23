/**
 * AltScalp PRO — Razorpay Webhook (Backup Payment Confirmation)
 * ✅ Signature verified with HMAC-SHA256 (cannot be faked)
 * ✅ Runs server-side — users cannot trigger this
 * ✅ Deduplication prevents double upgrades
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // ✅ SECURITY: Verify Razorpay webhook signature
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = JSON.stringify(req.body);

  if (!signature || !webhookSecret) {
    console.error('[webhook] Missing signature or secret');
    return res.status(400).json({ status: 'missing_signature' });
  }

  const expectedSig = crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  // ✅ SECURITY: Use timing-safe comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedSigBuffer = Buffer.from(expectedSig, 'utf8');
  
  if (signatureBuffer.length !== expectedSigBuffer.length || 
      !crypto.timingSafeEqual(signatureBuffer, expectedSigBuffer)) {
    console.error('[webhook] INVALID SIGNATURE — possible fake request');
    return res.status(400).json({ status: 'invalid_signature' });
  }

  const event = req.body;
  if (event.event !== 'payment.captured') {
    return res.status(200).json({ status: 'ignored' });
  }

  const payment = event.payload.payment.entity;
  const paymentId = payment.id;
  const orderId = payment.order_id;
  const email = payment.email;
  const amount = payment.amount;

  try {
    // ✅ Deduplication — skip if already processed
    const paymentRef = db.collection('payments').doc(paymentId);
    const existing = await paymentRef.get();
    if (existing.exists) {
      console.log(`[webhook] Already processed: ${paymentId}`);
      return res.status(200).json({ status: 'already_processed' });
    }

    const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (usersSnap.empty) {
      console.error(`[webhook] User not found: ${email}`);
      return res.status(404).json({ status: 'user_not_found' });
    }

    const uid = usersSnap.docs[0].id;
    let plan = amount === 455000 ? 'yearly' : 'monthly';
    const expiryDate = new Date();
    if (plan === 'yearly') expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    else expiryDate.setMonth(expiryDate.getMonth() + 1);

    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), {
      isPro: true, plan,
      expiryDate: admin.firestore.Timestamp.fromDate(expiryDate),
      lastPaymentId: paymentId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    batch.set(paymentRef, {
      uid, email, orderId, paymentId, plan, amount,
      source: 'webhook',
      verifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();

    console.log(`[webhook] ✅ PRO activated for ${email} (${plan})`);
    return res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('[webhook] Error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
};
