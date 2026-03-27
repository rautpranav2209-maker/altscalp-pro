/**
 * AltScalp PRO — WebSocket Server
 * Streams live cryptocurrency prices to connected clients every 10 seconds.
 *
 * Usage (attach to an existing HTTP server):
 *   const { attachWebSocket } = require('./websocket');
 *   attachWebSocket(httpServer);
 *
 * Or run standalone:
 *   node api/websocket.js
 *
 * Clients receive JSON messages:
 *   { type: 'prices', data: { SYMBOL: { price, change24h, volume } }, ts: <epoch ms> }
 *   { type: 'error',  message: '<reason>' }
 */

'use strict';

const { WebSocketServer } = require('ws');
const { getLivePrices }   = require('./prices');

const BROADCAST_INTERVAL_MS = 10_000; // 10 seconds

/**
 * Attach a WebSocket server to an existing HTTP/HTTPS server instance.
 *
 * @param {import('http').Server} httpServer - Express / Node HTTP server
 * @returns {WebSocketServer} The ws server instance
 */
function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  console.log('[websocket] WebSocket server attached to HTTP server');

  wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    console.log(`[websocket] Client connected: ${clientIp}`);

    // Send latest prices immediately on connect
    sendPrices(ws);

    ws.on('error', (err) => {
      console.error('[websocket] Client error:', err.message);
    });

    ws.on('close', () => {
      console.log(`[websocket] Client disconnected: ${clientIp}`);
    });
  });

  // Broadcast to all connected clients every 10 seconds
  const broadcastTimer = setInterval(() => {
    broadcastPrices(wss);
  }, BROADCAST_INTERVAL_MS);

  // Clean up the timer when the ws server closes
  wss.on('close', () => {
    clearInterval(broadcastTimer);
    console.log('[websocket] Server closed, broadcast timer cleared');
  });

  return wss;
}

/**
 * Send live prices to a single WebSocket client.
 * @param {import('ws').WebSocket} ws
 */
async function sendPrices(ws) {
  if (ws.readyState !== ws.OPEN) return;

  try {
    const data = await getLivePrices();
    ws.send(JSON.stringify({ type: 'prices', data, ts: Date.now() }));
  } catch (err) {
    console.error('[websocket] Failed to fetch prices:', err.message);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to fetch prices' }));
    }
  }
}

/**
 * Broadcast live prices to all connected WebSocket clients.
 * @param {WebSocketServer} wss
 */
async function broadcastPrices(wss) {
  let data;
  try {
    data = await getLivePrices();
  } catch (err) {
    console.error('[websocket] Broadcast fetch error:', err.message);
    const errMsg = JSON.stringify({ type: 'error', message: 'Failed to fetch prices' });
    wss.clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) ws.send(errMsg);
    });
    return;
  }

  const message = JSON.stringify({ type: 'prices', data, ts: Date.now() });
  let sent = 0;
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
      sent++;
    }
  });

  if (sent > 0) {
    console.log(`[websocket] Broadcast prices to ${sent} client(s)`);
  }
}

module.exports = { attachWebSocket, broadcastPrices };

// ── Standalone entry point ────────────────────────────────────────────────────
if (require.main === module) {
  const http = require('http');
  const PORT = process.env.WS_PORT || process.env.PORT || 3001;

  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'altscalp-pro-ws' }));
  });

  attachWebSocket(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`[websocket] Standalone server listening on ws://localhost:${PORT}`);
  });
}
