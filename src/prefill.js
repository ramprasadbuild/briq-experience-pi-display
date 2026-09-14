#!/usr/bin/env node
// Factory prefill: put content on a box before it ships, so it runs offline from the first boot.
//
//   npm run prefill -- --api https://… --device-id 17 --secret brqd_… [--data-dir /var/lib/briq-display]
//   npm run prefill -- --from /mnt/golden/briq-display [--verify] [--data-dir …]
//
// The first form syncs the device's tv manifest exactly like the daemon does (and saves the id +
// secret so the box keeps them); the second copies an already-synced content dir (another box's
// data dir, or its content/ folder), optionally re-hashing every sha256-named file.
import { parseArgs } from 'node:util';
import { ApiClient } from './api.js';
import { ensureDir, MIN_FREE_BYTES, resolveDataDir } from './config.js';
import { ContentStore } from './content/store.js';
import { SyncAgent } from './content/sync.js';
import { IdentityStore } from './identity.js';
import { storage } from './sysinfo.js';

const USAGE = `usage:
  npm run prefill -- --api <base url> --device-id <id> --secret <device secret> [--data-dir <dir>] [--no-save-identity]
  npm run prefill -- --from <content or data dir> [--verify] [--data-dir <dir>]`;

export async function prefill(argv = process.argv.slice(2), log = console) {
  const { values } = parseArgs({
    args: argv,
    options: {
      api: { type: 'string' },
      'device-id': { type: 'string' },
      secret: { type: 'string' },
      'data-dir': { type: 'string' },
      from: { type: 'string' },
      verify: { type: 'boolean', default: false },
      'no-save-identity': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || (!values.from && !(values.api && values['device-id'] && values.secret))) {
    log.log(USAGE);
    return values.help ? 0 : 2;
  }
  const dataDir = ensureDir(resolveDataDir(values['data-dir']));
  const store = await new ContentStore(dataDir).init();
  log.log(`[prefill] data dir ${dataDir}`);

  if (values.from) {
    const slugs = await store.importFrom(values.from, { verify: values.verify, log: (m) => log.log(`[prefill] ${m}`) });
    log.log(`[prefill] imported ${slugs.length} project(s): ${slugs.join(', ') || '(none)'}`);
    log.log(`[prefill] content: ${JSON.stringify(store.contentMap())}`);
    return 0;
  }

  const identity = new IdentityStore(dataDir);
  await identity.load();
  const rawId = values['device-id'];
  const deviceId = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
  if (values['no-save-identity']) {
    identity.value = { ...identity.value, device_id: deviceId, device_secret: values.secret };
  } else {
    await identity.update({ device_id: deviceId, device_secret: values.secret });
  }
  const api = new ApiClient({ baseUrl: values.api, identity });
  const quiet = { info: (m) => log.log(m), warn: (m) => log.log(m), error: (m) => log.error(m) };
  const sync = new SyncAgent({ store, api, minFreeBytes: MIN_FREE_BYTES, storage: () => storage(dataDir), log: quiet });
  let last = -1;
  sync.on('state', (s) => {
    const pct = Math.floor((s.progress ?? 0) * 100);
    if (pct !== last) { last = pct; log.log(`[prefill] ${s.state} ${pct}%`); }
  });
  const result = await sync.request('prefill');
  log.log(`[prefill] ${result.ok ? 'done' : 'FAILED'}: ${JSON.stringify({ updated: result.updated, kept: result.kept, removed: result.removed, error: result.error, content: result.content })}`);
  return result.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  prefill().then((code) => process.exit(code), (err) => { console.error(`[prefill] ${err.stack ?? err}`); process.exit(1); });
}
