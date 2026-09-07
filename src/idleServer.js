// Local HTTP + WS server serving the kiosk's default/idle page (pairing code + QR). The daemon
// pushes live updates (a fresh code, connection status) over the WS so the page never needs a
// full reload — CDP navigation only happens when actually switching to/from a presentation.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { IDLE_SERVER_PORT } from './config.js';

const IDLE_HTML_PATH = fileURLToPath(new URL('../public/idle.html', import.meta.url));

export function startIdleServer() {
  const server = createServer(async (req, res) => {
    if (req.url === '/idle' || req.url === '/') {
      try {
        const html = await readFile(IDLE_HTML_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500);
        res.end(`idle.html missing: ${err.message}`);
      }
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  const wss = new WebSocketServer({ server, path: '/idle-ws' });
  const clients = new Set();
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  server.listen(IDLE_SERVER_PORT, () => {
    console.log(`[idle-server] listening on http://localhost:${IDLE_SERVER_PORT}/idle`);
  });

  return {
    /** Push the current pairing info to whatever's showing the idle page right now. */
    broadcast(data) {
      const payload = JSON.stringify(data);
      for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(payload);
    },
    url: `http://localhost:${IDLE_SERVER_PORT}/idle`,
  };
}
