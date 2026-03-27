/**
 * AltScalp PRO — Firebase ID Token Authentication Middleware
 * ✅ Verifies Firebase ID token from Authorization header
 * ✅ Attaches decoded uid to req.uid for downstream use
 * ✅ Returns 401 if token is missing, expired, or invalid
 */

'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

/**
 * Express middleware that verifies the Firebase ID token in the Authorization header.
 * Successful verification attaches `req.uid` and `req.decodedToken`.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: missing token' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid = decoded.uid;
    req.decodedToken = decoded;
    next();
  } catch (err) {
    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: 'Session expired. Please sign in again.' });
    }
    console.error('[authenticateToken] Verification failed:', err.code || err.message);
    return res.status(401).json({ message: 'Unauthorized: invalid token' });
  }
}

module.exports = authenticateToken;
