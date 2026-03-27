/**
 * AltScalp PRO — Alert Persistence (Firestore)
 *
 * Intercepts calls to addAlert() and also saves each alert to Firestore
 * under users/{uid}/alerts/{alertId}.
 *
 * Include this script AFTER the main app script and firebase-firestore.js.
 *
 * Usage: <script src="/frontend/alert-persistence.js"></script>
 */

(function () {
  'use strict';

  const COLLECTION = 'alerts';
  const MAX_LOCAL  = 100; // keep at most this many alerts in the in-memory array

  /**
   * Persist a single alert object to Firestore.
   * Silently no-ops if db or user is unavailable.
   * @param {Object} alertData
   */
  async function saveAlertToFirestore(alertData) {
    const db   = window.db;
    const user = window.firebase?.auth?.()?.currentUser;

    if (!db || !user) return; // not logged in or Firestore not ready

    try {
      await db
        .collection('users').doc(user.uid)
        .collection(COLLECTION)
        .add({
          ...alertData,
          uid:       user.uid,
          createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
      console.warn('[alert-persistence] Firestore write failed:', err.message);
    }
  }

  /**
   * Wrap the existing addAlert function so every new alert is also
   * persisted to Firestore without changing any existing behaviour.
   */
  function patchAddAlert() {
    const original = window.addAlert;
    if (typeof original !== 'function') return;

    window.addAlert = function patchedAddAlert() {
      // Call the original — it creates the DOM element and plays sounds
      original.apply(this, arguments);

      // Now capture the alert that was just appended to the feed
      const feed = document.getElementById('alert-feed');
      if (!feed || !feed.firstChild) return;

      const el    = feed.firstChild;
      const title = el.querySelector('.alert-title')?.textContent || '';
      const desc  = el.querySelector('.alert-desc')?.textContent  || '';
      const time  = el.querySelector('.alert-time')?.textContent  || '';

      const alertData = {
        title,
        description: desc,
        time,
        ts: Date.now()
      };

      // Trim in-memory array to prevent unbounded growth
      if (Array.isArray(window.alerts) && window.alerts.length >= MAX_LOCAL) {
        window.alerts.splice(MAX_LOCAL - 1);
      }

      saveAlertToFirestore(alertData);
    };
  }

  /**
   * Load recent alerts from Firestore and prepend them to the feed UI.
   * Runs once at startup to restore alerts that survived a page refresh.
   */
  async function loadAlertsFromFirestore() {
    const db   = window.db;
    const user = window.firebase?.auth?.()?.currentUser;

    if (!db || !user) return;

    try {
      const snap = await db
        .collection('users').doc(user.uid)
        .collection(COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

      if (snap.empty) return;

      const feed = document.getElementById('alert-feed');
      if (!feed) return;

      snap.forEach(doc => {
        const a = doc.data();
        const el = document.createElement('div');
        el.className = 'alert-item';
        el.dataset.firestoreId = doc.id;
        el.innerHTML = `
          <span class="alert-icon" style="background:rgba(79,163,255,.15)">
            <span style="color:#4fa3ff;font-weight:700">★</span>
          </span>
          <div class="alert-body">
            <div class="alert-title">${a.title || ''}</div>
            <div class="alert-desc">${a.description || ''}</div>
            <div class="alert-time">${a.time || ''}</div>
          </div>`;
        // Historical alerts are appended after any live alerts already in the feed
        feed.appendChild(el);
      });
    } catch (err) {
      console.warn('[alert-persistence] Firestore read failed:', err.message);
    }
  }

  // ── Initialise ─────────────────────────────────────────────────────────────
  // Wait for Firebase auth state before patching, so we have a valid user
  function init() {
    if (window.firebase?.auth) {
      window.firebase.auth().onAuthStateChanged(user => {
        if (user) {
          patchAddAlert();
          loadAlertsFromFirestore();
        }
      });
    } else {
      // Retry once DOM is ready
      document.addEventListener('DOMContentLoaded', () => {
        if (window.firebase?.auth) {
          window.firebase.auth().onAuthStateChanged(user => {
            if (user) {
              patchAddAlert();
              loadAlertsFromFirestore();
            }
          });
        }
      });
    }
  }

  init();

  // Expose for debugging
  window._alertPersistence = { saveAlertToFirestore, loadAlertsFromFirestore };
}());
