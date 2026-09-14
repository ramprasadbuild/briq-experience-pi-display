# Showroom Contract (v1)

The single source of truth that the backend (BriQBase), CRM (BriQUI), tablet controller
(briq-experience-controller) and TV box (briq-experience-pi-display) build against. If a piece
of work needs something not written here, add it here first and say so in the commit.

Product decisions this implements (2026-09-14):
- Clients upload images, 4K films, brochures, panoramas and 3D models (.glb) **in the CRM**.
- The tablet downloads **everything on first login**, runs **offline**, and stays signed in until
  **explicit logout**.
- **One box per TV.** The box ships prefilled; the server triggers updates and the box pulls them.
- Tablet and TV share content ids but get **different qualities**.
- The TV shows the **tablet's kiosk design** (six chapters), rendered by the box.
- Analytics events and **audio-only** recordings come from the tablet. No consent UI for now.
- Size for **~5 minutes of 4K film** per project.

All work lands on the `staging` branch of each repo. JSON is snake_case on the wire (the backend
sets `spring.jackson.property-naming-strategy=SNAKE_CASE`).

---

## 0. Ownership

| Area | Owner repo | Notes |
| --- | --- | --- |
| Java endpoints, services, GCS, rendition jobs | BriQBase | `src/main/java/com/briq/base/experience/*` for new code |
| SQL migrations + `schema.sql` | **BriQBase agent writes them into** `BriQUI/server/db/migrations/066_*.sql` onward and folds into `BriQUI/server/db/schema.sql` | CRM agent must not touch `server/` |
| CRM screens | BriQUI `client/` | |
| Tablet app | briq-experience-controller | |
| TV box daemon, sync agent, local relay, TV kiosk web app | briq-experience-pi-display | |

Latest existing migration on BriQUI staging is `065_experience_devices.sql`.

---

## 1. Authentication

### 1.1 CRM users (unchanged)
`POST /api/auth/login` → `{token, user}`. `Authorization: Bearer <jwt>` (12 h).

### 1.2 Tablet sessions — "signed in until logout"
A tablet exchanges a user JWT for a long-lived, revocable **tablet token** once, right after login.

`POST /api/experience/tablets` (Bearer JWT)
```json
// request
{ "name": "Samsung Tab A9", "platform": "android", "app_version": "0.2.0" }
// response 201
{ "tablet": { "id": "tb_9f2c…", "name": "Samsung Tab A9", "user_id": 12, "created_at": "…" },
  "token": "brqt_<40+ url-safe random chars>" }
```
- The token is shown once; the server stores only `sha256(token)`.
- `Authorization: Bearer brqt_…` must authenticate **every endpoint a JWT can**, as the user who
  created it, with that user's current role/capabilities/org (a filter that recognises the `brqt_`
  prefix and builds the same auth context as the JWT filter). No expiry. Updates `last_seen_at`.
- A revoked token returns **401** with `{"error":"tablet_revoked"}`; the app wipes local content.
- `DELETE /api/experience/tablets/me` — explicit logout; revokes the calling token.
- `GET /api/experience/tablets` — list for the org (`inventory.view`).
- `DELETE /api/experience/tablets/{id}` — CRM revoke (`inventory.manage`).
- `POST /api/experience/tablets/me/status` — tablet reports sync state (same `storage`, `content`,
  `sync` objects as the box heartbeat in §2.2). Returns 204.

Table `experience_tablets`: `id text pk`, `org_id`, `user_id`, `name`, `platform`, `app_version`,
`token_hash text unique`, `created_at`, `last_seen_at`, `revoked_at`, `storage jsonb`,
`content jsonb`, `sync jsonb`, `last_sync_at`. RLS `tenant_isolation` like `experience_devices`.

