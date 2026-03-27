/**
 * AltScalp PRO — Razorpay Configuration
 * ✅ API keys loaded exclusively from environment variables
 * ✅ Keys are NEVER hardcoded or exposed to the frontend
 * ✅ Module validates required env vars at import time
 */

'use strict';

const Razorpay = require('razorpay');

const REQUIRED_VARS = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];

REQUIRED_VARS.forEach(v => {
  if (!process.env[v]) {
    throw new Error(`[razorpay config] FATAL: Missing required environment variable: ${v}`);
  }
});

/** Hardcoded plan prices in paise (INR). Never derive from request body. */
const PLAN_PRICES = {
  monthly: 64000,   // ₹640
  yearly:  455000   // ₹4,550
};

/**
 * Create a new Razorpay client instance.
 * Call this per-request to avoid stale credential issues.
 * @returns {Razorpay}
 */
function getRazorpayClient() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay keys are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

module.exports = { getRazorpayClient, PLAN_PRICES };
