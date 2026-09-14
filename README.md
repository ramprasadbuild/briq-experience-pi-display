# BriQ Experience TV box

One small Linux box per showroom TV (Raspberry Pi 5 class or a mini PC). It ships prefilled
with project content, runs fully offline, and shows the **tablet's six-chapter kiosk design**
on the TV while a salesperson drives it from the tablet. The server triggers content updates
through the heartbeat and the box pulls them.

This repo owns the box side of
[`SHOWROOM-CONTRACT.md`](../briq-experience-controller/docs/SHOWROOM-CONTRACT.md): §1.3 device
identity, §2.2 heartbeat + commands, §5 tv manifest sync, §6 local relay, cloud bridge and
rendering the kiosk state.

## Architecture

```
                 LAN  ws://<box>:8787/relay?role=presenter&key=<relay_key>
  Tablet ────────────────────────────────────────────┐
     │                                               ▼
     │  cloud fallback             ┌──────────── briq-display-daemon (Node) ───────────┐
     └──► /ws/cobrowse ──────────► │ cloud bridge ─► LocalRelay ──► viewers (loopback)  │
          device-<id> room         │                  (last cmd + state replayed)       │
                                   │ DeviceAgent: register · heartbeat 30 s · commands  │
  Backend ◄── register/heartbeat ──│ SyncAgent: manifest ─► downloads ─► atomic switch  │
          ◄── manifest, files ─────│ LocalServer :8787 (0.0.0.0)                        │
                                   │   /tv/  /content/files/*  /local/*  /relay         │
                                   └────────────────────────────────────────────────────┘
                                                      ▲  ws://127.0.0.1:8787/relay?role=viewer
                                                      │  ws://127.0.0.1:8787/local/events
                                   briq-kiosk: cage ─► Chromium --kiosk http://127.0.0.1:8787/tv/
```

- **Chromium never leaves the local TV app.** Presenting, chapter changes and idle are all
  relay frames the app renders itself; CDP is only used to reload (`restart_browser`) and by a
  watchdog that points the tab back at the app if it stops connecting.
- **Content is served from disk.** The TV app loads `/local/projects/<slug>.json`, whose payload
  URLs were rewritten to `/content/files/<sha256>` at sync time.

```
src/
  daemon.js          entry: wires everything below
  config.js          env config (API_BASE_URL, BRIQ_DATA_DIR, BRIQ_PORT, …)
  identity.js        device.json: id + secret (0600), relay key, name, claimed, pairing code
  api.js             register / heartbeat / ack / manifest with `Authorization: Device id:secret`
  device.js          DeviceAgent: heartbeat loop, etag-triggered sync, commands + acks
  content/store.js   content-addressed store, local manifests, atomic switch, GC, import
  content/download.js  Range-resumable download with streaming sha256
  content/sync.js    SyncAgent: plan by etag, free space, concurrency 2, retries, rewrite, switch
  server.js          LocalServer: TV app, content with Range, local API, /local/events
  relay.js           LocalRelay (§6.1)
  cobrowse.js        cloud /ws/cobrowse client (viewer on device-<id>)
  cdp.js, kiosk.js   CDP reload/navigate, systemctl restart/reboot
  prefill.js         factory prefill CLI
  diag.js            send present/idle/state as a presenter (LAN or cloud)
tv/                  TV kiosk web app (Vite + React), built into public/tv/
scripts/kiosk.sh     Chromium flags (hardware decode, no throttling) launched by cage
scripts/fake-backend.js  contract (or --legacy preprod-like) backend for local runs
scripts/demo-drive.js    end-to-end driver: acts as the tablet, screenshots every chapter
systemd/             briq-display-daemon.service, briq-kiosk.service (templated by install.sh)
install.sh           provisioning
test/                node --test suites
```

### Data directory (`BRIQ_DATA_DIR`, default `/var/lib/briq-display`, `./data` in dev)

```
device.json                      {device_id, device_secret, relay_key, name, claimed, …} mode 0600
commands.json                    handled command ids + acks not yet delivered
content/current.json             live version per slug (replaced by one rename)
content/projects/<slug>/<v>-<etag>.json   local manifest: payload with local URLs + files[]
content/files/<sha256>           or url-<sha256(url)> when the manifest has no sha256
content/staging/<name>.part      partial downloads, resumed with Range
```

### Sync (§5)

1. Triggered by a heartbeat whose `projects[].etag` differs from what the box has, by a `sync`
   command, at startup/poll against a legacy backend, or by `npm run prefill`.
