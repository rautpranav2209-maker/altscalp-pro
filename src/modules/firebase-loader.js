/**
 * Lazy loader for Firebase services.
 * Dynamically loads Auth, Firestore, and Analytics only when needed,
 * reducing the initial bundle size significantly.
 */

let _auth = null;
let _firestore = null;
let _analytics = null;

/**
 * Loads firebase-auth.js dynamically and returns the auth module.
 * @returns {Promise<object>} Firebase Auth module
 */
export function loadAuth() {
  if (_auth) return Promise.resolve(_auth);
  return new Promise((resolve, reject) => {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      _auth = firebase.auth();
      return resolve(_auth);
    }
    const script = document.createElement('script');
    script.src = '/firebase-auth.js';
    script.onload = () => {
      _auth = firebase.auth();
      resolve(_auth);
    };
    script.onerror = () => reject(new Error('Failed to load firebase-auth.js'));
    document.head.appendChild(script);
  });
}

/**
 * Loads firebase-firestore.js dynamically and returns the Firestore module.
 * @returns {Promise<object>} Firebase Firestore module
 */
export function loadFirestore() {
  if (_firestore) return Promise.resolve(_firestore);
  return new Promise((resolve, reject) => {
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      _firestore = firebase.firestore();
      return resolve(_firestore);
    }
    const script = document.createElement('script');
    script.src = '/firebase-firestore.js';
    script.onload = () => {
      _firestore = firebase.firestore();
      resolve(_firestore);
    };
    script.onerror = () => reject(new Error('Failed to load firebase-firestore.js'));
    document.head.appendChild(script);
  });
}

/**
 * Loads firebase-analytics.js dynamically and returns the Analytics module.
 * @returns {Promise<object>} Firebase Analytics module
 */
export function loadAnalytics() {
  if (_analytics) return Promise.resolve(_analytics);
  return new Promise((resolve, reject) => {
    if (typeof firebase !== 'undefined' && firebase.analytics) {
      _analytics = firebase.analytics();
      return resolve(_analytics);
    }
    const script = document.createElement('script');
    script.src = '/firebase-analytics.js';
    script.onload = () => {
      _analytics = firebase.analytics();
      resolve(_analytics);
    };
    script.onerror = () => reject(new Error('Failed to load firebase-analytics.js'));
    document.head.appendChild(script);
  });
}
