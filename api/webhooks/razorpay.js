const admin = require('firebase-admin');

// IMPORTANT: Set these Environment Variables in Vercel
// FIREBASE_SERVICE_ACCOUNT (Base64 string of your service account JSON)
// RAZORPAY_WEBHOOK_SECRET

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString());
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const event = req.body;
  
  // Basic validation of the event structure
  if (event.event === 'payment.captured') {
    const payment = event.payload.payment.entity;
    const email = payment.email;
    const amount = payment.amount; // in paise
    const paymentId = payment.id;

    try {
      // 1. Find the user by email in Firestore
      const usersRef = db.collection('users');
      const snapshot = await usersRef.where('email', '==', email).limit(1).get();

      if (snapshot.empty) {
        console.error(`User with email ${email} not found for payment ${paymentId}`);
        return res.status(404).json({ status: 'user_not_found' });
      }

      const userDoc = snapshot.docs[0];
      const userId = userDoc.id;

      // 2. Determine plan and expiry based on amount
      let plan = 'monthly';
      let monthsToAdd = 1;
      if (amount === 455000) { // ₹4,550
        plan = 'yearly';
        monthsToAdd = 12;
      }

      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);

      // 3. Update User to PRO
      await usersRef.doc(userId).update({
        isPro: true,
        plan: plan,
        expiryDate: admin.firestore.Timestamp.fromDate(expiryDate),
        lastPaymentId: paymentId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`Successfully upgraded ${email} to PRO via webhook.`);
      return res.status(200).json({ status: 'success' });
    } catch (error) {
      console.error('Webhook Error:', error);
      return res.status(500).json({ status: 'error', message: error.message });
    }
  }

  res.status(200).json({ status: 'ignored' });
};
