/**
 * AltScalp PRO — WebSocket Server for Real-time Price & Signal Updates
 *
 * NOTE: Vercel serverless functions do not support persistent WebSocket
 * connections. This file implements a standalone WebSocket server intended
 * to run as a long-lived Node.js process (e.g. Railway, Render, Fly.io)
 * or alongside the Vercel deployment as a separate micro-service.
 *
 * Clients connect to ws://<WS_SERVER_HOST> and receive JSON messages of
 * the following shapes:
 *
 *   { type: 'prices',  data: [{ pair, price, chg, ... }] }
 *   { type: 'signal',  data: { pair, sig1m, sig5m, action, confirmed } }
 *   { type: 'ping' }
 *
 * Environment variables:
 *   WS_PORT   — TCP port to listen on (default 8080)
 *   WS_SECRET — Optional shared secret for simple auth (header: x-ws-secret)
 */

const { WebSocketServer } = require('ws');
const { generateSignals } = require('./signalEngine');

const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 8080;
const WS_SECRET = process.env.WS_SECRET || null;

// In-memory price cache shared across the process
let priceCache = [];

/**
 * Broadcast a JSON message to all connected clients.
 * @param {WebSocketServer} wss
 * @param {Object} payload
 */
function broadcast(wss, payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  });
}

/**
 * Simulate realistic price tick updates.
 * In production replace this with a real exchange WebSocket feed
 * (e.g. Binance wss://stream.binance.com:9443/ws).
 * @param {Array} pairs - Current PAIRS array
 * @returns {Array} Updated pairs
 */
function applyTick(pairs) {
  return pairs.map(p => {
    const drift  = (Math.random() - 0.495) * 0.002; // slight upward bias
    const newPrice = p.price * (1 + drift);
    const chg = +((p.chg || 0) + drift * 100 * 0.1).toFixed(3);
    return {
      ...p,
      price: +newPrice.toFixed(Math.abs(newPrice) < 0.01 ? 8 : Math.abs(newPrice) < 1 ? 6 : 4),
      chg:   Math.max(-15, Math.min(15, chg))
    };
  });
}

/**
 * Start the WebSocket server.
 * @param {Array} [initialPairs=[]] - Seed price data
 * @returns {WebSocketServer}
 */
function startWsServer(initialPairs = []) {
  priceCache = initialPairs;

  const wss = new WebSocketServer({ port: PORT });

  wss.on('listening', () => {
    console.log(`[WS] Server listening on port ${PORT}`);
  });

  wss.on('connection', (ws, req) => {
    // Optional simple secret check
    if (WS_SECRET) {
      const secret = req.headers['x-ws-secret'];
      if (secret !== WS_SECRET) {
        ws.close(4001, 'Unauthorized');
        return;
      }
    }

    console.log('[WS] Client connected');

    // Keepalive: mark alive on connect and on each pong
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Send current cache immediately on connect
    if (priceCache.length) {
      ws.send(JSON.stringify({ type: 'prices', data: priceCache }));
    }

    ws.on('message', msg => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch { /* ignore malformed messages */ }
    });

    ws.on('close', () => console.log('[WS] Client disconnected'));
    ws.on('error', err => console.error('[WS] Client error:', err.message));
  });

  // Broadcast price ticks every 1 second
  setInterval(() => {
    if (!wss.clients.size) return;
    priceCache = applyTick(priceCache);
    broadcast(wss, { type: 'prices', data: priceCache });
  }, 1000);

  // Broadcast signal updates every 5 seconds for the top pairs
  setInterval(() => {
    if (!wss.clients.size || !priceCache.length) return;
    const topPairs = priceCache.slice(0, 10);
    topPairs.forEach(pair => {
      const signals = generateSignals(pair);
      if (signals.action !== 'HOLD') {
        broadcast(wss, {
          type: 'signal',
          data: { pair: pair.p, ...signals, price: pair.price, at: Date.now() }
        });
      }
    });
  }, 5000);

  // Keepalive ping to detect stale connections
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  return wss;
}

// Allow running as a standalone process
if (require.main === module) {
  startWsServer();
}

module.exports = { startWsServer, broadcast };
