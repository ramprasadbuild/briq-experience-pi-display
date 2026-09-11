// Entry point. Ties together: device registration, the idle-screen server, the long-lived
// cobrowse "device room" listener, and CDP-driven navigation. See README.md for the full picture
// and systemd/ for how this runs unattended on the Pi.
import { readFile, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { heartbeat, register } from './api.js';
import { navigate } from './cdp.js';
import { CobrowseSocket } from './cobrowse.js';
import { DEVICE_ID_FILE, HEARTBEAT_INTERVAL_MS, WEB_APP_ORIGIN } from './config.js';
import { startIdleServer } from './idleServer.js';

async function loadDeviceId() {
  try {
    return (await readFile(DEVICE_ID_FILE, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

async function saveDeviceId(id) {
  await writeFile(DEVICE_ID_FILE, id, 'utf8');
}

function isDeviceCommand(value) {
  return !!value && typeof value === 'object' && 'cmd' in value;
}

async function main() {
  const idleServer = startIdleServer();

  const existingId = await loadDeviceId();
  let deviceId;
  let pairingCode;
  try {
    const result = await register(existingId);
    deviceId = result.deviceId;
    pairingCode = result.pairingCode;
    if (deviceId !== existingId) await saveDeviceId(deviceId);
  } catch (err) {
    console.error('[daemon] register failed, will keep retrying via heartbeat loop:', err.message);
    deviceId = existingId ?? `unregistered-${Date.now()}`;
  }

  async function pushIdleInfo(code) {
    const qrDataUri = code
      ? await QRCode.toDataURL(JSON.stringify({ deviceId, pairingCode: code }))
      : null;
    idleServer.broadcast({ deviceId, pairingCode: code, qrDataUri });
  }
  await pushIdleInfo(pairingCode);

  const deviceSocket = new CobrowseSocket(`device-${deviceId}`, 'viewer');
  deviceSocket.onMessage((message) => {
    if (message.t !== 'state') return;
    const state = message.state;
    if (!isDeviceCommand(state)) return;
    if (state.cmd === 'load' && state.url) {
      navigate(state.url).catch((err) => console.error('[daemon] navigate(load) failed:', err.message));
    } else if (state.cmd === 'idle') {
      navigate(idleServer.url).catch((err) => console.error('[daemon] navigate(idle) failed:', err.message));
    }
  });
  deviceSocket.connect();

  // Stay online, and keep the idle screen's pairing code current. The code has to come from
  // register(), not heartbeat() -- see the note in api.js. register() is idempotent for a device
  // id we already hold, so re-calling it is how a code that expired gets replaced, and how this
  // screen learns an agent has claimed the device (the backend then stops issuing a code).
  setInterval(async () => {
    try {
      await heartbeat(deviceId);
      const result = await register(deviceId);
      if (result.pairingCode !== pairingCode) {
        pairingCode = result.pairingCode;
        await pushIdleInfo(pairingCode);
      }
    } catch (err) {
      console.error('[daemon] heartbeat/refresh failed:', err.message);
    }
  }, HEARTBEAT_INTERVAL_MS);

  console.log(`[daemon] running. device=${deviceId} idle=${idleServer.url} webAppOrigin=${WEB_APP_ORIGIN}`);
}

main().catch((err) => {
  console.error('[daemon] fatal:', err);
  process.exit(1);
});
