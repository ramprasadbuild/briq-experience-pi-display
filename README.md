# briq-experience-pi-display

Node.js daemon that runs on a Raspberry Pi wired to a TV in a BriQ Experience
Center. It turns the TV into a remotely-controlled kiosk: idle, it shows a
pairing code/QR; once a sales agent claims the device from the controller
app, the daemon drives the on-screen browser to whatever page the agent
picks, and back to idle when they're done.

## Components

| File | Role |
|---|---|
| [src/daemon.js](src/daemon.js) | Entry point. Wires everything below together. |
| [src/config.js](src/config.js) | All env-overridable config (API host, web app origin, ports, paths). |
| [src/api.js](src/api.js) | HTTP contract with the backend: `register` and `heartbeat`. |
| [src/idleServer.js](src/idleServer.js) | Local HTTP+WS server serving the kiosk's default `/idle` page. |
| [public/idle.html](public/idle.html) | The idle page itself — renders pairing code + QR, live over WS. |
| [src/cobrowse.js](src/cobrowse.js) | WebSocket client for the backend's cobrowse relay (command channel). |
| [src/cdp.js](src/cdp.js) | Drives the already-running kiosk Chrome via Chrome DevTools Protocol. |
| [src/diag.js](src/diag.js) | Manual test tool — acts as a fake controller app. |
| [systemd/briq-display-daemon.service](systemd/briq-display-daemon.service) | Runs this daemon unattended on the Pi. |
| [systemd/briq-kiosk.service](systemd/briq-kiosk.service) | Runs the fullscreen Chromium kiosk browser, after the daemon. |

## Boot sequence on the Pi