2. `GET /api/experience/manifest?device_class=tv` with Device auth.
3. Plan: a project with the same etag and all files present is kept; otherwise its missing
   files are queued (deduplicated across projects). Projects no longer in the manifest are dropped.
4. Free space: bytes still to download + `BRIQ_MIN_FREE_BYTES` (512 MB) must fit, or the sync
   fails before touching anything.
5. Download 2 at a time; resume `.part` files with `Range`; up to 4 attempts with exponential
   backoff; sha256 is computed while streaming (including resumed bytes) and a mismatch discards
   the part. Size is checked when known.
6. For each project whose files all arrived: write the local manifest, then one atomic rename of
   `current.json`, then GC files and manifests nothing live references. A project whose files
   failed keeps its previous version; others still switch. Errors are reported in the heartbeat
   `sync` object.

### Local server and relay (§6)

| Path | Who | What |
| --- | --- | --- |
| `/tv/` | kiosk | built TV app (SPA fallback) |
| `/content/files/<name>` | TV app | content; `Range` (206/416), `HEAD`, manifest or sniffed `Content-Type`, immutable cache |
| `/local/projects.json`, `/local/projects/<slug>.json` | TV app | what's on the box / one project's local manifest (404 `not_on_this_box`) |
| `/local/status.json`, WS `/local/events` | TV app, **loopback only** | device status, `identify`, `content` (switch happened) |
| WS `/relay?role=presenter&key=…` | tablet on the LAN | wrong/missing key → close **4401** |
| WS `/relay?role=viewer` | TV app, **loopback only** | non-loopback → close **4403** |

The relay keeps the last `present`/`idle` command and the last kiosk state (an `idle` or a
`present` for another slug clears the state) and replays both to a viewer that joins, so a
Chromium reload lands on the same screen. The daemon also stays a viewer in the cloud
`/ws/cobrowse?session=device-<id>` room and injects whatever arrives there into the same relay.

### TV app

Display-only reproduction of the controller's kiosk (`app/present/[slug]/*`) at 1920×1080 design
size, scaling to 3840×2160 (1 rem = 1/120 of the width), type ~1.6× the tablet's for 3–5 m
viewing, no cursor. Everything is bundled: Marcellus + Jost (@fontsource), `@google/model-viewer`,
`pdfjs-dist` (worker, CMaps and standard fonts), `@photo-sphere-viewer` virtual tour. Mapbox GL is a
lazy chunk used only when the box is online and `MAPBOX_TOKEN` is set; otherwise the Location
chapter draws an offline schematic from the coordinates.

| §6.3 field | Rendering |
| --- | --- |
| `home.index`, `paused` | highlighted chapter card + orb image; the ring keeps turning between updates unless paused |
| `renders.index/playing/zoom/pan_x/pan_y` | crossfading full-screen render, slideshow pill, zoom % and thumbnail strip |
| `inventory.level/tower_id/floor/unit_no/tip_unit_no/cfg` | aerial → tower → floor → unit with render-pack SVG shapes in status colours (tip/unit highlighted, tooltip at tower level) or the floor grid / plan fallbacks; `render_pack: null` on `briq-skyline*` uses the bundled demo pack like the tablet |
| `inventory.unit_mode`, `model_cam`, `compare` | standard / Sq Ft (measured image) / Sq M (metre pins) / 3D (model-viewer orbit, spin, room labels); compare table |
| `brochure.page/zoom` | PDF.js page + thumbnail rail |
| `vr.scene_idx/node_id/cam` | photo-sphere-viewer tour; camera eased toward samples |
| `walkthrough.playing/time/rate/muted/at` | `<video>` from local content; expected position = time + (now − at)·rate; seeks only when drift > 0.5 s |
| `location.poi/is_3d/measuring/map_cam` | Mapbox (online) or schematic (offline), landmark list with the selection |

**Host bridge (Android TV).** The same build also runs inside the Android TV app
([`briq-experience-display`](../briq-experience-display)), which has no Node daemon. When
`window.ReactNativeWebView` exists, `tv/src/host.js` replaces the loopback sockets and
`/local/projects/*` fetches: the native host calls `window.__briqHost.receive({t:'state'|'status'|'identify'|'content'|'reload'|'project', …})`
and the page posts `{t:'ready'}` / `{t:'project', slug}` back. On the Linux box nothing changes.

Legacy frames are tolerated: `{cmd:'load', url:'…/experience/<slug>'}` presents that slug if it is
on the box; `{tab, mediaIdx, towerId, …}` is mapped onto chapters.

