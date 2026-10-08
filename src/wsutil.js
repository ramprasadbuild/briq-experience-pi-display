// WebSocket helpers shared by the local server and the relay.

/** Sends one JSON message to every open socket in `sockets` (serialised once). */
export function sendToAll(sockets, message) {
  const frame = JSON.stringify(message);
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(frame);
}
