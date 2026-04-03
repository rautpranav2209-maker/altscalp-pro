/**
 * AltScalp PRO — WebSocket Server
 * Standalone WebSocket server using the `ws` package.
 * Broadcasts real-time price ticks and signal events to all connected clients.
 * Includes keepalive ping/pong to detect stale connections.
 *
 * Usage (local dev):
 *   node api/utils/wsServer.js
 *
 * Environment variables:
 *   WS_PORT    — WebSocket listen port (default: 3002)
 *   WS_SECRET  — Optional shared secret for auth handshake
 */

'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { generateSignals } = require('./signalEngine');

const WS_PORT = parseInt(process.env.WS_PORT || '3002', 10);
const WS_SECRET = process.env.WS_SECRET || '';

// ── Server setup ──────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT });

console.log(`[wsServer] WebSocket server listening on port ${WS_PORT}`);

// ── Keepalive (ping every 30s, drop unresponsive clients after 60s) ───────────
const PING_INTERVAL_MS = 30_000;

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  console.log(`[wsServer] Client connected from ${ip}`);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      // Simple auth handshake: { type: 'auth', secret: '...' }
      if (msg.type === 'auth') {
        if (WS_SECRET && msg.secret !== WS_SECRET) {
          ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
          ws.terminate();
          return;
        }
        ws.authenticated = true;
        ws.send(JSON.stringify({ type: 'auth', status: 'ok' }));
      }
    } catch (_) { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    console.log(`[wsServer] Client from ${ip} disconnected`);
  });

  ws.on('error', err => {
    console.warn(`[wsServer] Client error from ${ip}:`, err.message);
  });

  // Send a welcome message immediately
  safeSend(ws, { type: 'connected', ts: Date.now() });
});

// ── Broadcast helper ──────────────────────────────────────────────────────────
function safeSend(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch (_) { /* ignore */ }
}

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  let count = 0;
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); count++; } catch (_) { /* ignore */ }
    }
  });
  return count;
}

// ── Keepalive ping loop ───────────────────────────────────────────────────────
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, PING_INTERVAL_MS);

wss.on('close', () => clearInterval(pingInterval));

// ── Price tick broadcaster ────────────────────────────────────────────────────
// In production the caller (e.g. a cron or the prices endpoint) calls
// broadcastPriceTick(). When running standalone it simulates ticks.

/**
 * Broadcast a price tick event to all connected WebSocket clients.
 * @param {Object[]} pairs - Array of pair objects with at minimum { p, price }
 */
function broadcastPriceTick(pairs) {
  broadcast({ type: 'price_tick', pairs, ts: Date.now() });
}

/**
 * Broadcast a signal event to all connected WebSocket clients.
 * @param {Object[]} signals - Array of signal objects { pair, sig, side, tf }
 */
function broadcastSignals(signals) {
  broadcast({ type: 'signals', signals, ts: Date.now() });
}

// ── Standalone mode: simulate price ticks every 2s for testing ───────────────
if (require.main === module) {
  const { calcSig } = require('./signalEngine');
  // Minimal mock pairs for testing
  const mockPairs = [
    { p: 'SOL',  price: 148.2, chg: 0.3,  ob: 0.2,  rsi: 55, vd: 0.3,  fr: 0.01, sp: 3,  sent: 0.2,  liq: 0.85, vol: 150, corr: 0.82 },
    { p: 'AVAX', price: 38.4,  chg: -0.2, ob: -0.1, rsi: 45, vd: -0.2, fr: -0.01, sp: 3.5, sent: -0.1, liq: 0.75, vol: 130, corr: 0.76 },
  ];

  setInterval(() => {
    // Simulate small price drift
    mockPairs.forEach(p => {
      p.price = +(p.price * (1 + (Math.random() - 0.5) * 0.002)).toFixed(6);
      p.chg   = +(p.chg + (Math.random() - 0.5) * 0.1).toFixed(3);
    });

    const withSigs = generateSignals(mockPairs);
    broadcastPriceTick(mockPairs);
    broadcastSignals(withSigs.map(d => ({ pair: d.p, sig: d.sig, side: d.sig > 0.5 ? 'long' : d.sig < -0.5 ? 'short' : 'wait', tf: '1m' })));
  }, 2000);
}

module.exports = { wss, broadcast, broadcastPriceTick, broadcastSignals };