## Install on a box

Raspberry Pi 5 (4 GB+) with Raspberry Pi OS Lite 64-bit (Bookworm or later), or a Debian-based
x86 mini PC, NVMe/SSD recommended (§9 budgets ~2.5 GB per project).

```bash
git clone … briq-experience-pi-display && cd briq-experience-pi-display
sudo ./install.sh --api https://<backend> [--mapbox-token pk.…] [--prefill-from /media/usb/golden]
```

`install.sh` (idempotent) installs cage, Chromium, seatd and Node 22; creates the `briq` service
user; copies the app to `/opt/briq-display`; runs `npm ci`, `npm run build`, `npm prune --omit=dev`;
creates `/var/lib/briq-display` (0750); writes `/etc/default/briq-display` and
`/etc/default/briq-kiosk`; installs `/etc/sudoers.d/briq-display` allowing exactly
`systemctl restart briq-kiosk.service` and `systemctl reboot`; installs both units; sets
`consoleblank=0`, disables screen blanking and Wi-Fi power save; enables and starts everything.

Then pair: the TV shows a 6-digit code and QR (`{deviceId, pairingCode}`, what the tablet scanner
reads). Claiming in the CRM/tablet assigns projects; the next heartbeat brings the relay key and
the project etags and the box downloads them.

Config (`/etc/default/briq-display`): `API_BASE_URL`, `BRIQ_PORT` (8787), `MAPBOX_TOKEN`,
`BRIQ_MIN_FREE_BYTES`, `BRIQ_HEARTBEAT_MS`, `BRIQ_MANIFEST_POLL_MS`. Kiosk
(`/etc/default/briq-kiosk`): `KIOSK_URL`, `CHROMIUM_HWDEC_FLAGS`, `CHROMIUM_EXTRA_FLAGS`.

## Prefill (factory imaging)

```bash
# Sync the device's tv manifest exactly like the daemon (and keep its id + secret):
sudo -u briq npm run prefill -- --api https://<backend> --device-id 17 --secret brqd_… --data-dir /var/lib/briq-display

# Or copy a golden box's content (its data dir or its content/ folder), re-hashing files:
sudo -u briq npm run prefill -- --from /media/usb/golden/briq-display --verify --data-dir /var/lib/briq-display
```

Both switch atomically and GC like a normal sync; exit code is non-zero on failure. `--from`
copies content only (no identity), so one golden image can seed many boxes that then register
individually.

## 4K HEVC hardware test (do this on every new box model)

The TV rendition is HEVC `hvc1` 2160p (§3.3). Chromium must decode it in hardware; software HEVC
at 4K will drop frames on any Pi-class CPU.

1. Put a representative film on the box: a real TV rendition, or encode one
   (`ffmpeg -i in.mov -c:v libx265 -tag:v hvc1 -preset veryfast -crf 24 -vf scale=3840:2160 -c:a aac -b:a 192k -movflags +faststart film.mp4`).
2. Check the decoder is present:
   - Pi 5: `ls /dev/video*` and `v4l2-ctl --list-devices` show `rpi-hevc-dec`; `dmesg | grep -i hevc`.
   - x86: `vainfo` lists `VAProfileHEVCMain … VAEntrypointVLD`.
3. Ask Chromium (from the box): with the kiosk running,
   `curl -s localhost:9222/json` → open the page's `webSocketDebuggerUrl` with any CDP client, or
   temporarily set `KIOSK_URL=chrome://gpu` in `/etc/default/briq-kiosk` and restart the kiosk.
   `chrome://gpu` → *Video Acceleration Information* must list HEVC/H.265 decode.
   In the app, `navigator.mediaCapabilities.decodingInfo({type:'file', video:{contentType:'video/mp4; codecs="hvc1.1.6.L153.B0"', width:3840, height:2160, bitrate:20e6, framerate:30}})`
   must report `supported: true, powerEfficient: true`.
4. Play it through the real path: present the project from the tablet (or
   `node src/diag.js --key <relay_key> present <slug>` then a `walkthrough` state) and watch for 5
   minutes. `chrome://media-internals` (via `KIOSK_URL` or remote debugging) → the player's
   `kVideoDecoderName` should be `V4L2VideoDecoder` (Pi) or `VaapiVideoDecoder` (x86) with
   `kIsPlatformVideoDecoder: true`; dropped frames should stay near 0.
5. Check thermals and seeking: `vcgencmd measure_temp` / `vcgencmd get_throttled` (Pi, want
   `0x0`), and send `walkthrough` states that jump `time` around — each seek should land within a
   second (Range requests against `/content/files/*`).
