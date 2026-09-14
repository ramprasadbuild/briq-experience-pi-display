// The box's control loop: register (§1.3), a heartbeat every 30 s (§2.2) that reports LAN
// addresses, relay port, storage, content and sync state, reacts to `projects` etags by syncing,
// and runs + acks server commands. Degrades against a legacy backend: heartbeat `{}` means we fall
// back to re-calling register for a fresh pairing code and polling the manifest ourselves.
import { EventEmitter } from 'node:events';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './api.js';
import { orgBranding } from './identity.js';

const RETRY_SAME_TARGET_MS = 5 * 60_000;

export class DeviceAgent extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('./identity.js').IdentityStore} o.identity
   * @param {import('./api.js').ApiClient} o.api
   * @param {import('./content/store.js').ContentStore} o.store
   * @param {import('./content/sync.js').SyncAgent} o.sync
   * @param {{restartBrowser: Function, reboot: Function}} o.kiosk
   */
  constructor({
    identity, api, store, sync, kiosk, dataDir, appVersion, port,
    lanAddresses = () => [], storage = async () => ({ total_bytes: null, free_bytes: null }),
    heartbeatMs = 30_000, manifestPollMs = 15 * 60_000, rebootDelayMs = 1500, log = console,
  }) {
    super();
    Object.assign(this, { identity, api, store, sync, kiosk, appVersion, port, lanAddresses, storage, heartbeatMs, manifestPollMs, rebootDelayMs, log });
    this.commandsFile = join(dataDir, 'commands.json');
    this.handled = [];
    this.pendingAcks = [];
    this.online = false;
    this.legacy = false;
    this.lastHeartbeatAt = null;
    this.lastError = null;
    this.lastManifestPollAt = 0;
    this.failedTarget = null;
    this.commandChain = Promise.resolve();
    this.timer = null;
    this.stopped = false;
    this.ticking = null;
  }

  async start() {
    await this.#loadCommandLog();
    this.sync.on('state', () => this.emit('status'));
    this.sync.on('switched', () => { this.failedTarget = null; this.emit('status'); });
    this.stopped = false;
    const loop = async () => {
      await this.tick();
      if (!this.stopped) this.timer = setTimeout(loop, this.heartbeatMs);
    };
    loop();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  buildReport() {
    return this.storage().then((storage) => ({
      app_version: this.appVersion,
      lan_addresses: this.lanAddresses(),
      local_relay_port: this.port,
      storage,
      content: this.store.contentMap(),
      sync: this.sync.status(),
    }));
  }

  /** One heartbeat round. Never throws. */
  tick() {
    if (this.ticking) return this.ticking;
    this.ticking = this.#tick().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  async #tick() {
    try {
      const id = this.identity.get();
      if (id.device_id == null || (!id.device_secret && !this.registeredOnce)) {
        await this.api.register();
        this.registeredOnce = true;
        this.emit('status');
      }
      let response;
      try {
        response = await this.api.heartbeat(await this.buildReport());
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403 || err.status === 404)) {
          // Secret rejected or the row is gone: register again (the backend may issue a new id).
          this.log.warn?.(`[device] heartbeat HTTP ${err.status}; re-registering`);
          await this.api.register();
          response = await this.api.heartbeat(await this.buildReport());
        } else {
          throw err;
        }
      }
      this.online = true;
      this.lastError = null;
      this.lastHeartbeatAt = new Date().toISOString();
      await this.handleHeartbeatResponse(response);
    } catch (err) {
      this.online = false;
      this.lastError = err.message;
      this.log.warn?.(`[device] heartbeat failed: ${err.message}`);
    }
    await this.flushAcks();
    this.emit('status');
  }

  async handleHeartbeatResponse(res) {
    const isContract = res && typeof res === 'object' && ('claimed' in res || 'commands' in res || 'projects' in res);
    this.legacy = !isContract;
    if (!isContract) {
      // Legacy backend (`{}`): pairing code only comes from register; content only via polling.
      try {
        await this.api.register();
      } catch (err) {
        this.log.warn?.(`[device] pairing refresh failed: ${err.message}`);
      }
      if (Date.now() - this.lastManifestPollAt >= this.manifestPollMs) {
        this.lastManifestPollAt = Date.now();
        this.sync.request('poll').catch(() => {});
      }
      return;
    }

    const patch = {};
    if (typeof res.claimed === 'boolean') patch.claimed = res.claimed;
    if ('pairing_code' in res) patch.pairing_code = res.pairing_code ?? null;
    if ('pairing_code_expires_at' in res) patch.pairing_code_expires_at = res.pairing_code_expires_at ?? null;
    if ('name' in res) patch.name = res.name ?? null;
    if ('org' in res) patch.org = orgBranding(res.org);
    if ('relay_key' in res) patch.relay_key = res.relay_key ?? null;
    const before = this.identity.get().relay_key;
    await this.identity.update(patch);
    if ('relay_key' in res && before !== (res.relay_key ?? null)) this.emit('relay_key', res.relay_key ?? null);

    if (Array.isArray(res.projects)) this.#maybeSync(res.projects);
    if (Array.isArray(res.commands) && res.commands.length) this.processCommands(res.commands);
  }

  #maybeSync(projects) {
    const content = this.store.contentMap();
    const wanted = new Map(projects.filter((p) => p?.slug).map((p) => [p.slug, p.etag ?? null]));
    const differs = wanted.size !== Object.keys(content).length
      || [...wanted].some(([slug, etag]) => content[slug]?.etag !== etag);
    if (!differs) {
      this.failedTarget = null;
      return;
    }
    const target = JSON.stringify([...wanted].sort());
    if (this.sync.running) return;
    if (this.failedTarget?.key === target && Date.now() - this.failedTarget.at < RETRY_SAME_TARGET_MS) return;
    this.sync.request('heartbeat').then((result) => {
      this.failedTarget = result.ok ? null : { key: target, at: Date.now() };
    });
  }

  /** Queues commands (serially, deduplicated by id). Returns the queue's promise, for tests. */
  processCommands(commands) {
    for (const command of commands) {
      if (command?.id == null || this.handled.includes(command.id)) continue;
      this.handled.push(command.id);
      if (this.handled.length > 200) this.handled.splice(0, this.handled.length - 200);
      this.commandChain = this.commandChain.then(() => this.#run(command)).catch((err) => {
        this.log.error?.(`[device] command ${command.id} crashed: ${err.stack ?? err}`);
      });
    }
    this.#saveCommandLog().catch(() => {});
    return this.commandChain;
  }

  async #run(command) {
    const { id, command: name, args = {} } = command;
    this.log.info?.(`[device] command ${id}: ${name} ${JSON.stringify(args ?? {})}`);
    switch (name) {
      case 'sync': {
        const result = await this.sync.request('command');
        return this.ack(id, result.ok, { content: result.content, updated: result.updated ?? [], removed: result.removed ?? [], error: result.error ?? null });
      }
      case 'restart_browser': {
        try {
          return this.ack(id, true, await this.kiosk.restartBrowser(args ?? {}));
        } catch (err) {
          return this.ack(id, false, { error: err.message });
        }
      }
      case 'reboot': {
        await this.ack(id, true, { rebooting_in_ms: this.rebootDelayMs });
        setTimeout(() => this.kiosk.reboot().catch((err) => this.log.error?.(`[device] reboot failed: ${err.message}`)), this.rebootDelayMs);
        return undefined;
      }
      case 'identify': {
        const seconds = Number(args?.seconds) > 0 ? Number(args.seconds) : 10;
        this.emit('identify', { name: this.identity.get().name, device_id: this.identity.get().device_id, seconds });
        return this.ack(id, true, { seconds });
      }
      case 'unpair': {
        // Ack while the secret still authenticates, then wipe.
        await this.ack(id, true, {});
        await this.flushAcks();
        this.sync.abort();
        await this.sync.running?.catch(() => {});
        await this.store.wipe();
        await this.identity.wipeSecret();
        this.registeredOnce = false;
        this.emit('unpaired');
        this.emit('relay_key', null);
        try {
          await this.api.register();
          this.registeredOnce = true;
        } catch (err) {
          this.log.warn?.(`[device] re-register after unpair failed: ${err.message}`);
        }
        this.emit('status');
        return undefined;
      }
      default:
        return this.ack(id, false, { error: 'unknown_command', command: name });
    }
  }

  async ack(commandId, ok, result = {}) {
    this.pendingAcks.push({ id: commandId, ok: !!ok, result });
    await this.#saveCommandLog();
    await this.flushAcks();
  }

  /** Sends queued acks in order. Concurrent callers share one flush (no double-posting). */
  flushAcks() {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        await this.#flushOnce();
      } while (this.flushAgain);
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async #flushOnce() {
    while (this.pendingAcks.length) {
      const next = this.pendingAcks[0];
      try {
        await this.api.ackCommand(next.id, { ok: next.ok, result: next.result });
      } catch (err) {
        if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429) {
          this.log.warn?.(`[device] dropping ack ${next.id}: ${err.message}`);
        } else {
          this.log.warn?.(`[device] ack ${next.id} deferred: ${err.message}`);
          return;
        }
      }
      this.pendingAcks.shift();
      await this.#saveCommandLog();
    }
  }

  async #loadCommandLog() {
    try {
      const json = JSON.parse(await readFile(this.commandsFile, 'utf8'));
      this.handled = Array.isArray(json.handled) ? json.handled : [];
      this.pendingAcks = Array.isArray(json.pending_acks) ? json.pending_acks : [];
    } catch {
      // first run
    }
  }

  /** Serialised: concurrent acks must not race on the tmp file. */
  #saveCommandLog() {
    this.saveChain = (this.saveChain ?? Promise.resolve()).then(async () => {
      const tmp = `${this.commandsFile}.tmp`;
      await writeFile(tmp, JSON.stringify({ handled: this.handled, pending_acks: this.pendingAcks }));
      await rename(tmp, this.commandsFile);
    }).catch((err) => this.log.warn?.(`[device] could not save command log: ${err.message}`));
    return this.saveChain;
  }

  status() {
    const id = this.identity.get();
    return {
      device_id: id.device_id,
      name: id.name,
      org: id.claimed ? id.org ?? null : null,
      claimed: !!id.claimed,
      pairing_code: id.claimed ? null : id.pairing_code,
      pairing_code_expires_at: id.claimed ? null : id.pairing_code_expires_at,
      has_secret: !!id.device_secret,
      relay_ready: !!id.relay_key,
      online: this.online,
      legacy_backend: this.legacy,
      last_heartbeat_at: this.lastHeartbeatAt,
      last_error: this.lastError,
      app_version: this.appVersion,
      lan_addresses: this.lanAddresses(),
      port: this.port,
      sync: this.sync.status(),
      content_unavailable: !!this.sync.lastResult?.unavailable,
      projects: this.store.listProjects(),
    };
  }
}
