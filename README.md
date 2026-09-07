# BriQ Experience Pi Display

The Raspberry Pi replacement for `briq-experience-display` (the Android TV app) —
see `~/.claude/plans/flickering-beaming-moore.md` for the full plan this was
built from. A Pi plugged into any TV's HDMI port, running a real, modern
Chromium in kiosk mode instead of relying on the TV's own (often years-out-of-date)
browser. `briq-experience-controller` (the phone app) needs zero changes — it
has no idea whether it's driving this or the old Android TV app.

## Why this shape

Same idea as the Android app, minus the mobile packaging: the Pi runs the
**existing, unmodified** web Experience Center in a real browser, and a small
Node daemon here is the only new code — it registers the device, shows a
pairing screen when idle, and drives navigation via the **Chrome DevTools
Protocol** instead of restarting the browser on every command (no flicker, no
re-negotiating the GPU/video pipeline).

## Architecture

```
src/
  daemon.js       Entry point. Wires everything below together.
  api.js          register() / heartbeat() — same contract as the (not-yet-built)
                  ExperienceDeviceController from the plan.
  cobrowse.js      Client for the existing /ws/cobrowse relay — same protocol as
                  useCobrowse.js and both Expo apps' copies. Only ever role=viewer
                  here, on the long-lived "device room".
  cdp.js          Chrome DevTools Protocol navigation — the core new mechanism.
  idleServer.js   Local HTTP+WS server serving public/idle.html (pairing code + QR).
public/idle.html  The idle screen itself — plain HTML/JS, no build step.
systemd/          Unit files for the two services that make this survive a reboot.
```

## Verified this session (see chat log for the full trace)

Ran the real daemon against a real, locally-launched Chrome
(`--remote-debugging-port=9222`, same flag the kiosk uses) and a fake
"controller" script (`src/diag.js`) sending commands over the **real
production** `/ws/cobrowse` relay:

- `node src/diag.js <deviceId> load <url>` → daemon received it, called
  `Page.navigate`, and Chrome's actual tab URL (confirmed via
  `http://localhost:9222/json`) landed on the real experience page — which
  even registered its own service worker, proving the real React app loaded
  and ran, not just that the URL bar changed.
- `node src/diag.js <deviceId> idle` → navigated back to the local idle page.

Both directions of the core mechanism are proven. What's **not** yet
tested: real hardware (a physical Pi, `cage`, actual HDMI output), and the
backend register/heartbeat/claim endpoints (still not built — see "Not yet
built" below; registration currently fails with a clean, logged 404 and the
daemon falls back to whatever device id was last persisted).

## Not yet built

- **Backend**: `POST /api/public/experience/devices/register` and
  `/{id}/heartbeat` (Java, `ExperienceDeviceController` in the plan) — until
  then, delete/don't create `device-id.txt` and the daemon logs the 404 and
  keeps running with a synthetic id, which is enough to test everything except
  real pairing.
- **Real Pi hardware**: OS flashing, `cage` + Chromium install, the two
  systemd units. Steps below are written but unexecuted against real hardware.
- **4K video checkpoint**: untested — needs a real H.265-encoded walkthrough
  asset and the actual Pi 4's hardware decoder.

## Pi setup (once you have the hardware)

1. Flash **Raspberry Pi OS Lite (64-bit)** (Raspberry Pi Imager), enable SSH +
   Wi-Fi/Ethernet during imaging.
2. `sudo apt update && sudo apt install -y cage chromium-browser nodejs npm`
3. `git clone`/copy this directory to `/home/pi/briq-experience-pi-display`,
   then `npm install` there.
4. Enable auto-login on the console (`sudo raspi-config` → System Options →
   Boot / Auto Login → Console Autologin).
5. Copy both files from `systemd/` to `/etc/systemd/system/`, then:
   ```bash
   sudo systemctl enable --now briq-display-daemon.service
   sudo systemctl enable --now briq-kiosk.service
   ```
6. `sudo systemctl status briq-kiosk.service briq-display-daemon.service` to
   confirm both are running; `journalctl -u briq-display-daemon -f` to watch
   the pairing/navigation logs live.

## Local dev (no Pi needed)

Point any local Chrome/Chromium at a debugging port and run the daemon against
it — exactly how this was verified this session:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" \
  --remote-debugging-port=9222 --autoplay-policy=no-user-gesture-required \
  --user-data-dir=/tmp/briq-chrome-test-profile about:blank

npm install
IDLE_SERVER_PORT=8099 node src/daemon.js   # 8080 may already be taken locally

# in another terminal, simulate a controller:
node src/diag.js <deviceId> load "https://briq-crm-app-staging.web.app/experience/<slug>?session=test1"
node src/diag.js <deviceId> idle
```