6. If step 3 fails on a Pi, try overriding `CHROMIUM_HWDEC_FLAGS` (e.g. drop `--use-gl=egl`,
   or add `--enable-features=V4L2VideoDecoder`) and check the Chromium package is Raspberry Pi's
   build (`apt policy chromium`). Record the working flags for that OS image.

## Degraded mode (today's preprod backend)

Until the contract backend is deployed the box still runs:

- `register` returns no `device_secret` → the box stores the id only and sends no
  `Authorization` header.
- `heartbeat` answers `{}` → treated as a legacy backend: the pairing code is refreshed by calling
  `register` again each round, and the box polls the manifest itself every 15 min.
- `GET /api/experience/manifest` answers **401 `Authentication required`** to a box without a
  secret (404/405/501 are handled the same way) → sync state `error: manifest_unavailable…`, and the
  TV shows the pairing screen with **"No content on this TV yet — the content service isn't
  available yet"**. Content already on the box (e.g. from prefill) keeps being served.
- The cloud `/ws/cobrowse` bridge works as before, so a tablet can present content that is on the box.

## Development

```bash
npm install
npm test                    # node --test test/*.test.js
npm run build               # TV app → public/tv/

# Terminal 1: fake contract backend (add --legacy for preprod-like behaviour, --video film.mp4 for a film)
node scripts/fake-backend.js --port 9900
# Terminal 2: the daemon in dev mode
BRIQ_DATA_DIR=./data API_BASE_URL=http://127.0.0.1:9900 BRIQ_HEARTBEAT_MS=3000 npm start
# Terminal 3: a browser on the TV app with CDP, then drive it like a tablet
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/briq-tv --window-size=1920,1080 --autoplay-policy=no-user-gesture-required http://127.0.0.1:8787/tv/
node scripts/demo-drive.js --out ./shots
```

`npm run dev:tv` serves the TV app with hot reload, proxying `/local`, `/content` and `/relay` to
a running daemon. `node src/diag.js --key rk_dev present briq-skyline-9` sends single frames.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| Black screen | `systemctl status briq-kiosk` · `journalctl -u briq-kiosk -b` (cage/seat errors: user in `video`,`render`,`input`; `seatd` running) |
| "BriQ TV app not built" | `cd /opt/briq-display && sudo npm ci && sudo npm run build` (or re-run install.sh) |
| Pairing code never appears | `journalctl -u briq-display-daemon -f` for `register failed`; `API_BASE_URL` in `/etc/default/briq-display`; the idle screen's ONLINE/OFFLINE dot |
| Tablet can't connect on the LAN | `curl http://<box>:8787/healthz` from the LAN; firewall on 8787; close code 4401 = wrong relay key (box not claimed yet, or key rotated — it's in `device.json`) |
| "No content on this TV yet" | idle footer reason; `curl -s localhost:8787/local/status.json` (`sync`, `content_unavailable`); `ls /var/lib/briq-display/content/files` |
| Sync stuck/failing | status `sync.error`; `df -h /var/lib/briq-display` (needs download size + 512 MB); partial files in `content/staging` resume on the next attempt |
| Film stutters | the HEVC hardware test above; `vcgencmd get_throttled`; the film must be the `tv` rendition |
| Wrong screen after a browser crash | the relay replays the last state on reconnect; `restart_browser` command or `sudo systemctl restart briq-kiosk` |
| Reset a box | `sudo systemctl stop briq-display-daemon && sudo rm -rf /var/lib/briq-display/* && sudo systemctl start briq-display-daemon` (or the `unpair` command) |

## Not tested without hardware

Verified on a Mac (Node 26, headless Chrome) against the fake backend: registration, heartbeat,
commands and acks, sync/switch/GC, Range serving, relay auth and replay, every TV chapter
rendering from local content, walkthrough sync on a 3840×2160 HEVC `hvc1` film (macOS hardware
decode). **Not** verified:

- Raspberry Pi 5 / mini PC hardware, cage, the systemd units, `install.sh`, sudoers, console blanking.
- Chromium hardware HEVC decode on Pi 5 (V4L2) or VA-API, and the exact flags in `scripts/kiosk.sh`.
- 4K output performance of model-viewer / photo-sphere-viewer / PDF.js on Pi-class GPUs.
- Mapbox live map (no token used in testing; the offline schematic was exercised).
- The real contract backend (not deployed) and real tablets on a LAN.
