// Config for the TV box daemon. Everything is overridable by env so the same code runs in local
// dev (./data, a local Chrome, a fake backend) and on the box (systemd, /var/lib/briq-display).
import { accessSync, constants, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const APP_VERSION = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')).version;

export const API_BASE_URL = (process.env.API_BASE_URL ?? 'https://briq-crm-app-preprod-hiw6sglj2q-ue.a.run.app').replace(/\/+$/, '');

export function wsOrigin(base = API_BASE_URL) {
  const url = new URL(base);
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
}

/**
 * Persistent state (device identity, relay key, content store). On the box this is
 * /var/lib/briq-display (created by install.sh, owned by the service user). In dev, when that
 * isn't writable, it falls back to ./data inside the repo.
 */
export function resolveDataDir(explicit = process.env.BRIQ_DATA_DIR) {
  if (explicit) return resolve(explicit);
  const system = '/var/lib/briq-display';
  try {
    accessSync(system, constants.W_OK);
    return system;
  } catch {
    return resolve(REPO_ROOT, 'data');
  }
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** One HTTP port for everything: TV app, content, local API and the LAN relay. */
export const PORT = Number(process.env.BRIQ_PORT ?? process.env.IDLE_SERVER_PORT ?? 8787);
export const HOST = process.env.BRIQ_HOST ?? '0.0.0.0';

/** Chrome DevTools Protocol port — must match --remote-debugging-port in scripts/kiosk.sh. */
export const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);

export const HEARTBEAT_INTERVAL_MS = Number(process.env.BRIQ_HEARTBEAT_MS ?? 30_000);

/** When the backend doesn't send `projects` in heartbeats (legacy), poll the manifest this often. */
export const MANIFEST_POLL_MS = Number(process.env.BRIQ_MANIFEST_POLL_MS ?? 15 * 60_000);

/** Bytes kept free on disk on top of what a sync needs. */
export const MIN_FREE_BYTES = Number(process.env.BRIQ_MIN_FREE_BYTES ?? 512 * 1024 * 1024);

export const KIOSK_UNIT = process.env.BRIQ_KIOSK_UNIT ?? 'briq-kiosk.service';

/** Optional: Mapbox token for the Location chapter's live map (used only when online). */
export const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN ?? '';

/** Dev only: accept presenters with this key before the backend has issued one. */
export const DEV_RELAY_KEY = process.env.BRIQ_RELAY_KEY ?? '';

/** Legacy location of the plain-text device id (pre-0.2). Migrated into the data dir on start. */
export const LEGACY_DEVICE_ID_FILE = process.env.DEVICE_ID_FILE ?? resolve(REPO_ROOT, 'device-id.txt');

export const TV_APP_DIR = resolve(REPO_ROOT, 'public', 'tv');
