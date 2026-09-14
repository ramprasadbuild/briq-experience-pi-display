// The TV sync agent (SHOWROOM-CONTRACT §5): fetch the tv manifest, plan by etag, download what's
// missing (concurrency 2, Range resume, retries with backoff, sha256 verify), write a local
// manifest per project with every payload URL rewritten to /content/files/…, switch atomically,
// then garbage-collect. A failure leaves the live version untouched.
import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';
import { ManifestUnavailableError } from '../api.js';
import { downloadFile, DownloadError } from './download.js';
import { CONTENT_URL_PREFIX, localNameFor, normalizeSha } from './store.js';

export class InsufficientSpaceError extends Error {
  constructor(needBytes, freeBytes) {
    super(`not enough free space: need ${needBytes} bytes, ${freeBytes} free`);
    this.name = 'InsufficientSpaceError';
    this.needBytes = needBytes;
    this.freeBytes = freeBytes;
  }
}

/** Replaces every string in `payload` that exactly equals a manifest `key` with its local path. */
export function rewritePayload(payload, keyToPath) {
  const walk = (value) => {
    if (typeof value === 'string') return keyToPath.has(value) ? keyToPath.get(value) : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  return walk(payload);
}

/**
 * Pure planning step.
 * @param {{projects: Record<string, {etag: string}>}} current live content
 * @param {{projects: object[]}} manifest server manifest
 * @param {(name: string, bytes: number|null) => boolean} hasFile whether a store file is already complete
 * @returns {{keep: string[], update: object[], remove: string[], downloads: Map<string, object>, totalBytes: number}}
 */
export function planSync(current, manifest, hasFile) {
  const keep = [];
  const update = [];
  const downloads = new Map();
  const wanted = new Set();
  for (const project of manifest.projects ?? []) {
    if (!project?.slug) continue;
    wanted.add(project.slug);
    const files = (project.files ?? []).map((f) => ({ ...f, name: localNameFor(f) }));
    const missing = files.filter((f) => !hasFile(f.name, f.bytes ?? null));
    const live = current.projects?.[project.slug];
    if (live && live.etag === project.etag && missing.length === 0) {
      keep.push(project.slug);
      continue;
    }
    update.push({ project, files, missing: missing.map((f) => f.name) });
    for (const f of missing) if (!downloads.has(f.name)) downloads.set(f.name, f);
  }
  const remove = Object.keys(current.projects ?? {}).filter((slug) => !wanted.has(slug));
  let totalBytes = 0;
  for (const f of downloads.values()) totalBytes += Number(f.bytes ?? 0);
  return { keep, update, remove, downloads, totalBytes };
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (ms <= 0) return resolve();
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')); }, { once: true });
});

