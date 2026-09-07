// Manual test tool: acts as a fake controller, sending a {cmd:'load'|'idle'} command to a running
// daemon's device room. Usage:
//   node src/diag.js <deviceId> load <url>
//   node src/diag.js <deviceId> idle
import { CobrowseSocket } from './cobrowse.js';

const [, , deviceId, cmd, url] = process.argv;
if (!deviceId || !cmd) {
  console.error('usage: node src/diag.js <deviceId> load <url>   |   node src/diag.js <deviceId> idle');
  process.exit(1);
}

const socket = new CobrowseSocket(`device-${deviceId}`, 'presenter');
socket.onMessage((m) => console.log('[diag] received', m));
socket.connect();

setTimeout(() => {
  const state = cmd === 'load' ? { cmd: 'load', url } : { cmd: 'idle' };
  console.log('[diag] sending', state);
  socket.send(state);
  setTimeout(() => {
    socket.close();
    process.exit(0);
  }, 1500);
}, 1000);
