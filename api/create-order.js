/**
 * AltScalp PRO — Secure Order Creation API
 * ✅ Razorpay key NEVER exposed to frontend
 * ✅ Firebase ID token verified server-side
 * ✅ Rate limiting per user
 */

const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// Init Firebase Admin (defensive)
try {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env var");
    }
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
} catch (e) {
  console.error("[FATAL] Firebase Init Failed:", e.message);
}

// Plan prices in paise (INR)
const PLAN_PRICES = {
  monthly: 64000,  // ₹640 (~$7)
  yearly:  455000  // ₹4550 (~$50)
};

// Simple in-memory rate limit (resets on cold start — good enough for serverless)
const rateLimitMap = new Map();

module.exports = async (req, res) => {
  // ✅ CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://altscalp-pro.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    // ✅ SECURITY: Verify Firebase ID token
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // ✅ SECURITY: Rate limiting — max 5 order attempts per user per 10 minutes
    const now = Date.now();
    const userRate = rateLimitMap.get(uid) || { count: 0, window: now };
    if (now - userRate.window > 10 * 60 * 1000) {
      userRate.count = 0; userRate.window = now;
    }
    userRate.count++;
    rateLimitMap.set(uid, userRate);
    if (userRate.count > 5) {
      return res.status(429).json({ message: 'Too many requests. Please wait a few minutes.' });
    }

    const { plan } = req.body;
    if (!plan || !PLAN_PRICES[plan]) {
      return res.status(400).json({ message: 'Invalid plan' });
    }

    // ✅ SECURITY: Razorpay key only lives in server environment
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ 
        message: 'Payment keys missing. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel settings.' 
      });
    }
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const order = await razorpay.orders.create({
      amount: PLAN_PRICES[plan],
      currency: 'INR',
      receipt: `rcpt_${uid.slice(-10)}_${Date.now()}`,
      notes: { uid, plan }
    });

    // ✅ Only return the public key and order ID — secret stays on server
    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID  // Public key only
    });

  } catch (err) {
    // ✅ Polymorphic error handling (Razorpay uses .description, Firebase uses .message)
    const errorMsg = err.message || (err.error && err.error.description) || err.description || JSON.stringify(err);
    console.error('[create-order] FATAL ERROR:', errorMsg);
    console.error('[create-order] FULL ERROR OBJECT:', JSON.stringify(err));

    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: 'Session expired. Please sign in again.' });
    }

    return res.status(500).json({ 
      message: 'Failed to create order: ' + errorMsg,
      code: err.code || (err.error && err.error.code) || 'INTERNAL_ERROR'
    });
  }
};
