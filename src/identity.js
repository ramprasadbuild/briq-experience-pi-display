// The box's persistent identity: device id + secret (§1.3), plus what the backend told us last
// that the box must remember to keep working offline (name, relay key, claimed, the client's org
// branding). Stored as one JSON file with mode 0600 and written atomically (tmp + rename) so a
// power cut can't truncate it.
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EMPTY = {
  device_id: null,
  device_secret: null,
  relay_key: null,
  name: null,
  org: null, // { name, logo_url } of the org this box is claimed into
  claimed: false,
  pairing_code: null,
  pairing_code_expires_at: null,
};

/** Heartbeat `org` → what identity keeps: `{ name, logo_url }` or null. Tolerates a sloppy backend. */
export function orgBranding(org) {
  if (!org || typeof org !== 'object') return null;
  const name = typeof org.name === 'string' && org.name.trim() ? org.name.trim() : null;
  const logo = typeof org.logo_url === 'string' && org.logo_url.trim() ? org.logo_url.trim() : null;
  return { name, logo_url: logo };
}

export class IdentityStore {
  constructor(dataDir, { legacyIdFile = null } = {}) {
    this.file = join(dataDir, 'device.json');
    this.legacyIdFile = legacyIdFile;
    this.value = { ...EMPTY };
  }

  async load() {
    try {
      this.value = { ...EMPTY, ...JSON.parse(await readFile(this.file, 'utf8')) };
      return this.value;
    } catch {
      // fall through to legacy migration
    }
    if (this.legacyIdFile) {
      try {
        const legacy = (await readFile(this.legacyIdFile, 'utf8')).trim();
        if (legacy) {
          const n = Number(legacy);
          this.value = { ...EMPTY, device_id: Number.isFinite(n) && String(n) === legacy ? n : legacy };
          await this.save();
          console.log(`[identity] migrated legacy device id ${legacy} from ${this.legacyIdFile}`);
        }
      } catch {
        // no legacy id either: a brand-new box
      }
    }
    return this.value;
  }

  get() {
    return this.value;
  }

  async update(patch) {
    const next = { ...this.value, ...patch };
    const changed = JSON.stringify(next) !== JSON.stringify(this.value);
    this.value = next;
    if (changed) await this.save();
    return changed;
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.value, null, 2)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
  }

  /** `unpair`: forget the secret and everything the claim gave us; keep nothing that authenticates. */
  async wipeSecret() {
    this.value = { ...EMPTY, device_id: this.value.device_id };
    await this.save();
  }

  async remove() {
    this.value = { ...EMPTY };
    await rm(this.file, { force: true });
  }

  /** `Authorization: Device <id>:<secret>`, or null while the backend hasn't issued a secret. */
  authHeader() {
    const { device_id: id, device_secret: secret } = this.value;
    return id != null && secret ? `Device ${id}:${secret}` : null;
  }
}
