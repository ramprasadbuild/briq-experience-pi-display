// Content-addressed store for synced project content (SHOWROOM-CONTRACT §5).
//
// <data>/content/
//   files/<sha256>                 a downloaded file, named by its sha256 …
//   files/url-<sha256(url)>        … or by the hash of its URL when the manifest has no sha256
//   staging/<name>.part            partial downloads (resumed with HTTP Range)
//   projects/<slug>/<v>-<etag>.json  one local manifest per synced version, URLs rewritten
//   current.json                   which local manifest is live for each slug (atomic rename)
//
// A sync writes new files and a new project manifest next to the old ones, then swaps
// current.json in one rename. Only after that are unreferenced files removed, so a failed or
// interrupted sync never touches what the TV is currently showing.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SHA_RE = /^[a-f0-9]{64}$/;

export function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Normalises "sha256:abc…", "ABC…" → "abc…"; anything that isn't a sha256 → null. */
export function normalizeSha(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase().replace(/^sha256:/, '');
  return SHA_RE.test(hex) ? hex : null;
}

/** The store name for a manifest file entry. */
export function localNameFor(file) {
  const sha = normalizeSha(file.sha256);
  if (sha) return sha;
  return `url-${sha256Hex(String(file.url ?? file.key))}`;
}

export const CONTENT_URL_PREFIX = '/content/files/';

export function isValidStoreName(name) {
  return SHA_RE.test(name) || /^url-[a-f0-9]{64}$/.test(name);
}

export function safeSlug(slug) {
  return String(slug).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || '_';
}

