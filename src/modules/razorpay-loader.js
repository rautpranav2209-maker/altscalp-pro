/**
 * Lazy loader for Razorpay payment SDK.
 * Loads razorpay.js only when a payment flow is initiated,
 * saving ~186 KB on initial page load.
 */

let _razorpayLoaded = false;

/**
 * Dynamically loads the Razorpay SDK and opens a payment checkout.
 * @param {object} options - Razorpay checkout options
 * @returns {Promise<void>}
 */
export function openRazorpayCheckout(options) {
  return loadRazorpay().then(() => {
    const rzp = new window.Razorpay(options);
    rzp.open();
  });
}

/**
 * Loads the Razorpay SDK script if not already loaded.
 * @returns {Promise<void>}
 */
export function loadRazorpay() {
  if (_razorpayLoaded || typeof window.Razorpay !== 'undefined') {
    _razorpayLoaded = true;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/razorpay.js';
    script.onload = () => {
      _razorpayLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load razorpay.js'));
    document.head.appendChild(script);
  });
}