async function runPool(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

export class SyncAgent extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('./store.js').ContentStore} o.store
   * @param {{manifest: () => Promise<object>}} o.api
   * @param {() => Promise<{free_bytes: number|null}>} [o.storage]
   */
  constructor({ store, api, fetch = globalThis.fetch, concurrency = 2, retries = 4, backoffMs = 2000, minFreeBytes = 0, storage = async () => ({ free_bytes: null }), log = console }) {
    super();
    this.store = store;
    this.api = api;
    this.fetch = fetch;
    this.concurrency = concurrency;
    this.retries = retries;
    this.backoffMs = backoffMs;
    this.minFreeBytes = minFreeBytes;
    this.storage = storage;
    this.log = log;
    this.state = { state: 'idle', progress: 1, error: null };
    this.lastResult = null;
    this.lastSyncAt = null;
    this.running = null;
    this.again = false;
    this.abortController = null;
  }

  status() {
    return { ...this.state };
  }

  #setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.status());
  }

  /** Starts a sync, or joins the running one and schedules another pass right after it. */
  request(reason = 'manual') {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let result;
      do {
        this.again = false;
        result = await this.#runOnce(reason);
      } while (this.again);
      return result;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  abort() {
    this.again = false;
    this.abortController?.abort(new Error('sync aborted'));
  }

  async #runOnce(reason) {
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.#setState({ state: 'syncing', progress: 0, error: null });
    this.log.info?.(`[sync] starting (${reason})`);
    try {
      const manifest = await this.api.manifest();
      const result = await this.apply(manifest, { signal });
      this.lastResult = result;
      this.#setState(result.ok
        ? { state: 'idle', progress: 1, error: null }
        : { state: 'error', progress: this.state.progress, error: result.error });
      return result;
    } catch (err) {
      const error = err instanceof ManifestUnavailableError
        ? `manifest_unavailable: ${err.message}`
        : err.message;
      this.log.warn?.(`[sync] failed: ${error}`);
      const result = { ok: false, changed: false, error, unavailable: err instanceof ManifestUnavailableError, content: this.store.contentMap() };
      this.lastResult = result;
      this.#setState({ state: 'error', error });
      return result;
    } finally {
      this.abortController = null;
    }
  }

  /** Applies a manifest that has already been fetched (also used by tests and prefill). */
  async apply(manifest, { signal } = {}) {
    const store = this.store;
    const present = new Map();
    const hasFileCache = async (name, bytes) => {
      const key = `${name}:${bytes ?? ''}`;
      if (!present.has(key)) present.set(key, await store.hasFile(name, bytes));
      return present.get(key);
    };
    // planSync is synchronous; resolve the file checks up front.
    for (const project of manifest.projects ?? []) {
      for (const f of project.files ?? []) await hasFileCache(localNameFor(f), f.bytes ?? null);
    }
    const plan = planSync(store.current, manifest, (name, bytes) => present.get(`${name}:${bytes ?? ''}`));
    this.log.info?.(`[sync] plan: keep=${plan.keep.length} update=${plan.update.length} remove=${plan.remove.length} downloads=${plan.downloads.size} (${plan.totalBytes} bytes)`);

    // Free space: what's left to download (minus partial bytes already on disk) plus a reserve.
    let partialBytes = 0;
    for (const name of plan.downloads.keys()) {
      try {
        partialBytes += (await stat(store.partPath(name))).size;
      } catch {
        // no part
      }
    }
    const needBytes = Math.max(0, plan.totalBytes - partialBytes);
    const { free_bytes: freeBytes } = await this.storage();
    if (freeBytes != null && plan.downloads.size > 0 && needBytes + this.minFreeBytes > freeBytes) {
      throw new InsufficientSpaceError(needBytes + this.minFreeBytes, freeBytes);
    }

    // Downloads.
    const failed = new Map();
    const totalBytes = plan.totalBytes;
    const totalFiles = plan.downloads.size;
    let doneBytes = partialBytes;
    let doneFiles = 0;
    let lastEmit = 0;
    const progress = (force = false) => {
      const p = totalBytes > 0 ? Math.min(1, doneBytes / totalBytes) : totalFiles > 0 ? doneFiles / totalFiles : 1;
      const now = Date.now();
      if (force || now - lastEmit > 500) {
        lastEmit = now;
        this.#setState({ progress: Math.round(p * 1000) / 1000 });
      }
    };
    await runPool([...plan.downloads.values()], this.concurrency, async (file) => {
      for (let attempt = 1; ; attempt++) {
        if (signal?.aborted) throw signal.reason;
        let written = 0;
        try {
          await downloadFile({
            url: file.url ?? file.key,
            partPath: store.partPath(file.name),
            finalPath: store.filePath(file.name),
            bytes: file.bytes ?? null,
            sha256: normalizeSha(file.sha256),
            fetch: this.fetch,
            signal,
            onBytes: (n) => { written += n; doneBytes += n; progress(); },
          });
          doneFiles++;
          progress(true);
          return;
        } catch (err) {
          if (signal?.aborted) throw err;
          if (err.name === 'IntegrityError') doneBytes -= written; // those bytes were thrown away
          const retryable = err instanceof DownloadError ? err.retryable : true;
          this.log.warn?.(`[sync] ${file.name} attempt ${attempt}/${this.retries} failed: ${err.message}`);
          if (!retryable || attempt >= this.retries) {
            failed.set(file.name, err.message);
            return;
          }
          await sleep(this.backoffMs * 2 ** (attempt - 1), signal);
        }
      }
    });

    // Build local manifests for projects whose files are all present.
    const nextProjects = {};
    for (const slug of plan.keep) nextProjects[slug] = store.current.projects[slug];
    const updated = [];
    const failedProjects = [];
    for (const { project, files } of plan.update) {
      const bad = files.filter((f) => failed.has(f.name));
      if (bad.length > 0) {
        failedProjects.push({ slug: project.slug, error: failed.get(bad[0].name), failed_files: bad.length });
        if (store.current.projects[project.slug]) nextProjects[project.slug] = store.current.projects[project.slug];
        continue;
      }
      const keyToPath = new Map();
      for (const f of files) if (f.key != null) keyToPath.set(f.key, `${CONTENT_URL_PREFIX}${f.name}`);
      const payload = rewritePayload(project.payload ?? {}, keyToPath);
      const local = {
        slug: project.slug,
        project_id: project.project_id ?? null,
        version: project.version ?? null,
        etag: project.etag ?? null,
        generated_at: manifest.generated_at ?? null,
        synced_at: new Date().toISOString(),
        total_bytes: project.total_bytes ?? null,
        payload,
        files: files.map((f) => ({
          key: f.key, name: f.name, path: `${CONTENT_URL_PREFIX}${f.name}`, kind: f.kind ?? null,
          variant: f.variant ?? null, mime: f.mime ?? null, bytes: f.bytes ?? null, sha256: normalizeSha(f.sha256),
        })),
      };
      const rel = await store.writeProjectManifest(local);
      nextProjects[project.slug] = {
        slug: project.slug, project_id: local.project_id, version: local.version, etag: local.etag,
        name: payload?.name ?? project.slug, hero_image: payload?.hero_image ?? payload?.gallery?.[0] ?? null,
        total_bytes: local.total_bytes, synced_at: local.synced_at, manifest: rel,
      };
      updated.push(project.slug);
    }

    const changed = updated.length > 0 || plan.remove.length > 0;
    if (changed) {
      await store.switchTo(nextProjects);
      // Keep partial downloads for files that failed so the next attempt resumes them.
      const gc = await store.gc({ keepParts: new Set(failed.keys()) });
      this.log.info?.(`[sync] switched: updated=[${updated.join(', ')}] removed=[${plan.remove.join(', ')}]; gc removed ${gc.files} files (${gc.bytes} bytes)`);
      this.emit('switched', { updated, removed: plan.remove, projects: store.listProjects() });
    }
    this.lastSyncAt = new Date().toISOString();
    const ok = failedProjects.length === 0;
    return {
      ok,
      changed,
      updated,
      removed: plan.remove,
      kept: plan.keep,
      failed: failedProjects,
      error: ok ? null : `${failedProjects.length} project(s) failed: ${failedProjects.map((f) => `${f.slug}: ${f.error}`).join('; ')}`,
      content: store.contentMap(),
    };
  }
}
