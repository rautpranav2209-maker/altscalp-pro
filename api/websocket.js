/**
 * AltScalp PRO — WebSocket Price Streaming Server
 * ✅ Pushes live price updates to connected clients every 10 seconds
 * ✅ Graceful shutdown support
 * ✅ Per-client heartbeat (ping/pong) to detect stale connections
 */

'use strict';

const { WebSocketServer, OPEN } = require('ws');
const { getLivePrices } = require('./prices');

const PUSH_INTERVAL_MS  = 10_000; // 10 seconds
const PING_INTERVAL_MS  = 30_000; // 30 seconds

let wss = null;
let pushTimer = null;
let pingTimer = null;

/**
 * Attach a WebSocket server to an existing HTTP/HTTPS server instance.
 * Prices are broadcast to all connected clients every 10 seconds.
 *
 * @param {import('http').Server} httpServer - The HTTP server to attach to
 * @returns {WebSocketServer}
 */
function attachWebSocketServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws/prices' });

  wss.on('connection', (socket, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    console.log(`[ws] Client connected: ${clientIp}`);

    // Mark the socket as alive for ping/pong tracking
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    // Send current prices immediately on connect
    getLivePrices()
      .then(prices => {
        if (socket.readyState === OPEN) {
          socket.send(JSON.stringify({ type: 'prices', data: prices, ts: Date.now() }));
        }
      })
      .catch(err => console.error('[ws] Initial price send failed:', err.message));

    socket.on('error', err => console.error('[ws] Socket error:', err.message));
    socket.on('close', () => console.log(`[ws] Client disconnected: ${clientIp}`));
  });

  // Broadcast updated prices to all live clients every 10 seconds
  pushTimer = setInterval(async () => {
    if (!wss || wss.clients.size === 0) return;

    let prices;
    try {
      prices = await getLivePrices();
    } catch (err) {
      console.error('[ws] Price fetch for broadcast failed:', err.message);
      return;
    }

    const message = JSON.stringify({ type: 'prices', data: prices, ts: Date.now() });
    for (const client of wss.clients) {
      if (client.readyState === OPEN) {
        client.send(message);
      }
    }
  }, PUSH_INTERVAL_MS);

  // Terminate stale connections that missed two consecutive pings
  pingTimer = setInterval(() => {
    if (!wss) return;
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, PING_INTERVAL_MS);

  wss.on('error', err => console.error('[ws] Server error:', err.message));

  console.log('[ws] WebSocket price streaming server attached at /ws/prices');
  return wss;
}

/**
 * Gracefully stop the WebSocket server and clear all timers.
 * @returns {Promise<void>}
 */
function closeWebSocketServer() {
  clearInterval(pushTimer);
  clearInterval(pingTimer);
  pushTimer = null;
  pingTimer = null;

  return new Promise((resolve, reject) => {
    if (!wss) return resolve();
    wss.close(err => {
      wss = null;
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports = { attachWebSocketServer, closeWebSocketServer };
