/**
 * AltScalp PRO — Payment Input Validation & Sanitization Middleware
 * ✅ Validates all Razorpay payment parameters
 * ✅ Rejects malformed or unexpected values before they reach business logic
 * ✅ Plan prices are hardcoded server-side — frontend cannot override amount
 */

'use strict';

const VALID_PLAN    = /^(monthly|yearly)$/;
const ALPHANUMERIC  = /^[A-Za-z0-9_]+$/;
const HEX_PATTERN   = /^[a-f0-9]+$/i;

/** Hardcoded plan prices (paise). Never derive from request body. */
const PLAN_PRICES = {
  monthly: 64000,   // ₹640
  yearly:  455000   // ₹4,550
};

/**
 * Middleware that validates payment request body fields.
 * Attaches `req.validatedPayment` with sanitised values.
 */
function validatePayment(req, res, next) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body || {};

  if (!razorpay_order_id || typeof razorpay_order_id !== 'string' || !ALPHANUMERIC.test(razorpay_order_id)) {
    return res.status(400).json({ message: 'Invalid or missing razorpay_order_id' });
  }
  if (!razorpay_payment_id || typeof razorpay_payment_id !== 'string' || !ALPHANUMERIC.test(razorpay_payment_id)) {
    return res.status(400).json({ message: 'Invalid or missing razorpay_payment_id' });
  }
  if (!razorpay_signature || typeof razorpay_signature !== 'string' || !HEX_PATTERN.test(razorpay_signature)) {
    return res.status(400).json({ message: 'Invalid or missing razorpay_signature' });
  }
  if (!plan || !VALID_PLAN.test(plan)) {
    return res.status(400).json({ message: 'Invalid plan. Must be "monthly" or "yearly".' });
  }

  // Attach sanitised, server-authoritative values
  req.validatedPayment = {
    razorpay_order_id:   razorpay_order_id.trim(),
    razorpay_payment_id: razorpay_payment_id.trim(),
    razorpay_signature:  razorpay_signature.trim().toLowerCase(),
    plan,
    expectedAmount: PLAN_PRICES[plan]
  };

  next();
}

module.exports = { validatePayment, PLAN_PRICES };
