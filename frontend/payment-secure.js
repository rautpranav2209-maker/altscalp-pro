/**
 * AltScalp PRO — Secure Payment Integration (Frontend Module)
 *
 * Drop-in replacement for the inline payment code in index.html.
 * ✅ Fetches CSRF token before payment initiation
 * ✅ Uses server-side order creation (key never in frontend)
 * ✅ Sends payment details to /api/verify-payment after completion
 * ✅ Never writes to Firestore directly from the browser
 * ✅ Handles errors gracefully with user-friendly messages
 *
 * Usage:
 *   <script src="/frontend/payment-secure.js"></script>
 *   await SecurePayment.initiate({ plan: 'monthly', user, idToken, onSuccess, onFailure });
 */

'use strict';

const SecurePayment = (() => {
  // CSRF token cached in memory for the current page session
  let _csrfToken = null;

  /** Fetch (or return cached) CSRF token from the server. */
  async function getCsrfToken() {
    if (_csrfToken) return _csrfToken;
    const res = await fetch('/api/csrf-token', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to obtain CSRF token');
    const { csrfToken } = await res.json();
    _csrfToken = csrfToken;
    return csrfToken;
  }

  /**
   * Initiate a secure Razorpay payment flow.
   *
   * @param {object}   opts
   * @param {string}   opts.plan       - 'monthly' | 'yearly'
   * @param {object}   opts.user       - Firebase user object
   * @param {string}   opts.idToken    - Fresh Firebase ID token
   * @param {Function} opts.onSuccess  - Called with { paymentId, plan } on success
   * @param {Function} opts.onFailure  - Called with { message } on failure
   */
  async function initiate({ plan, user, idToken, onSuccess, onFailure }) {
    try {
      const csrfToken = await getCsrfToken();

      // Step 1: Create order on server
      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${idToken}`,
          'X-CSRF-Token':  csrfToken
        },
        body: JSON.stringify({ plan })
      });

      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({}));
        throw new Error(err.message || `Order creation failed (${orderRes.status})`);
      }

      const { orderId, amount, currency, key } = await orderRes.json();

      // Step 2: Open Razorpay checkout
      const result = await new Promise((resolve, reject) => {
        if (typeof Razorpay === 'undefined') {
          return reject(new Error('Payment SDK not loaded. Please refresh and try again.'));
        }

        const rzp = new Razorpay({ // eslint-disable-line no-undef
          key,
          amount,
          currency,
          name:        'AltScalp PRO',
          description: `Subscription: ${plan.toUpperCase()} Plan`,
          image:       'https://altscalp-pro.vercel.app/logo.png',
          order_id:    orderId,
          prefill:     { email: user.email },
          theme:       { color: '#00ffa3' },
          handler: async function (response) {
            try {
              // Step 3: Verify payment on server
              const verifyRes = await fetch('/api/verify-payment', {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type':  'application/json',
                  'Authorization': `Bearer ${idToken}`,
                  'X-CSRF-Token':  csrfToken
                },
                body: JSON.stringify({
                  razorpay_order_id:   response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                  plan
                })
              });

              const result = await verifyRes.json();
              if (result.success) {
                // Invalidate CSRF token after use
                _csrfToken = null;
                resolve({ paymentId: response.razorpay_payment_id, plan });
              } else {
                reject(new Error(result.message || 'Payment verification failed'));
              }
            } catch (verifyErr) {
              reject(verifyErr);
            }
          },
          modal: {
            ondismiss: () => reject(new Error('Payment cancelled'))
          }
        });

        rzp.on('payment.failed', (resp) => {
          reject(new Error(resp.error?.description || 'Payment failed'));
        });

        rzp.open();
      });

      if (typeof onSuccess === 'function') {
        onSuccess(result);
      }

    } catch (err) {
      if (typeof onFailure === 'function') {
        onFailure({ message: err.message });
      }
      console.error('[SecurePayment] Error:', err.message);
    }
  }

  return { initiate };
})();

// Make available globally when loaded via <script> tag
if (typeof window !== 'undefined') {
  window.SecurePayment = SecurePayment;
}