### 1.3 TV boxes — device secret
`POST /api/public/experience/devices/register`
```json
// request
{ "device_id": 17, "device_secret": "brqd_…" }   // both optional
// response
{ "device_id": 17, "device_secret": "brqd_…", "pairing_code": "482913",
  "pairing_code_expires_at": "…", "claimed": false }
```
- New device (no id): create row, return a fresh `device_secret` (shown once, stored hashed).
- Known id + correct secret: same device; `device_secret` echoed back only if it was just issued.
- Known id whose row has **no secret yet** (rows created before this contract): issue a secret now.
- Known id + wrong/missing secret on a row that has one: treat as a new device.
- `pairing_code` is null once claimed.

Every other box call sends `Authorization: Device <device_id>:<device_secret>` and gets 401 if it
doesn't match.

---

## 2. TV devices

### 2.1 Table changes (`experience_devices`)
Add: `device_secret_hash text`, `project_ids int[] not null default '{}'`,
`relay_key text` (random, generated at claim), `app_version text`, `lan_addresses jsonb`,
`local_relay_port int`, `storage jsonb`, `content jsonb`, `sync jsonb`, `last_sync_at timestamptz`.

New table `experience_device_commands`: `id bigserial`, `org_id`, `device_id`, `command text`,
`args jsonb`, `created_by int`, `created_at`, `delivered_at`, `completed_at`, `ok boolean`,
`result jsonb`.

### 2.2 Heartbeat — also the command channel
`POST /api/public/experience/devices/{id}/heartbeat` (Device auth), every **30 s**.
```json
// request
{
  "app_version": "0.2.0",
  "lan_addresses": ["192.168.1.40"],
  "local_relay_port": 8787,
  "storage": { "total_bytes": 256000000000, "free_bytes": 201000000000 },
  "content": { "briq-skyline-9": { "version": 42, "etag": "sha256:…" } },
  "sync": { "state": "idle", "progress": 1.0, "error": null }   // idle | syncing | error
}
// response
{
  "claimed": true,
  "pairing_code": null, "pairing_code_expires_at": null,
  "name": "Lobby TV",
  "relay_key": "rk_…",
  "projects": [ { "slug": "briq-skyline-9", "version": 43, "etag": "sha256:…" } ],
  "commands": [ { "id": 88, "command": "sync", "args": {} } ]
}
```
- Undelivered commands are returned and marked `delivered_at`. The box acks each:
  `POST /api/public/experience/devices/{id}/commands/{command_id}/ack` `{ "ok": true, "result": {} }`.
- Commands: `sync`, `restart_browser`, `reboot`, `identify` (show name on the TV for 10 s), `unpair`.
- `projects` lists the device's assigned projects with their current manifest `etag`; when it
  differs from `content`, the box syncs without waiting for a command.
- Server-side "update now" = insert a `sync` command. Latency ≤ one heartbeat (30 s).

### 2.3 Admin device API (JWT or tablet token)
- `GET /api/experience/devices` → list of:
```json
{ "id": 17, "kind": "tv", "name": "Lobby TV", "location_id": null, "online": true,
  "last_seen_at": "…", "claimed_at": "…", "project_ids": [5], "app_version": "0.2.0",
  "lan_addresses": ["192.168.1.40"], "local_relay_port": 8787, "relay_key": "rk_…",
  "storage": {…}, "content": {…}, "sync": {…}, "last_sync_at": "…" }
```
  `online` = last heartbeat within 90 s.
- `POST /api/experience/devices/claim` `{pairing_code, name, location_id?, project_ids?}` (existing,
  extended with `project_ids`; generates `relay_key`).
- `PATCH /api/experience/devices/{id}` `{name?, location_id?, project_ids?}`.
- `POST /api/experience/devices/{id}/commands` `{command, args?}` → the command row.
- `DELETE /api/experience/devices/{id}` (existing).

---

## 3. Assets and renditions

### 3.1 Tables
`experience_assets`: `id text pk` (`as_…`), `org_id`, `project_id`, `kind text`
(`image|panorama|video|pdf|model|audio`), `filename`, `mime`, `bytes bigint`, `sha256 text`,
`width int`, `height int`, `duration_ms int`, `storage_path text`, `url text` (public original),
`status text` (`uploading|processing|ready|failed`), `error text`, `created_by`, `created_at`,
`updated_at`.

