// Client for the /ws/cobrowse relay — same protocol as client/src/experience/useCobrowse.js and
// both Expo apps' copies of this file. Node's `ws` package stands in for the browser WebSocket API.
// This daemon only ever needs `role=viewer` on the long-lived device room (see daemon.js) — it
// listens for {cmd:'load'|'idle'} commands; it never sends state itself.
import WebSocket from 'ws';
import { wsOrigin } from './config.js';

export class CobrowseSocket {
  #ws = null;
  #closedByUser = false;
  #retryDelayMs = 1000;
  #retryTimer = null;
  #listeners = new Set();

  constructor(sessionId, role) {
    this.sessionId = sessionId;
    this.role = role;
  }

  connect() {
    this.#closedByUser = false;
    this.#open();
  }

  #open() {
    const url = `${wsOrigin()}/ws/cobrowse?session=${encodeURIComponent(this.sessionId)}&role=${this.role}`;
    const ws = new WebSocket(url);
    this.#ws = ws;

    ws.on('open', () => {
      this.#retryDelayMs = 1000;
      console.log(`[cobrowse:${this.role}] connected (session=${this.sessionId})`);
    });
    ws.on('message', (buf) => {
      let message;
      try {
        message = JSON.parse(buf.toString());
      } catch {
        return;
      }
      for (const listener of this.#listeners) listener(message);
    });
    ws.on('close', () => {
      console.log(`[cobrowse:${this.role}] disconnected, retrying in ${this.#retryDelayMs}ms`);
      this.#scheduleReconnect();
    });
    ws.on('error', (err) => {
      console.error(`[cobrowse:${this.role}] error`, err.message);
      try {
        ws.close();
      } catch {
        // ignore
      }
    });
  }

  #scheduleReconnect() {
    if (this.#closedByUser || this.#retryTimer) return;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#open();
    }, this.#retryDelayMs);
    this.#retryDelayMs = Math.min(this.#retryDelayMs * 2, 30_000);
  }

  send(state) {
    if (this.role !== 'presenter') return;
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify({ t: 'state', state }));
  }

  onMessage(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close() {
    this.#closedByUser = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    try {
      this.#ws?.close();
    } catch {
      // ignore
    }
    this.#ws = null;
  }
}
