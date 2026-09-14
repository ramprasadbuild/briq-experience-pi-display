// Client for the cloud /ws/cobrowse relay — the same protocol as the controller's
// src/cobrowse.ts. The box only ever joins as `role=viewer` on its device room
// (`device-<device_id>`) and forwards what it receives to the local relay (§6.1 cloud fallback).
import WebSocket from 'ws';
import { wsOrigin } from './config.js';

export class CobrowseSocket {
  #ws = null;
  #closedByUser = false;
  #retryDelayMs = 1000;
  #retryTimer = null;
  #listeners = new Set();

  constructor(sessionId, role, { origin = wsOrigin(), log = console } = {}) {
    this.sessionId = sessionId;
    this.role = role;
    this.origin = origin;
    this.log = log;
    this.connected = false;
  }

  connect() {
    this.#closedByUser = false;
    this.#open();
  }

  #open() {
    const url = `${this.origin}/ws/cobrowse?session=${encodeURIComponent(this.sessionId)}&role=${this.role}`;
    const ws = new WebSocket(url);
    this.#ws = ws;

    ws.on('open', () => {
      this.#retryDelayMs = 1000;
      this.connected = true;
      this.log.info?.(`[cobrowse:${this.role}] connected (session=${this.sessionId})`);
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
      if (this.connected) this.log.info?.(`[cobrowse:${this.role}] disconnected`);
      this.connected = false;
      this.#scheduleReconnect();
    });
    ws.on('error', () => {
      try {
        ws.close();
      } catch {
        // ignore — close still fires and schedules the retry
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
    if (this.role !== 'presenter') return false;
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify({ t: 'state', state }));
      return true;
    }
    return false;
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
