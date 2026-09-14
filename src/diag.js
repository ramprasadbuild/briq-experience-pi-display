#!/usr/bin/env node
// Manual tool: act as a presenter and send commands/state to a box.
//
//   node src/diag.js --key <relay_key> present <slug>          # LAN relay on 127.0.0.1:8787
//   node src/diag.js --key <relay_key> idle
//   node src/diag.js --key <relay_key> state '{"v":2,"slug":"…","chapter":"renders","renders":{"index":2}}'
//   node src/diag.js --url ws://192.168.1.40:8787 --key … present <slug>
//   node src/diag.js --cloud <deviceId> present <slug>         # via the cloud /ws/cobrowse room
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { CobrowseSocket } from './cobrowse.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { url: { type: 'string', default: 'ws://127.0.0.1:8787' }, key: { type: 'string' }, cloud: { type: 'string' } },
});
const [cmd, arg] = positionals;
let state;
if (cmd === 'present' && arg) state = { cmd: 'present', slug: arg, lead: null };
else if (cmd === 'idle') state = { cmd: 'idle' };
else if (cmd === 'state' && arg) state = JSON.parse(arg);
else {
  console.error('usage: node src/diag.js [--url ws://host:port] [--key relay_key | --cloud deviceId] present <slug> | idle | state <json>');
  process.exit(2);
}

if (values.cloud) {
  const socket = new CobrowseSocket(`device-${values.cloud}`, 'presenter');
  socket.connect();
  const timer = setInterval(() => {
    if (socket.send(state)) {
      console.log('[diag] sent via cloud', state);
      clearInterval(timer);
      setTimeout(() => { socket.close(); process.exit(0); }, 500);
    }
  }, 200);
} else {
  const ws = new WebSocket(`${values.url}/relay?role=presenter&key=${encodeURIComponent(values.key ?? '')}`);
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'state', state }));
    console.log('[diag] sent via LAN relay', state);
    setTimeout(() => { ws.close(); process.exit(0); }, 300);
  });
  ws.on('close', (code, reason) => { if (code !== 1000 && code !== 1005) { console.error(`[diag] closed ${code} ${reason}`); process.exit(1); } });
  ws.on('error', (err) => { console.error(`[diag] ${err.message}`); process.exit(1); });
}
