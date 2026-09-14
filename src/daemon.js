// Entry point for the TV box. Wires: identity + backend control loop (device.js), the content
// store and sync agent, the single local HTTP port (TV app, content, local API, LAN relay), the
// cloud relay bridge, and a CDP watchdog. See README.md.
import QRCode from 'qrcode';
import { ApiClient } from './api.js';
import { Cdp } from './cdp.js';
import { CobrowseSocket } from './cobrowse.js';
import {
  API_BASE_URL, APP_VERSION, CDP_PORT, DEV_RELAY_KEY, ensureDir, HEARTBEAT_INTERVAL_MS, HOST, KIOSK_UNIT,
  LEGACY_DEVICE_ID_FILE, MANIFEST_POLL_MS, MAPBOX_TOKEN, MIN_FREE_BYTES, PORT, resolveDataDir, TV_APP_DIR, wsOrigin,
} from './config.js';
import { ContentStore } from './content/store.js';
import { SyncAgent } from './content/sync.js';
import { DeviceAgent } from './device.js';
import { IdentityStore } from './identity.js';
import { KioskControl } from './kiosk.js';
import { LocalRelay } from './relay.js';
import { LocalServer } from './server.js';
import { lanAddresses, storage } from './sysinfo.js';

const WATCHDOG_MS = Number(process.env.BRIQ_WATCHDOG_MS ?? 45_000);

async function main() {
  const dataDir = ensureDir(resolveDataDir());
  console.log(`[daemon] v${APP_VERSION} data=${dataDir} api=${API_BASE_URL}`);

  const identity = new IdentityStore(dataDir, { legacyIdFile: LEGACY_DEVICE_ID_FILE });
  await identity.load();
  const store = await new ContentStore(dataDir).init();
  const api = new ApiClient({ baseUrl: API_BASE_URL, identity });
  const sync = new SyncAgent({
    store, api, concurrency: 2, retries: 4, backoffMs: 2000, minFreeBytes: MIN_FREE_BYTES,
    storage: () => storage(dataDir),
  });

  const relay = new LocalRelay({ getRelayKey: () => identity.get().relay_key ?? (DEV_RELAY_KEY || null) });
  const cdp = new Cdp({ port: CDP_PORT });
  const kiosk = new KioskControl({ cdp, unit: KIOSK_UNIT });

  const device = new DeviceAgent({
    identity, api, store, sync, kiosk, dataDir, appVersion: APP_VERSION, port: PORT,
    lanAddresses: () => lanAddresses(), storage: () => storage(dataDir),
    heartbeatMs: HEARTBEAT_INTERVAL_MS, manifestPollMs: MANIFEST_POLL_MS,
  });

  // QR for the idle screen, regenerated only when the code changes. Same {deviceId, pairingCode}
  // JSON the controller's scanner already parses (app/devices/scan.tsx).
  let qr = { key: null, dataUri: null };
  const qrFor = async (deviceId, code) => {
    const key = `${deviceId}:${code}`;
    if (qr.key !== key) qr = { key, dataUri: code ? await QRCode.toDataURL(JSON.stringify({ deviceId, pairingCode: code }), { margin: 1, width: 480 }) : null };
    return qr.dataUri;
  };

  let statusCache = { ...device.status(), qr_data_uri: null, mapbox_token: MAPBOX_TOKEN || null };
  const server = new LocalServer({ store, relay, tvDir: TV_APP_DIR, getStatus: () => statusCache });

  let statusTimer = null;
  const pushStatus = () => {
    if (statusTimer) return;
    statusTimer = setTimeout(async () => {
      statusTimer = null;
      const s = device.status();
      statusCache = { ...s, qr_data_uri: await qrFor(s.device_id, s.pairing_code).catch(() => null), mapbox_token: MAPBOX_TOKEN || null, relay: relay.stats() };
      server.broadcast({ t: 'status', status: statusCache });
    }, 250);
  };
  device.on('status', pushStatus);
  sync.on('state', pushStatus);
  sync.on('switched', (info) => server.broadcast({ t: 'content', ...info }));
  device.on('identify', (info) => server.broadcast({ t: 'identify', ...info }));
  device.on('relay_key', () => relay.kickPresenters());
  device.on('unpaired', () => {
    relay.inject({ cmd: 'idle' }, 'box');
    server.broadcast({ t: 'content', updated: [], removed: [], projects: [] });
  });

  const port = await server.listen(PORT, HOST);
  console.log(`[daemon] local server on http://${HOST}:${port} (TV app http://127.0.0.1:${port}/tv/, relay ws://<lan>:${port}/relay)`);

  // Cloud fallback (§6.1): stay a viewer in the device room and forward everything to local viewers.
  let cloud = null;
  const connectCloud = () => {
    const id = identity.get().device_id;
    if (id == null || cloud?.sessionId === `device-${id}`) return;
    cloud?.close();
    cloud = new CobrowseSocket(`device-${id}`, 'viewer', { origin: wsOrigin(API_BASE_URL) });
    cloud.onMessage((message) => {
      if (message?.t === 'state') relay.inject(message.state, 'cloud');
    });
    cloud.connect();
  };
  device.on('status', connectCloud);

  await device.start();
  connectCloud();
  pushStatus();

  // Watchdog: the TV app keeps /local/events open. If nothing has been connected for two checks
  // in a row, point the kiosk tab back at the app (or reload it) over CDP.
  const localUrl = `http://127.0.0.1:${port}/tv/`;
  let quietChecks = 0;
  setInterval(async () => {
    quietChecks = server.eventClients.size === 0 ? quietChecks + 1 : 0;
    if (quietChecks < 2) return;
    try {
      const r = await kiosk.recover(localUrl);
      console.log(`[watchdog] TV app not connected; ${r.action}`);
    } catch {
      // No CDP (dev without a kiosk browser): nothing to recover.
    }
    quietChecks = 0;
  }, WATCHDOG_MS).unref();

  const shutdown = async (signal) => {
    console.log(`[daemon] ${signal}: shutting down`);
    device.stop();
    sync.abort();
    cloud?.close();
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[daemon] fatal:', err);
  process.exit(1);
});