1. `briq-display-daemon.service` starts (after networking). It runs
   `node src/daemon.js`, which:
   - starts the local idle server on `:8080`,
   - calls `register()` against the backend to get a `deviceId` +
     `pairingCode` (reusing a persisted device id from `device-id.txt` if
     one exists, so reboots don't create a new device),
   - pushes `{deviceId, pairingCode, qrDataUri}` to the idle server over WS,
   - opens a long-lived cobrowse WebSocket (`role=viewer`) on
     `device-${deviceId}`, and
   - starts a 45s heartbeat loop (`HEARTBEAT_INTERVAL_MS`).
2. `briq-kiosk.service` starts next (`After=`/`Requires=` the daemon). It
   launches `cage` (a minimal Wayland compositor running exactly one
   fullscreen app) with Chromium in kiosk mode, pointed at
   `http://localhost:8080/idle`, and with
   `--remote-debugging-port=9222` so the daemon can drive it later via CDP.
3. The TV now shows the idle page: a pairing code and QR code
   (`{deviceId, pairingCode}` JSON-encoded).

## Pairing + presenting flow

The actual pairing/claiming UI lives in a separate "controller app" (a web
and/or mobile app — see the comments in `config.js`/`api.js` referencing
`briq-crm-app`'s `config.ts` and `briq-experience-display`'s `src/api.ts`).
This repo is only the device side of that contract:

1. **Agent claims the device.** The agent opens the controller app, enters
   or scans the pairing code shown on the TV. The backend now knows this
   device is claimed and stops returning a pairing code for it.
2. **Code refresh / claim detection.** Every heartbeat tick, the daemon
   calls `heartbeat(deviceId)` (marks it online — bare `{}` response, no
   code) *and* re-calls `register(deviceId)`. `register` is idempotent for a
   known device id, so this is how the daemon notices either (a) the old
   code expired and a new one was issued, or (b) the device was claimed and
   the backend stopped sending a code at all. Either way, if the code
   changed, `pushIdleInfo()` re-broadcasts to the idle page.
3. **Commands over cobrowse.** Once claimed, the controller app sends
   `{t:'state', state:{cmd:'load', url}}` or `{t:'state', state:{cmd:'idle'}}`
   over the cobrowse relay to session `device-${deviceId}`. The daemon's
   `CobrowseSocket` (role `viewer`) receives these and calls:
   - `navigate(url)` for `load` — CDP tells the already-running Chrome tab
     to navigate, no browser restart/flicker.
   - `navigate(idleServer.url)` for `idle` — sends the browser back to the
     local `/idle` page.
4. The daemon never *sends* state itself (it's `role=viewer`, not
   `presenter`) — it's purely a command receiver.

## Protocols

**Register** — `POST {API_BASE_URL}/api/public/experience/devices/register`
body `{device_id}` (null on first boot) → `{device_id, pairing_code,
pairing_code_expires_at}`.

**Heartbeat** — `POST {API_BASE_URL}/api/public/experience/devices/{id}/heartbeat`
→ `{}` on success. Marks the device online in the controller's device list;
carries no pairing code.

**Cobrowse relay** — `wss://{API host}/ws/cobrowse?session=device-{id}&role=viewer`.
Same protocol as the web client's `useCobrowse.js` and both Expo apps' copy
of it. Messages are `{t:'state', state:{...}}`; this daemon only consumes
`cmd: 'load'|'idle'`.

**Idle server WS** — `ws://localhost:8080/idle-ws`, local-only. The daemon
broadcasts `{deviceId, pairingCode, qrDataUri}` on every change; the server
also replays the last payload to any newly-connected client (so a kiosk
browser that loads the page *after* the first broadcast — the common case,
since registration happens before the browser even starts — doesn't get
stuck on the `······` placeholder).

## Resilience details worth knowing

- **Device identity survives reboots** via `device-id.txt` (gitignored,
  path configurable through `DEVICE_ID_FILE`). Delete it to force the
  device to re-register as new.
- **`register()` failure at boot doesn't crash the daemon** — it falls back
  to the existing id or a temporary `unregistered-<timestamp>` id and keeps
  retrying every heartbeat tick.
- **Cobrowse reconnects with exponential backoff** (1s → doubling, capped
  at 30s), reset to 1s on a successful reconnect.
- **CDP connection is lazily re-established** — `cdp.js` keeps one client
  across calls, pings it with a trivial `Runtime.evaluate` before reuse,
  and transparently reconnects if the browser process was restarted (e.g.
  after a crash `Restart=always` recovered from).
- **systemd restarts both units on crash** (`Restart=always`,
  `RestartSec=3`), and the daemon unit is explicitly ordered `Before=` the
  kiosk unit so the kiosk never loads `:8080/idle` before something is
  listening there.

## Running/testing locally, without the controller app

Everything except the actual claim+command flow can be exercised standalone,
since `navigate()`/CDP is only ever invoked in reaction to a command:

```sh
npm install
node src/daemon.js            # or: npm start
```

Open `http://localhost:8080/idle` in any browser — you should see a live
pairing code and QR (as long as `API_BASE_URL` is reachable; no real
controller app or Chrome/CDP needed for this part).

To simulate the controller app and exercise the command path too, use the
built-in fake controller:

```sh
node src/diag.js <deviceId> load https://example.com
node src/diag.js <deviceId> idle
```

This opens a `role=presenter` cobrowse socket on the same `device-<id>`
session and sends the command the daemon is listening for. To see
`navigate()` actually take effect you do need a real Chrome reachable at
`CDP_PORT` (9222 by default) — e.g. `chromium --remote-debugging-port=9222`.

## Config reference ([src/config.js](src/config.js))

| Var | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | preprod backend | Backend for register/heartbeat/cobrowse (ws origin is derived from this). |
| `WEB_APP_ORIGIN` | staging web app | Where the CRM web client is hosted — not necessarily the same host as the API. |
| `IDLE_SERVER_PORT` | `8080` | Local idle page HTTP+WS port. |
| `CDP_PORT` | `9222` | Must match the kiosk browser's `--remote-debugging-port`. |
| `DEVICE_ID_FILE` | `../device-id.txt` | Where the device id persists across reboots. |
| `HEARTBEAT_INTERVAL_MS` | `45000` | Not env-overridable; hardcoded. |