async function writeFileAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const fh = await open(tmp, 'w', 0o644);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export class ContentStore {
  constructor(dataDir) {
    this.root = join(dataDir, 'content');
    this.filesDir = join(this.root, 'files');
    this.stagingDir = join(this.root, 'staging');
    this.projectsDir = join(this.root, 'projects');
    this.currentPath = join(this.root, 'current.json');
    this.current = { projects: {} };
    this.mimeByName = new Map();
  }

  async init() {
    await mkdir(this.filesDir, { recursive: true });
    await mkdir(this.stagingDir, { recursive: true });
    await mkdir(this.projectsDir, { recursive: true });
    this.current = await this.readCurrent();
    await this.#rebuildMimeIndex();
    return this;
  }

  filePath(name) {
    return join(this.filesDir, name);
  }

  partPath(name) {
    return join(this.stagingDir, `${name}.part`);
  }

  async readCurrent() {
    try {
      const json = JSON.parse(await readFile(this.currentPath, 'utf8'));
      return json && typeof json.projects === 'object' ? json : { projects: {} };
    } catch {
      return { projects: {} };
    }
  }

  /** `{slug: {version, etag}}` for the heartbeat. */
  contentMap() {
    const out = {};
    for (const [slug, p] of Object.entries(this.current.projects)) out[slug] = { version: p.version, etag: p.etag };
    return out;
  }

  listProjects() {
    return Object.values(this.current.projects).map((p) => ({
      slug: p.slug,
      name: p.name ?? p.slug,
      project_id: p.project_id ?? null,
      version: p.version,
      etag: p.etag,
      synced_at: p.synced_at,
      hero_image: p.hero_image ?? null,
      total_bytes: p.total_bytes ?? null,
    }));
  }

  async hasFile(name, bytes) {
    try {
      const s = await stat(this.filePath(name));
      return s.isFile() && (bytes == null || s.size === Number(bytes));
    } catch {
      return false;
    }
  }

  async readProjectManifest(slug) {
    const entry = this.current.projects[slug];
    if (!entry) return null;
    try {
      return JSON.parse(await readFile(join(this.root, entry.manifest), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Writes a project's local manifest (not yet live). Returns its path relative to the store root. */
  async writeProjectManifest(manifest) {
    const dir = join(this.projectsDir, safeSlug(manifest.slug));
    await mkdir(dir, { recursive: true });
    const etagPart = sha256Hex(String(manifest.etag ?? '')).slice(0, 16);
    const name = `${Number(manifest.version) || 0}-${etagPart}.json`;
    await writeFileAtomic(join(dir, name), `${JSON.stringify(manifest)}\n`);
    return `projects/${safeSlug(manifest.slug)}/${name}`;
  }

  /** The atomic switch: new current.json in one rename. */
  async switchTo(projects) {
    const next = { updated_at: new Date().toISOString(), projects };
    await writeFileAtomic(this.currentPath, `${JSON.stringify(next, null, 2)}\n`);
    this.current = next;
    await this.#rebuildMimeIndex();
    return next;
  }

  mimeFor(name) {
    return this.mimeByName.get(name) ?? null;
  }

  async #rebuildMimeIndex() {
    const map = new Map();
    for (const slug of Object.keys(this.current.projects)) {
      const m = await this.readProjectManifest(slug);
      for (const f of m?.files ?? []) if (f.mime) map.set(f.name, f.mime);
    }
    this.mimeByName = map;
  }

  /** Names referenced by the live projects' manifests. */
  async referencedNames() {
    const names = new Set();
    const manifests = new Set();
    for (const [slug, entry] of Object.entries(this.current.projects)) {
      manifests.add(entry.manifest);
      const m = await this.readProjectManifest(slug);
      if (!m) continue;
      for (const f of m.files ?? []) names.add(f.name);
    }
    return { names, manifests };
  }

  /**
   * Deletes files and project manifests nothing live refers to. Partial downloads are kept only
   * when listed in `keepParts` (a later sync can resume them).
   */
  async gc({ keepParts = new Set() } = {}) {
    const { names, manifests } = await this.referencedNames();
    const removed = { files: 0, manifests: 0, parts: 0, bytes: 0 };
    for (const entry of await readdir(this.filesDir).catch(() => [])) {
      if (names.has(entry)) continue;
      const p = join(this.filesDir, entry);
      removed.bytes += (await stat(p).catch(() => ({ size: 0 }))).size;
      await rm(p, { force: true });
      removed.files++;
    }
    for (const slugDir of await readdir(this.projectsDir).catch(() => [])) {
      const dir = join(this.projectsDir, slugDir);
      const entries = await readdir(dir).catch(() => []);
      let left = 0;
      for (const entry of entries) {
        if (manifests.has(`projects/${slugDir}/${entry}`)) { left++; continue; }
        await rm(join(dir, entry), { force: true });
        removed.manifests++;
      }
      if (left === 0) await rm(dir, { recursive: true, force: true });
    }
    for (const entry of await readdir(this.stagingDir).catch(() => [])) {
      if (keepParts.has(entry.replace(/\.part$/, ''))) continue;
      await rm(join(this.stagingDir, entry), { force: true });
      removed.parts++;
    }
    return removed;
  }

  /** `unpair`: drop every project and file. */
  async wipe() {
    await rm(this.root, { recursive: true, force: true });
    this.current = { projects: {} };
    this.mimeByName = new Map();
    await this.init();
  }

  /**
   * Factory prefill from another box's content dir (or a data dir containing content/). Copies the
   * live manifests and their files, optionally re-verifying sha256-named files, then switches.
   */
  async importFrom(sourceDir, { verify = false, log = () => {} } = {}) {
    let srcRoot = sourceDir;
    try {
      await stat(join(srcRoot, 'current.json'));
    } catch {
      srcRoot = join(sourceDir, 'content');
    }
    const src = JSON.parse(await readFile(join(srcRoot, 'current.json'), 'utf8'));
    const projects = {};
    for (const [slug, entry] of Object.entries(src.projects ?? {})) {
      const manifest = JSON.parse(await readFile(join(srcRoot, entry.manifest), 'utf8'));
      for (const f of manifest.files ?? []) {
        if (!isValidStoreName(f.name)) throw new Error(`bad file name in ${slug}: ${f.name}`);
        if (await this.hasFile(f.name, f.bytes)) continue;
        const from = join(srcRoot, 'files', f.name);
        if (verify && normalizeSha(f.name)) {
          const actual = await sha256File(from);
          if (actual !== f.name) throw new Error(`sha256 mismatch for ${f.name} in ${slug}`);
        }
        const tmp = this.partPath(f.name);
        await copyFile(from, tmp);
        await rename(tmp, this.filePath(f.name));
        log(`copied ${f.name}${f.bytes ? ` (${f.bytes} bytes)` : ''}`);
      }
      const rel = await this.writeProjectManifest(manifest);
      projects[slug] = { ...entry, manifest: rel };
    }
    await this.switchTo({ ...this.current.projects, ...projects });
    await this.gc();
    return Object.keys(projects);
  }
}
