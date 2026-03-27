/**
 * AltScalp PRO — Alert Persistence (frontend)
 * Monkey-patches the global addAlert() function to save each new alert to
 * Firestore at users/{uid}/alerts/.
 * On page load, restores the last 20 alerts from Firestore.
 *
 * Requires:
 *  - Firebase JS SDK already initialised (window.db from firebase-firestore.js)
 *  - Firebase Auth (window.auth from firebase-auth.js)
 */

(function () {
  'use strict';

  const MAX_ALERTS_RESTORE = 20;
  const COLLECTION = 'alerts';

  // ── Firestore helpers ─────────────────────────────────────────────────────
  function getUserAlertsRef(uid) {
    // Support both Firestore v9 modular and compat SDK
    if (window.firebase && window.firebase.firestore) {
      return window.firebase.firestore().collection('users').doc(uid).collection('alerts');
    }
    if (window.db && typeof window.db.collection === 'function') {
      return window.db.collection('users').doc(uid).collection('alerts');
    }
    return null;
  }

  async function saveAlertToFirestore(uid, alertData) {
    try {
      const ref = getUserAlertsRef(uid);
      if (!ref) return;
      await ref.add({ ...alertData, savedAt: Date.now() });
    } catch (err) {
      console.debug('[alert-persistence] Save failed:', err.message);
    }
  }

  async function loadAlertsFromFirestore(uid) {
    try {
      const ref = getUserAlertsRef(uid);
      if (!ref) return [];
      const snap = await ref
        .orderBy('savedAt', 'desc')
        .limit(MAX_ALERTS_RESTORE)
        .get();
      return snap.docs.map(d => d.data());
    } catch (err) {
      console.debug('[alert-persistence] Load failed:', err.message);
      return [];
    }
  }

  // ── Restore alerts into the feed ─────────────────────────────────────────
  function restoreAlerts(alerts) {
    if (!alerts.length) return;
    const feed = document.getElementById('alert-feed');
    if (!feed) return;

    // Insert them oldest-first so the feed reads newest-at-top after restore
    const sorted = [...alerts].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    for (const a of sorted) {
      if (!a.html) continue; // skip records without rendered HTML
      const el = document.createElement('div');
      el.className = 'alert-item';
      el.innerHTML = a.html;
      feed.appendChild(el); // append to bottom; newest items are prepended normally
    }

    // Update badge count
    const countEl = document.getElementById('alert-count');
    if (countEl) {
      const current = parseInt(countEl.textContent, 10) || 0;
      countEl.textContent = current + sorted.filter(a => a.html).length;
    }
  }

  // ── Monkey-patch addAlert ─────────────────────────────────────────────────
  function patchAddAlert(uid) {
    const original = window.addAlert;
    if (typeof original !== 'function') {
      // addAlert may not exist yet — retry after a tick
      setTimeout(() => patchAddAlert(uid), 500);
      return;
    }

    window.addAlert = function patchedAddAlert() {
      // Call original first so the DOM element is created
      original.apply(this, arguments);

      // Capture the newly prepended alert element
      const feed = document.getElementById('alert-feed');
      if (!feed || !feed.firstChild) return;
      const el = feed.firstChild;
      const html = el.innerHTML || '';

      // Persist to Firestore asynchronously (fire-and-forget)
      saveAlertToFirestore(uid, { html, ts: Date.now() });
    };

    console.debug('[alert-persistence] addAlert patched for uid:', uid);
  }

  // ── Auth state listener ───────────────────────────────────────────────────
  function waitForAuth() {
    const auth = window.auth || (window.firebase && window.firebase.auth && window.firebase.auth());
    if (!auth) {
      setTimeout(waitForAuth, 500);
      return;
    }

    auth.onAuthStateChanged(async user => {
      if (!user) return; // Not signed in — skip persistence

      const uid = user.uid;

      // Patch addAlert to persist future alerts
      patchAddAlert(uid);

      // Restore last 20 alerts from Firestore
      const saved = await loadAlertsFromFirestore(uid);
      if (saved.length) {
        console.debug(`[alert-persistence] Restoring ${saved.length} alerts for uid:`, uid);
        restoreAlerts(saved);
      }
    });
  }

  // ── Initialise ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForAuth);
  } else {
    waitForAuth();
  }
})();
