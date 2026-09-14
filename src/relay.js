// Local presenter relay (SHOWROOM-CONTRACT §6.1) at ws://<lan>:<port>/relay.
//
//   ?role=presenter&key=<relay_key>  a tablet on the LAN. Wrong/missing key → close 4401.
//   ?role=viewer                     the TV page on this box. Only from loopback → else 4403.
//
// Frames are `{t:'state', state}`. The relay remembers the last command (`present`/`idle`) and
// the last kiosk state and replays them to a viewer that joins, so a Chromium reload lands on the
// right screen. The cloud bridge feeds the same pipe through `inject()`.
import { WebSocketServer } from 'ws';
import { isLoopbackAddress } from './sysinfo.js';

export const CLOSE_BAD_KEY = 4401;
export const CLOSE_NOT_LOCAL = 4403;
export const CLOSE_BAD_ROLE = 4400;

export class LocalRelay {
  /**
   * @param {object} o
   * @param {() => (string|null)} o.getRelayKey current key (null = no presenter can authenticate)
   * @param {(req: import('http').IncomingMessage) => boolean} [o.isLocal]
   */
  constructor({ getRelayKey, isLocal = (req) => isLoopbackAddress(req.socket.remoteAddress), log = console, maxPayload = 256 * 1024 }) {
    this.getRelayKey = getRelayKey;
    this.isLocal = isLocal;
    this.log = log;
    this.wss = new WebSocketServer({ noServer: true, maxPayload });
    this.viewers = new Set();
    this.presenters = new Set();
    this.lastCommand = null;
    this.lastState = null;
    this.listeners = new Set();
    this.wss.on('connection', (ws, req, role) => this.#onConnection(ws, req, role));
  }

  /** Hook for the HTTP server's 'upgrade' event. Returns true if the request was ours. */
  handleUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://local');
    if (url.pathname !== '/relay') return false;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const role = url.searchParams.get('role');
      if (role === 'presenter') {
        const expected = this.getRelayKey();
        const key = url.searchParams.get('key');
        if (!expected || !key || key !== expected) {
          ws.close(CLOSE_BAD_KEY, 'bad relay key');
          return;
        }
      } else if (role === 'viewer') {
        if (!this.isLocal(req)) {
          ws.close(CLOSE_NOT_LOCAL, 'viewer must be local');
          return;
        }
      } else {
        ws.close(CLOSE_BAD_ROLE, 'role must be presenter or viewer');
        return;
      }
      this.wss.emit('connection', ws, req, role);
    });
    return true;
  }

  #onConnection(ws, req, role) {
    const from = req.socket.remoteAddress;
    if (role === 'viewer') {
      this.viewers.add(ws);
      for (const frame of this.replayFrames()) ws.send(frame);
      ws.on('close', () => { this.viewers.delete(ws); this.#presence(); });
      // Viewers are receive-only; anything they send is ignored.
    } else {
      this.presenters.add(ws);
      this.log.info?.(`[relay] presenter connected from ${from}`);
      ws.on('message', (buf) => this.#fromPresenter(buf));
      ws.on('close', () => { this.presenters.delete(ws); this.#presence(); this.log.info?.(`[relay] presenter from ${from} left`); });
    }
    ws.on('error', () => {});
    this.#presence();
  }

  #fromPresenter(buf) {
    let message;
    try {
      message = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (message?.t !== 'state') return;
    this.inject(message.state, 'lan');
  }

  /** Records and forwards one state (from a LAN presenter, or the cloud bridge). */
  inject(state, source = 'cloud') {
    // A LAN presenter owns the TV: the cloud room replays its stale last state to this viewer on
    // every reconnect, so cloud frames are ignored while a presenter is connected on the LAN.
    if (source === 'cloud' && this.presenters.size > 0) {
      if (!this.cloudMuted) this.log.info?.('[relay] cloud frames ignored while a LAN presenter is connected');
      this.cloudMuted = true;
      return;
    }
    this.cloudMuted = false;
    if (state == null || typeof state !== 'object') return;
    if (typeof state.cmd === 'string') {
      this.lastCommand = state;
      // A new present/idle invalidates the previous project's kiosk state.
      if (state.cmd === 'idle' || (state.cmd === 'present' && this.lastState?.slug !== state.slug)) this.lastState = null;
    } else {
      this.lastState = state;
    }
    const frame = JSON.stringify({ t: 'state', state });
    for (const ws of this.viewers) if (ws.readyState === ws.OPEN) ws.send(frame);
    for (const fn of this.listeners) fn(state, source);
  }

  onState(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  replayFrames() {
    const frames = [];
    if (this.lastCommand) frames.push(JSON.stringify({ t: 'state', state: this.lastCommand }));
    if (this.lastState) frames.push(JSON.stringify({ t: 'state', state: this.lastState }));
    return frames;
  }

  #presence() {
    const frame = JSON.stringify({ t: 'presence', presenter: this.presenters.size > 0, viewers: this.viewers.size });
    for (const ws of this.presenters) if (ws.readyState === ws.OPEN) ws.send(frame);
  }

  /** Relay key rotated/cleared (claim, unpair): drop presenters holding the old key. */
  kickPresenters(code = CLOSE_BAD_KEY) {
    for (const ws of this.presenters) ws.close(code, 'relay key changed');
  }

  stats() {
    return { presenters: this.presenters.size, viewers: this.viewers.size };
  }

  close() {
    for (const ws of [...this.viewers, ...this.presenters]) ws.terminate();
    this.wss.close();
  }
}