`experience_asset_renditions`: `asset_id`, `variant text` (`tablet|tv|thumb`), `storage_path`,
`url`, `mime`, `bytes`, `sha256`, `width`, `height`, `status`, `error`, primary key
`(asset_id, variant)`.

### 3.2 Upload flow (direct to GCS, any size up to 8 GB)
1. `POST /api/properties/{project_id}/assets` (`inventory.manage`)
   `{ "filename": "walkthrough.mp4", "mime": "video/mp4", "bytes": 1843200000, "kind": "video" }`
   → `{ "asset": {…status:"uploading"}, "upload": { "method": "PUT", "url": "<GCS V4 signed URL>",
   "headers": { "Content-Type": "video/mp4" } } }`. URL valid 6 h. `kind` is inferred from mime /
   extension when omitted (`.glb` → `model` even if the browser says `application/octet-stream`).
2. Client `PUT`s the bytes to `upload.url` with `upload.headers`.
3. `POST /api/properties/{project_id}/assets/{asset_id}/complete` → server checks the object exists,
   records `bytes`, streams it to compute `sha256`, sets `status:"processing"`, queues renditions,
   returns the asset.
4. `GET /api/properties/{project_id}/assets` → all assets with renditions.
   `GET /api/properties/{project_id}/assets/{asset_id}` → one.
   `DELETE /api/properties/{project_id}/assets/{asset_id}`.

Allowed: `image/jpeg|png|webp|avif`, `video/mp4|quicktime|webm`, `application/pdf`,
`model/gltf-binary` (`.glb`), `audio/mp4|mpeg|wav|webm`. Stored in the existing public experience
bucket at `{org}/experience/{project_id}/assets/{asset_id}/original.{ext}` and
`…/{variant}.{ext}`, `Cache-Control: public, max-age=31536000, immutable`.

The existing small-file `POST /api/properties/{id}/media` keeps working and also creates a
`ready` asset row for what it stored.

Asset JSON:
```json
{ "id": "as_12", "project_id": 5, "kind": "video", "filename": "walkthrough.mp4",
  "mime": "video/mp4", "bytes": 1843200000, "sha256": "…", "width": 3840, "height": 2160,
  "duration_ms": 300000, "status": "ready", "error": null,
  "url": "https://storage.googleapis.com/…/original.mp4",
  "renditions": [ { "variant": "tablet", "url": "…/tablet.mp4", "mime": "video/mp4",
                    "bytes": 310000000, "sha256": "…", "width": 1920, "height": 1080, "status": "ready" } ],
  "created_at": "…" }
```

### 3.3 Rendition rules (ffmpeg, already in the backend image; run as Cloud Tasks jobs)
| kind | tablet | tv | thumb |
| --- | --- | --- | --- |
| image | WebP, long edge ≤ 2560 | original if long edge ≤ 3840 else JPEG q90 long edge 3840 | WebP 480 |
| panorama | JPEG q88, width ≤ 6144 | original if width ≤ 8192 else JPEG width 8192 | WebP 480 |
| video | H.264 High, 1080p, CRF 23, AAC 128k, `+faststart` | HEVC (`hvc1`) 2160p `-preset veryfast -crf 24` + AAC 192k; **reuse the original** when it is already HEVC ≤ 2160p | WebP frame at 3 s, 480 |
| pdf | original | original | — |
| model | original | original | — |
| audio | original | — | — |

"original" renditions are rows pointing at the original object (same url/sha256) so clients can
always read `renditions` by variant. An asset is `ready` when all its variants are `ready`.

---

## 4. Render packs (clickable 3D inventory)

