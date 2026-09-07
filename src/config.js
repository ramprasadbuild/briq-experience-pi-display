// Config for the Pi kiosk daemon. All overridable via env vars so the same code runs
// unmodified in local dev (against a local Chrome for testing) and on the real Pi.
import { fileURLToPath } from 'node:url';

export const API_BASE_URL = process.env.API_BASE_URL ?? 'https://briq-crm-app-preprod-hiw6sglj2q-ue.a.run.app';

// Where the CRM web client (the actual /experience/:slug page) is hosted — see the controller
// app's config.ts for the same caveat: this is NOT necessarily the same host as the API.
export const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN ?? 'https://briq-crm-app-staging.web.app';

export function wsOrigin() {
  const url = new URL(API_BASE_URL);
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
}

// Local idle-screen server (HTTP + WS) — the kiosk browser's default page.
export const IDLE_SERVER_PORT = Number(process.env.IDLE_SERVER_PORT ?? 8080);

// Chrome DevTools Protocol port — must match the browser's --remote-debugging-port flag
// (see systemd/briq-kiosk.service).
export const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);

export const HEARTBEAT_INTERVAL_MS = 45_000;

// Where this device's id is persisted across reboots — a fresh Pi without this file registers
// as a brand-new device on first boot.
export const DEVICE_ID_FILE = process.env.DEVICE_ID_FILE ?? fileURLToPath(new URL('../device-id.txt', import.meta.url));