`projects.render_pack jsonb` (nullable). Saved through the existing project update endpoint and
returned inside the public experience payload as `render_pack`. All image/model fields are asset
original URLs (the manifest maps them to renditions). Coordinates are in the image's own pixels.
```json
{
  "aerial": { "image": "https://…/aerial.jpg", "size": [1672, 941],
              "towers": [ { "tower_id": 14, "points": [[258,212],[345,105]], "label": [560,170] },
                          { "tower_id": null, "placeholder": "Phase 2", "points": […], "label": […] } ] },
  "elevations": { "14": { "image": "https://…/elev.jpg", "size": [1086,1448],
                          "units": { "A-903": [[594,780],[730,780],[730,850],[594,850]] } } },
  "floor_plates": { "14": { "image": "https://…/plate.jpg", "size": [1672,941],
                            "positions": { "1": [[445,20],…], "2": […] } } },
  "units": { "3 BHK": { "image": "https://…/3bhk.jpg", "measured_image": "https://…/3bhk-dims.jpg",
                        "model": "https://…/3bhk.glb", "size": [1672,941],
                        "rooms": [ { "name": "Master Bedroom", "ft": [13,12], "at": [350,460], "at3d": [-4.1,0.23,-2.6] } ] } }
}
```
- Elevation shapes are per `unit_no` (explicit, no grid maths). Floor-plate shapes are per unit
  **position** = last two digits of `unit_no`; one plate per tower applies to every floor.
- The tablet falls back to its bundled BriQ Skyline demo pack only when `render_pack` is null.

---

## 5. Content manifest

`GET /api/experience/manifest?device_class=tablet` (tablet token) — every published project in the org.
`GET /api/experience/manifest?device_class=tv` (Device auth) — the device's `project_ids`.
Optional `&slug=` narrows to one project.

*Amendment 1 (CRM needs it for the Devices page):* the same endpoint also accepts a CRM user JWT
with `inventory.view` for either `device_class` (read-only, org-scoped, all published projects).
And the project list/detail endpoints (`GET /api/properties`, `GET /api/properties/{id}`) include
`content_version` and `content_etag` (the manifest `etag` for `device_class=tv`) so the CRM can show
whether each device is in sync without fetching the manifest.
```json
{
  "generated_at": "2026-09-14T10:30:00Z",
  "device_class": "tv",
  "projects": [ {
    "slug": "briq-skyline-9",
    "project_id": 5,
    "version": 43,
    "etag": "sha256:…",
    "payload": { /* exactly GET /api/public/experience/{slug}, including render_pack */ },
    "files": [
      { "key": "https://storage.googleapis.com/…/original.mp4",
        "asset_id": "as_12", "variant": "tv", "kind": "video",
        "url": "https://storage.googleapis.com/…/tv.mp4", "mime": "video/mp4",
        "bytes": 1100000000, "sha256": "…" },
      { "key": "https://images.example.com/legacy.jpg", "asset_id": null, "variant": "original",
        "kind": "image", "url": "https://images.example.com/legacy.jpg", "mime": null,
        "bytes": null, "sha256": null }
    ],
    "total_bytes": 1400000000
  } ]
}
```
- `files` covers **every URL referenced anywhere in `payload`** (org logo, hero, gallery,
  floor plans, brochure, walkthrough video, scenes and walkthrough nodes, render_pack). `key` is
  the URL exactly as it appears in `payload`; clients replace `key` with their local file.
- For a URL that is an asset, `url`/`sha256`/`bytes` are the rendition for `device_class`
  (fall back to `original` while a rendition isn't ready). Non-asset URLs carry nulls; clients
  download them as-is and key them by URL.
- `version` is `projects.content_version`, bumped whenever the project, its towers/units, assets or
  render pack change. `etag` = `sha256` of the canonical JSON of `{payload, files}`.
- Clients sync when `etag` differs, download into a staging area, verify `sha256` when present,
  switch atomically, then delete files no longer referenced. A device keeps serving its last
  complete version if a sync fails.

---

## 6. Presenter protocol v2 (tablet → TV)

### 6.1 Transports
- **LAN first.** The box runs a relay at `ws://<lan_address>:<local_relay_port>/relay`.
  Tablet connects as `?role=presenter&key=<relay_key>`; the TV page connects from the box itself as
  `ws://127.0.0.1:<port>/relay?role=viewer`. Wrong key → close 4401.
- **Cloud fallback.** Existing `/ws/cobrowse?session=device-<device_id>&role=presenter|viewer`.
  The box daemon stays connected there as viewer and forwards everything it receives to its local
  viewers, so a tablet that can't reach the LAN still drives the TV.
- The tablet tries each `lan_addresses` entry (1.5 s timeout), uses the first that opens, and
  otherwise uses the cloud room. It sends to exactly one transport at a time.

Frames are the existing envelope `{ "t": "state", "state": <object> }`. The relay keeps the last
`state` and replays it to a viewer that joins.

### 6.2 Commands (a `state` whose object has `cmd`)
```json
{ "cmd": "present", "slug": "briq-skyline-9", "lead": null }
{ "cmd": "idle" }
```
`present` switches the TV to that project's kiosk (from local content) at the home chapter.
`idle` returns to the pairing/idle screen.

### 6.3 Kiosk state
Sent after `present` and on every change (continuous values such as cameras sampled ≤ 12/s):
```json
{
  "v": 2,
  "slug": "briq-skyline-9",
  "chapter": "inventory",               // home | renders | inventory | brochure | vr | walkthrough | location
  "home":      { "index": 1, "paused": true },
  "renders":   { "index": 3, "playing": false, "zoom": 1.0, "pan_x": 0.0, "pan_y": 0.0 },
  "inventory": { "level": "unit",       // aerial | tower | floor | unit
                 "tower_id": 14, "floor": 9, "unit_no": "A-903", "tip_unit_no": null,
                 "cfg": null, "unit_mode": "3d",   // standard | sqft | sqm | 3d
                 "model_cam": { "theta": 35, "phi": 55, "radius": null, "spin": false, "labels": true },
                 "compare": ["A-903", "A-1204"] },
  "brochure":  { "page": 4, "zoom": 1.0 },
  "vr":        { "scene_idx": 2, "node_id": "living", "cam": { "yaw": 1.2, "pitch": -0.1, "zoom": 50 } },
  "walkthrough": { "playing": true, "time": 42.5, "rate": 1, "muted": false, "at": 1789331010077 },
  "location":  { "poi": 3, "is_3d": false, "measuring": false, "map_cam": { "lng": 88.47, "lat": 22.6, "zoom": 13, "bearing": 0, "pitch": 0 } }
}
```
Angles for `model_cam` are degrees. `walkthrough.at` is the sender's epoch ms so the TV can add
elapsed time when applying `time`.

---

## 7. Analytics events (tablet)

`POST /api/experience/events/batch` (tablet token)
```json
{ "events": [ {
  "id": "7d0c…uuid", "slug": "briq-skyline-9", "type": "chapter_view", "ref": "inventory",
  "session": "s_x1y2", "lead": null, "source": "guided", "mode": "showroom",
  "occurred_at": "2026-09-14T10:31:02.120Z", "duration_ms": 48200, "meta": { "presenting": true, "device_id": 17 }
} ] }
// response
{ "accepted": 1, "duplicates": 0 }
```
- Up to 500 events per call; idempotent on `id`.
- Types: existing `open`, `scene_view`, `unit_click`, `config_filter`, `interest`, `enquire`, plus
  `chapter_view`, `unit_view` (ref unit_no, duration), `unit_mode` (ref standard/sqft/sqm/3d),
  `model_3d_open`, `render_view` (ref index), `brochure_page`, `video_play`, `video_complete`,
  `compare_add`, `present_start`, `present_stop`, `recording_start`, `recording_stop`.
- `experience_events` gains `client_event_id uuid unique`, `occurred_at timestamptz`,
  `tablet_id text`, `user_id int`, `duration_ms int`, `meta jsonb`. Existing single-event endpoint
  and the Experience Analytics page keep working.

Enquiries keep using `POST /api/public/experience/{slug}/enquire`; the tablet queues them offline
and sends them when online (the event `enquire` is also recorded).

---

## 8. Recordings (tablet, audio only)

`POST /api/experience/recordings` (tablet token), idempotent on `id`:
```json
// request
{ "id": "rec_7d0c…", "slug": "briq-skyline-9", "session": "s_x1y2", "lead": null,
  "started_at": "…", "ended_at": "…", "duration_ms": 1260000, "mime": "audio/mp4", "bytes": 10300000 }
// response
{ "recording": { "id": "rec_7d0c…", "status": "uploading", … },
  "upload": { "method": "PUT", "url": "<signed URL, private bucket>", "headers": { "Content-Type": "audio/mp4" } } }
```
- `POST /api/experience/recordings/{id}/complete` → verifies object, `status: "uploaded"`, queues
  transcription through the existing call-recording pipeline (ffmpeg → mp3 → Whisper/Gemini).
  Status then `transcribing` → `done` or `failed`.
- `GET /api/experience/recordings?slug=&lead_id=&user_id=` (CRM, `inventory.view`) and
  `GET /api/experience/recordings/{id}/url` → short-lived signed playback URL.
- Table `experience_recordings`: `id text pk`, `org_id`, `project_id`, `tablet_id`, `user_id`,
  `lead_id`, `session`, `started_at`, `ended_at`, `duration_ms`, `mime`, `bytes`, `storage_path`,
  `status`, `transcript text`, `error`, `created_at`, `updated_at`. RLS like the others.
- Stored in the existing private call-recording bucket under `{org}/experience-recordings/{id}.m4a`.
- Recording format on the tablet: AAC in MP4 (`.m4a`), mono, 64 kbps, 16 kHz or higher.

---

## 8a. Amendment 2 — as built (2026-09-14)

Behaviour the four implementations settled on where §1–§8 were silent or had to bend. These are now
part of the contract.

**Units in §6.3**
- `renders.pan_x` / `pan_y`: fraction of the stage size (−1…1), not pixels.
- `vr.cam.yaw` / `pitch`: radians; `vr.cam.zoom`: photo-sphere-viewer zoom level 0–100.
- `inventory.model_cam.theta` / `phi`: degrees; `radius`: metres (null = auto).

**Relay (§6.1)**
- The relay replays the last command (`present` / `idle`) **and** the last kiosk state to a viewer
  that joins or reloads.
- Close codes: `4401` wrong or missing `relay_key`, or the box is not claimed yet; `4403` viewer not
  connecting from the box itself; `4400` unknown role.
- The tablet re-sends its latest command and state whenever its transport reconnects (the cloud
  relay can drop idle sockets).
- A legacy `{cmd:"load", url}` received by the box is treated as `present` for the slug in the URL.

**Box (§2.2)**
- The box also serves loopback-only `/local/status.json` and `/local/events` for its own TV page.
- Against a server without this contract (manifest 401/403/404, register without a secret), the box
  shows its pairing code and "no content yet", keeps any content it already has, and re-checks
  the manifest every 15 minutes.
- `sync` ack result: `{content, updated, removed, error}`. `restart_browser` accepts
  `args.hard` (restart the kiosk service instead of a reload); `identify` accepts `args.seconds`.
  `unpair` keeps the device id and re-registers.
- Default `local_relay_port` is 8787.

**Backend (§1–§8)**
- `projects.content_version` is bumped by database triggers on projects, towers, units, assets and
  renditions (so writes from any code path count).
- `sha256` for files over 256 MB is computed by the first background job, so an asset can be
  `processing` with `sha256: null` right after `/complete`. Clients must tolerate null hashes.
- `POST /api/experience/tablets` refuses a caller that is itself a tablet token (403).
- A device row that never received a secret may still heartbeat without auth, but only gets back its
  id and pairing code.
- Events batch response adds `rejected`; `lead` accepts a lead id or an experience token; mode
  `showroom` is valid.
- `POST /api/experience/recordings` returns 200 with `upload: null` once the file is already
  uploaded; `/complete` is limited to the creator or `inventory.manage`; `GET …/{id}/url` returns
  `{url, expires_at}`. Calling `/complete` again retries a failed asset or recording.
- Asset JSON adds `updated_at` and a per-rendition `error`; the legacy `/media` response adds
  `asset_id`.
- `POST /api/experience/recordings` rolls its row back when the upload URL cannot be signed
  (502 `Storage is unavailable right now — try again.`), so the tablet's retry after storage
  recovers is a clean create.

**Tablet (§5, §7, §8)**
- sha256 is verified for files up to 64 MB (read in 3 MB chunks); larger files are checked by size
  only.
- If the manifest endpoint is unavailable, the Content screen can build a local copy from the
  public payloads (opt-in, no hashes).
- In the legacy single-event fallback, event types that endpoint doesn't know are dropped.
- Recordings are AAC m4a, mono, 64 kbps, 44.1 kHz.
- A CRM revoke reaches the tablet on its next authenticated call with that token: any 401
  `tablet_revoked` on the current session's token wipes content and returns to login, including the
  outbox's event and recording flushes (every 30 s while work is queued) that pass the token
  explicitly. Launch, foreground re-sync and the Showroom TVs list also call. A tablet with nothing
  queued and no screen activity is not polled.

---

## 8b. Amendment 3 — client branding and the TV detail reveal (2026-09-15)

**Branding rule (all screens a buyer can see)**
- The brand shown on the TV and on the tablet's presented screens is the project's `builder`,
  else `org.name`, else the neutral "Experience Center". The words "BriQ" never appear on a
  buyer-facing screen; the operator-only login screen is exempt.
- `org.logo_url` fills every logo slot (chapter heads, home, the idle header) when present.

**Heartbeat (§2.2) carries the org**
- The authenticated heartbeat response gains `org` between `name` and `relay_key`:
  `"org": {"name": "Godrej", "logo_url": "https://…/godrej.png"}`. Both keys are nullable
  (blank strings are normalised to null). `org` is `null` while the device is unclaimed or the org
  has no settings row. The legacy unauthenticated heartbeat is unchanged.
- The box persists `org` in its identity and includes it in the status it pushes to the TV page,
  so the idle/pairing screen shows the client's name and logo instead of a platform wordmark, and
  the QR card carries the org name as a caption. Before a claim the header reads "Experience
  Center". A change to org settings reaches a claimed TV on its next heartbeat.

**Kiosk state (§6.3): `inventory.show_details`**
- Type `boolean`, default `false`; sent in the inventory slice and shallow-merged like every other
  field.
- At `level: "unit"`, `true` tells the TV to reveal the unit's data (unit, type, status, carpet
  area, facing, indicative price, plus the on-floor mini plate or the compare table) as a panel
  over the render; `false` or absent keeps the TV image-only. At any other level the field has no
  effect on the TV. The tablet's own detail card is always visible.
- The tablet sets it back to `false` on every path that leaves the unit level (up, crumb taps,
  tower or floor navigation, type-filter changes, show-all, reset). A chapter switch does not clear
  it, so returning to the inventory chapter restores whatever was showing.
- The TV inventory chapter no longer mirrors the presenter's filters rail; it shows the stage
  (aerial, elevation, floor plate, unit render or 3D) edge to edge, a compact project card at the
  aerial level, a slim unit-chip strip at the floor level, and the tooltip only while
  `tip_unit_no` is set.

**Presenter link (§6.1)**
- Switching the target TV mid-presentation is a new destination: the tablet tears down both
  transports, clears its bad-URL memory, re-selects LAN first, then cloud, and replays the last
  command and state to the new TV. A refreshed device list for the same TV re-probes the LAN as
  soon as a relay key or address appears, without dropping a working link.

## 9. Sizes to plan for (per project, 5 min of 4K film)

| | Tablet | TV box |
| --- | --- | --- |
| Film | ~0.3 GB (1080p H.264) | ~1–1.5 GB (2160p HEVC) |
| Renders, plates, dollhouses (~40 images) | ~0.1 GB | ~0.4 GB |
| Panoramas (~15) | ~0.1 GB | ~0.3 GB |
| Brochure + models | ~0.1 GB | ~0.1 GB |
| **Budget** | **~0.6 GB** | **~2.5 GB** |
